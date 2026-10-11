import { SPACE_URL } from "./config";
import type { AnalysisConfig, Report, TrackingResult } from "./types";

export interface JobStatus {
  id: string;
  status: "queued" | "running" | "done" | "error";
  progress: number;
  queuePosition: number;
  error?: string | null;
  result?: TrackingResult;
}

/** Upload straight to the public Space (bypasses Vercel's 4.5 MB body limit). */
export function uploadClip(file: File, accurate: boolean, onProgress: (p: number) => void): Promise<{ id: string }> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("file", file);
    form.append("accurate", String(accurate));
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${SPACE_URL}/jobs`);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let body: { id?: string; detail?: string } = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {}
      if (xhr.status >= 200 && xhr.status < 300 && body.id) resolve({ id: body.id });
      else reject(new Error(body.detail || `Upload failed (HTTP ${xhr.status}). The model may still be waking up, so try again in a minute.`));
    };
    xhr.onerror = () => reject(new Error("Could not reach the model service. It may be waking up, so try again in a minute."));
    xhr.send(form);
  });
}

export async function getJob(id: string): Promise<JobStatus> {
  const res = await fetch(`${SPACE_URL}/jobs/${id}`, { cache: "no-store" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.detail || `Job lookup failed (HTTP ${res.status}).`);
  return body as JobStatus;
}

export async function runAnalysis(tracking: TrackingResult, config: AnalysisConfig): Promise<Report> {
  // Images are only needed in the browser, so don't ship them to the API.
  const { keyframes: _k, calibrationFrame: _c, ...slim } = tracking;
  const res = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tracking: slim, config }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Analysis failed (HTTP ${res.status}).`);
  return body as Report;
}
