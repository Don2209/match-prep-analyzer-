"""YOLOv8 detection + ByteTrack tracking + jersey-colour team split for soccer footage.

All coordinates in the output are normalised to [0, 1] image space so the
frontend/backend can map them onto the pitch (optionally via a homography).
"""
import base64
import os
import time
from types import SimpleNamespace

import cv2
import numpy as np
from sklearn.cluster import KMeans
from ultralytics import YOLO
from ultralytics.trackers.byte_tracker import BYTETracker

WEIGHTS = os.environ.get("MODEL_WEIGHTS", "yolov8s.pt")
MAX_FRAMES = int(os.environ.get("MAX_FRAMES", "600"))
MAX_SECONDS = float(os.environ.get("MAX_SECONDS", "180"))
TARGET_FPS = 5.0
WORK_WIDTH = 1280  # frames wider than this are downscaled before inference
KEYFRAME_WIDTH = 960

_model = None


def get_model():
    global _model
    if _model is None:
        _model = YOLO(WEIGHTS)
        _model.predict(np.zeros((640, 640, 3), np.uint8), verbose=False)  # warm-up
    return _model


def _class_groups(model):
    names = model.names
    ball = {i for i, n in names.items() if "ball" in n.lower()}
    referee = {i for i, n in names.items() if "referee" in n.lower()}
    if "sports ball" in names.values():  # COCO weights: only people + ball are useful
        person = {i for i, n in names.items() if n == "person"}
    else:
        person = set(names) - ball
    return person, ball, referee


def _new_tracker(fps):
    args = SimpleNamespace(
        tracker_type="bytetrack",
        track_high_thresh=0.3,
        track_low_thresh=0.1,
        new_track_thresh=0.35,
        track_buffer=max(10, int(fps * 3)),  # keep lost tracks ~3 s
        match_thresh=0.8,
        fuse_score=True,
    )
    return BYTETracker(args, frame_rate=30)


def _torso_colour(frame, box):
    """Median Lab colour of the shirt area, ignoring grass pixels."""
    x1, y1, x2, y2 = box
    w, h = x2 - x1, y2 - y1
    if w < 4 or h < 10:
        return None
    crop = frame[max(int(y1 + 0.15 * h), 0):int(y1 + 0.5 * h), max(int(x1 + 0.25 * w), 0):int(x2 - 0.25 * w)]
    if crop.size == 0:
        return None
    px = crop.reshape(-1, 3)
    hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV).reshape(-1, 3)
    grass = (hsv[:, 0] >= 35) & (hsv[:, 0] <= 85) & (hsv[:, 1] >= 50)
    px = px[~grass]
    if len(px) < 5:
        return None
    lab = cv2.cvtColor(px.reshape(-1, 1, 3), cv2.COLOR_BGR2LAB).reshape(-1, 3).astype(np.float32)
    return np.median(lab, axis=0)


def _lab_to_hex(lab):
    pix = np.clip(np.array(lab, np.float32), 0, 255).astype(np.uint8).reshape(1, 1, 3)
    b, g, r = cv2.cvtColor(pix, cv2.COLOR_LAB2BGR)[0, 0]
    return f"#{r:02x}{g:02x}{b:02x}"


def _assign_teams(track_colours, referee_ids):
    """KMeans(k=2) on per-track median shirt colour. Returns ({id: team}, [hex, hex])."""
    ids = [i for i, c in track_colours.items() if c and i not in referee_ids]
    if len(ids) < 2:
        return {i: 0 for i in track_colours}, ["#e11d48", "#2563eb"]
    feats = np.array([np.median(track_colours[i], axis=0) for i in ids], np.float32)
    weighted = feats * np.array([0.5, 1.0, 1.0], np.float32)  # lightness matters less than hue
    km = KMeans(n_clusters=2, n_init=10, random_state=0).fit(weighted)
    dist = np.linalg.norm(weighted - km.cluster_centers_[km.labels_], axis=1)
    cutoff = max(np.median(dist) * 2.5, 12.0)
    teams = {}
    for i, label, d in zip(ids, km.labels_, dist):
        teams[i] = -1 if d > cutoff else int(label)  # -1 = referee / keeper / unknown
    for i in referee_ids:
        teams[i] = -1
    centres = km.cluster_centers_ / np.array([0.5, 1.0, 1.0], np.float32)
    return teams, [_lab_to_hex(c) for c in centres]


def _interpolate_ball(balls, max_gap=3):
    out = list(balls)
    last = None
    for i, b in enumerate(out):
        if b is None:
            continue
        if last is not None and 1 < i - last <= max_gap + 1:
            (x0, y0), (x1, y1) = out[last], b
            n = i - last
            for k in range(1, n):
                out[last + k] = [round(x0 + (x1 - x0) * k / n, 4), round(y0 + (y1 - y0) * k / n, 4)]
        last = i
    return out


def _encode_jpeg(img, width=KEYFRAME_WIDTH):
    h, w = img.shape[:2]
    if w > width:
        img = cv2.resize(img, (width, int(h * width / w)), interpolation=cv2.INTER_AREA)
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 72])
    return "data:image/jpeg;base64," + base64.b64encode(buf).decode() if ok else None


def _annotate(img, dets, ball, teams, colours):
    img = img.copy()
    h, w = img.shape[:2]
    palette = [tuple(int(c[i:i + 2], 16) for i in (5, 3, 1)) for c in colours]  # hex -> BGR
    for tid, x1, y1, x2, y2 in dets:
        team = teams.get(tid, -1)
        col = palette[team] if team in (0, 1) else (0, 215, 255)
        cx, foot = int((x1 + x2) / 2), int(y2)
        cv2.ellipse(img, (cx, foot), (max(int((x2 - x1) * 0.6), 6), 5), 0, -45, 235, col, 2)
        cv2.putText(img, str(tid), (cx - 8, int(y1) - 4), cv2.FONT_HERSHEY_SIMPLEX, 0.45, col, 1, cv2.LINE_AA)
    if ball:
        bx, by = int(ball[0] * w), int(ball[1] * h)
        cv2.drawMarker(img, (bx, by - 12), (255, 255, 255), cv2.MARKER_TRIANGLE_DOWN, 14, 2)
    return img


def _detect(model, frame, imgsz, groups):
    person_ids, ball_ids, _ = groups
    res = model.predict(frame, imgsz=imgsz, conf=0.1, classes=sorted(person_ids | ball_ids), verbose=False)[0]
    boxes = res.boxes.cpu().numpy()
    cls = boxes.cls.astype(int)
    person_mask = np.isin(cls, list(person_ids)) & (boxes.conf >= 0.25)
    ball_mask = np.isin(cls, list(ball_ids))
    ball = None
    if ball_mask.any():
        bb = boxes[ball_mask]
        j = int(np.argmax(bb.conf))
        if bb.conf[j] >= 0.15:
            x1, y1, x2, y2 = bb.xyxy[j]
            ball = (float((x1 + x2) / 2), float((y1 + y2) / 2))
    return boxes[person_mask], ball


def analyze_video(path, progress=lambda p: None, accurate=False):
    t0 = time.time()
    model = get_model()
    groups = _class_groups(model)
    imgsz = 960 if accurate else 640

    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        raise ValueError("Could not open the video. Use MP4 (H.264), MOV or WebM.")
    src_fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    if not 1 <= src_fps <= 240:
        src_fps = 25.0
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    duration = min(total / src_fps if total > 0 else MAX_SECONDS, MAX_SECONDS)
    fps = min(TARGET_FPS, MAX_FRAMES / max(duration, 1.0))
    step = max(1, round(src_fps / fps))
    fps = src_fps / step
    last_index = int(min(total if total > 0 else 1e9, MAX_SECONDS * src_fps))
    expected = max(1, last_index // step)
    key_slots = {int(expected * f) for f in (0.1, 0.5, 0.9)}

    tracker = _new_tracker(fps)
    referee_ids = set()
    track_colours = {}
    raw = []  # per sampled frame: (t, [(id, x1, y1, x2, y2)], ball)
    keyframes = {}
    W = H = None
    idx = sample = 0

    while idx < last_index:
        if not cap.grab():
            break
        if idx % step:
            idx += 1
            continue
        ok, frame = cap.retrieve()
        if not ok:
            break
        if frame.shape[1] > WORK_WIDTH:
            s = WORK_WIDTH / frame.shape[1]
            frame = cv2.resize(frame, (WORK_WIDTH, int(frame.shape[0] * s)), interpolation=cv2.INTER_AREA)
        H, W = frame.shape[:2]

        persons, ball = _detect(model, frame, imgsz, groups)
        tracks = tracker.update(persons, frame) if len(persons) else np.empty((0, 8))
        dets = []
        for x1, y1, x2, y2, tid, _score, c, *_ in tracks:
            tid = int(tid)
            dets.append((tid, float(x1), float(y1), float(x2), float(y2)))
            if int(c) in groups[2]:
                referee_ids.add(tid)
            col = _torso_colour(frame, (x1, y1, x2, y2))
            if col is not None:
                bucket = track_colours.setdefault(tid, [])
                if len(bucket) < 30:
                    bucket.append(col)
            else:
                track_colours.setdefault(tid, [])
        raw.append((round(idx / src_fps, 3), dets, ball))
        if sample in key_slots:
            keyframes[sample] = frame.copy()

        sample += 1
        idx += 1
        if sample % 5 == 0:
            progress(min(0.98, sample / expected))
    cap.release()

    if not raw:
        raise ValueError("No frames could be read from the video.")
    return _build_result(raw, W, H, fps, src_fps, track_colours, referee_ids, keyframes, t0, imgsz)


def analyze_image(path):
    t0 = time.time()
    model = get_model()
    groups = _class_groups(model)
    frame = cv2.imread(path)
    if frame is None:
        raise ValueError("Could not read the image.")
    if frame.shape[1] > WORK_WIDTH:
        s = WORK_WIDTH / frame.shape[1]
        frame = cv2.resize(frame, (WORK_WIDTH, int(frame.shape[0] * s)), interpolation=cv2.INTER_AREA)
    H, W = frame.shape[:2]
    persons, ball = _detect(model, frame, 960, groups)
    dets, colours, referee_ids = [], {}, set()
    for i, (box, c) in enumerate(zip(persons.xyxy, persons.cls.astype(int)), start=1):
        dets.append((i, *map(float, box)))
        col = _torso_colour(frame, box)
        colours[i] = [col] if col is not None else []
        if c in groups[2]:
            referee_ids.add(i)
    return _build_result([(0.0, dets, ball)], W, H, 0, 0, colours, referee_ids, {0: frame}, t0, 960)


def _build_result(raw, W, H, fps, src_fps, track_colours, referee_ids, keyframes, t0, imgsz):
    teams, colours = _assign_teams(track_colours, referee_ids)
    balls = _interpolate_ball([[round(b[0] / W, 4), round(b[1] / H, 4)] if b else None for _, _, b in raw])

    frames = []
    for (t, dets, _), ball in zip(raw, balls):
        players = [
            [tid, teams.get(tid, -1), round((x1 + x2) / 2 / W, 4), round(y2 / H, 4), round((y2 - y1) / H, 4)]
            for tid, x1, y1, x2, y2 in dets
        ]
        frames.append({"t": t, "players": players, "ball": ball})

    shots = []
    calibration_frame = None
    for slot in sorted(keyframes):
        img = keyframes[slot]
        t, dets, _ = raw[slot]
        shots.append({"t": t, "image": _encode_jpeg(_annotate(img, dets, balls[slot], teams, colours))})
    if keyframes:
        mid = sorted(keyframes)[len(keyframes) // 2]
        calibration_frame = _encode_jpeg(keyframes[mid])

    presence = {}
    for f in frames:
        for p in f["players"]:
            presence[p[0]] = presence.get(p[0], 0) + 1
    return {
        "version": 1,
        "model": os.path.basename(WEIGHTS),
        "imgsz": imgsz,
        "width": W,
        "height": H,
        "fps": round(fps, 3),
        "sourceFps": round(src_fps, 3),
        "duration": frames[-1]["t"] - frames[0]["t"] if len(frames) > 1 else 0,
        "teamColors": colours,
        "tracks": {str(i): {"team": teams.get(i, -1), "frames": n} for i, n in presence.items()},
        "ballDetectionRate": round(sum(b is not None for b in balls) / len(balls), 3),
        "frames": frames,
        "keyframes": shots,
        "calibrationFrame": calibration_frame,
        "processingSeconds": round(time.time() - t0, 1),
    }
