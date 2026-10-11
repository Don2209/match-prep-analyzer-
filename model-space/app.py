import os
import queue
import tempfile
import threading
import time
import traceback
import uuid

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

import pipeline

MAX_BYTES = 150 * 1024 * 1024
JOB_TTL = 2 * 60 * 60
IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}

app = FastAPI(title="Soccer YOLOv8 Tracker")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

JOBS: dict[str, dict] = {}
QUEUE: "queue.Queue[str]" = queue.Queue()
STATE = {"modelReady": False, "modelError": None}


def _worker():
    try:
        pipeline.get_model()
        STATE["modelReady"] = True
    except Exception as e:  # surface load failures through /health
        STATE["modelError"] = str(e)
        traceback.print_exc()
    while True:
        job_id = QUEUE.get()
        job = JOBS.get(job_id)
        if not job:
            continue
        job.update(status="running", startedAt=time.time())
        try:
            if job["kind"] == "image":
                result = pipeline.analyze_image(job["path"])
            else:
                result = pipeline.analyze_video(job["path"], lambda p: job.update(progress=round(p, 3)), job["accurate"])
            job.update(status="done", progress=1.0, result=result)
        except Exception as e:
            traceback.print_exc()
            job.update(status="error", error=str(e) or e.__class__.__name__)
        finally:
            job["finishedAt"] = time.time()
            try:
                os.remove(job["path"])
            except OSError:
                pass


def _janitor():
    while True:
        time.sleep(300)
        now = time.time()
        for jid, job in list(JOBS.items()):
            if now - job["createdAt"] > JOB_TTL and job["status"] in ("done", "error"):
                JOBS.pop(jid, None)


threading.Thread(target=_worker, daemon=True).start()
threading.Thread(target=_janitor, daemon=True).start()


@app.get("/")
def root():
    return {"service": "soccer-yolov8", "endpoints": ["/health", "POST /jobs", "/jobs/{id}"]}


@app.get("/health")
def health():
    return {
        "status": "ok" if STATE["modelReady"] else ("error" if STATE["modelError"] else "loading"),
        "model": os.path.basename(pipeline.WEIGHTS),
        "modelError": STATE["modelError"],
        "queued": sum(j["status"] == "queued" for j in JOBS.values()),
        "running": sum(j["status"] == "running" for j in JOBS.values()),
        "limits": {"maxSeconds": pipeline.MAX_SECONDS, "maxMB": MAX_BYTES // (1024 * 1024)},
    }


@app.post("/jobs")
async def create_job(file: UploadFile = File(...), accurate: bool = Form(False)):
    ext = os.path.splitext(file.filename or "")[1].lower()
    is_image = ext in IMAGE_EXT or (file.content_type or "").startswith("image/")
    fd, path = tempfile.mkstemp(suffix=ext or (".jpg" if is_image else ".mp4"))
    size = 0
    with os.fdopen(fd, "wb") as out:
        while chunk := await file.read(1024 * 1024):
            size += len(chunk)
            if size > MAX_BYTES:
                out.close()
                os.remove(path)
                raise HTTPException(413, f"File too large (max {MAX_BYTES // (1024 * 1024)} MB). Trim the clip first.")
            out.write(chunk)
    job_id = uuid.uuid4().hex[:12]
    JOBS[job_id] = {
        "id": job_id,
        "kind": "image" if is_image else "video",
        "path": path,
        "accurate": accurate,
        "status": "queued",
        "progress": 0.0,
        "createdAt": time.time(),
        "filename": file.filename,
    }
    QUEUE.put(job_id)
    return {"id": job_id, "kind": JOBS[job_id]["kind"]}


@app.get("/jobs/{job_id}")
def get_job(job_id: str):
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(404, "Job not found (it may have expired or the Space restarted).")
    ahead = sum(1 for j in JOBS.values() if j["status"] == "queued" and j["createdAt"] < job["createdAt"])
    body = {k: job.get(k) for k in ("id", "kind", "status", "progress", "error", "filename")}
    body["queuePosition"] = ahead if job["status"] == "queued" else 0
    if job["status"] == "done":
        body["result"] = job["result"]
    return body
