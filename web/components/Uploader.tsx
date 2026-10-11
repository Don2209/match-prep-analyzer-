"use client";

import { useEffect, useRef, useState } from "react";
import { processMedia } from "@/lib/pipeline";
import type { TrackingResult } from "@/lib/types";

type Phase = "idle" | "running" | "error";

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
  const abort = useRef<AbortController>();
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => () => abort.current?.abort(), []);

  const busy = phase === "running";

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

  async function start() {
    if (!file) return;
    abort.current = new AbortController();
    setPhase("running");
    setProgress(0);
    setMessage("Opening the clip…");
    try {
      const result = await processMedia(file, {
        accurate,
        signal: abort.current.signal,
        onProgress: ({ stage, done, total }) => {
          setProgress(stage === "reading" ? 0.02 : done / total);
          setMessage(
            stage === "finishing"
              ? "Splitting teams by jersey colour…"
              : stage === "reading"
                ? "Warming up the YOLOv8 model…"
                : `YOLOv8 detecting players & ball: frame ${done} of ${total}`,
          );
        },
      });
      setPhase("idle");
      setProgress(1);
      onTracking(result, file.name.replace(/\.[^.]+$/, ""));
    } catch (e) {
      if ((e as Error).name === "AbortError") {
        setPhase("idle");
        setMessage("");
        return;
      }
      setPhase("error");
      setMessage(e instanceof Error ? e.message : "Processing failed.");
    }
  }

  return (
    <section className="card">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">1 · Upload footage</h2>
        <span className="text-xs text-muted">Video up to 3 min (first 3 min used), or a single frame</span>
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
          Accurate mode (960 px, catches small and distant players and the ball, about 2× slower)
        </label>
        {busy && (
          <button className="btn-ghost" onClick={() => abort.current?.abort()}>
            Cancel
          </button>
        )}
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
            <p className="mt-1 text-xs text-muted">
              Frames are read in your browser, and the model runs on the server. A 1-minute clip takes about 1–3 min. Keep this tab open.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
