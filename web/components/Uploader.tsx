"use client";

import { useEffect, useRef, useState } from "react";
import { getJob, uploadClip } from "@/lib/client";
import type { TrackingResult } from "@/lib/types";

type Phase = "idle" | "uploading" | "queued" | "running" | "error";

const ACCEPT = "video/mp4,video/quicktime,video/webm,video/x-matroska,image/jpeg,image/png,image/webp,.json";

export function Uploader({
  onTracking,
  onDemo,
}: {
  onTracking: (t: TrackingResult, name: string) => void;
  onDemo: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [accurate, setAccurate] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const [drag, setDrag] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  const busy = phase === "uploading" || phase === "queued" || phase === "running";

  async function pick(f: File | undefined) {
    if (!f) return;
    if (f.name.endsWith(".json")) {
      try {
        const parsed = JSON.parse(await f.text());
        const tracking: TrackingResult = parsed.tracking ?? parsed;
        if (!tracking.frames) throw new Error();
        onTracking(tracking, f.name.replace(/\.json$/, ""));
      } catch {
        setPhase("error");
        setMessage("That JSON isn't a tracking export from this app.");
      }
      return;
    }
    setFile(f);
    setPhase("idle");
    setMessage("");
  }

  function poll(id: string) {
    timer.current = setTimeout(async () => {
      try {
        const job = await getJob(id);
        if (job.status === "done" && job.result) {
          setPhase("idle");
          setProgress(1);
          onTracking(job.result, file?.name.replace(/\.[^.]+$/, "") ?? "Clip");
          return;
        }
        if (job.status === "error") throw new Error(job.error || "Processing failed.");
        setPhase(job.status === "queued" ? "queued" : "running");
        setProgress(job.progress);
        setMessage(
          job.status === "queued"
            ? `Waiting in queue (${job.queuePosition} ahead)…`
            : `Detecting & tracking players… ${Math.round(job.progress * 100)}%`,
        );
        poll(id);
      } catch (e) {
        setPhase("error");
        setMessage(e instanceof Error ? e.message : "Lost contact with the model service.");
      }
    }, 2000);
  }

  async function start() {
    if (!file) return;
    setPhase("uploading");
    setProgress(0);
    setMessage("Uploading to the YOLOv8 service…");
    try {
      const { id } = await uploadClip(file, accurate, (p) => {
        setProgress(p);
        setMessage(`Uploading… ${Math.round(p * 100)}%`);
      });
      setPhase("queued");
      setProgress(0);
      setMessage("Queued for processing…");
      poll(id);
    } catch (e) {
      setPhase("error");
      setMessage(e instanceof Error ? e.message : "Upload failed.");
    }
  }

  return (
    <section className="card">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">1 · Upload footage</h2>
        <span className="text-xs text-muted">Video up to 3 min / 150 MB, or a single frame</span>
      </div>

      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          pick(e.dataTransfer.files[0]);
        }}
        disabled={busy}
        className={`mt-4 flex w-full flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-10 text-center transition ${
          drag ? "border-accent bg-surface2" : "border-line hover:border-ink2"
        }`}
      >
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="text-muted">
          <path d="M12 16V4m0 0-4 4m4-4 4 4M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="mt-3 text-sm font-medium">{file ? file.name : "Drop a match clip here or click to browse"}</span>
        <span className="mt-1 text-xs text-muted">
          {file
            ? `${(file.size / 1024 / 1024).toFixed(1)} MB`
            : "Wide tactical-camera footage gives the best results. MP4, MOV, WebM, JPG, PNG, or a saved tracking .json"}
        </span>
      </button>
      <input ref={input} type="file" accept={ACCEPT} className="hidden" onChange={(e) => pick(e.target.files?.[0])} />

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button className="btn-primary" onClick={start} disabled={!file || busy}>
          {busy ? "Processing…" : "Analyze with YOLOv8"}
        </button>
        <label className="flex items-center gap-2 text-sm text-ink2">
          <input type="checkbox" checked={accurate} onChange={(e) => setAccurate(e.target.checked)} disabled={busy} />
          Accurate mode (960 px, better ball detection, about 2× slower)
        </label>
        <button className="btn-ghost ml-auto" onClick={onDemo} disabled={busy}>
          Try demo data
        </button>
      </div>

      {(busy || phase === "error") && (
        <div className="mt-4" aria-live="polite">
          {busy && (
            <div className="h-2 w-full overflow-hidden rounded-full bg-surface2">
              <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${Math.max(3, progress * 100)}%` }} />
            </div>
          )}
          <p className={`mt-2 text-sm ${phase === "error" ? "text-[color:var(--bad)]" : "text-ink2"}`}>{message}</p>
          {phase === "running" && (
            <p className="mt-1 text-xs text-muted">The free CPU runs at about 2–4 min per 2-minute clip. You can leave this tab open.</p>
          )}
        </div>
      )}
    </section>
  );
}
