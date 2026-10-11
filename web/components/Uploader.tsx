"use client";

import { useEffect, useRef, useState } from "react";
import { drawOverlay } from "@/lib/overlay";
import { LiveFrame, processMedia } from "@/lib/pipeline";
import type { TrackingResult } from "@/lib/types";

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

type Phase = "idle" | "running" | "error";

const ACCEPT = "video/mp4,video/quicktime,video/webm,video/x-matroska,image/jpeg,image/png,image/webp,.json";

export function Uploader({
  onTracking,
  onDemo,
}: {
  onTracking: (t: TrackingResult, name: string, file?: File) => void;
  onDemo: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [accurate, setAccurate] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const [drag, setDrag] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [live, setLive] = useState<{ t: number; duration: number; players: number; ball: boolean } | null>(null);
  const abort = useRef<AbortController>();
  const input = useRef<HTMLInputElement>(null);
  const liveCanvas = useRef<HTMLCanvasElement>(null);
  const latest = useRef<LiveFrame | null>(null);
  const raf = useRef(0);

  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  /** Paint the most recently analysed frame (at most once per animation frame). */
  function paint() {
    raf.current = 0;
    const f = latest.current;
    const c = liveCanvas.current;
    if (!f || !c) return;
    if (c.width !== f.img.width || c.height !== f.img.height) {
      c.width = f.img.width;
      c.height = f.img.height;
    }
    const ctx = c.getContext("2d")!;
    ctx.putImageData(f.img, 0, 0);
    drawOverlay(ctx, f.players, f.ball);
    setLive({ t: f.t, duration: f.duration, players: f.players.length, ball: !!f.ball });
  }

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
    setLive(null);
    setPhase("idle");
    setMessage("");
  }

  async function start() {
    if (!file) return;
    abort.current = new AbortController();
    setPhase("running");
    setProgress(0);
    setLive(null);
    latest.current = null;
    setMessage("Opening the clip…");
    try {
      const result = await processMedia(file, {
        accurate,
        signal: abort.current.signal,
        onFrame: (f) => {
          latest.current = f;
          if (!raf.current) raf.current = requestAnimationFrame(paint);
        },
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
      onTracking(result, file.name.replace(/\.[^.]+$/, ""), file);
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

      {busy ? (
        <div className="relative mt-4 overflow-hidden rounded-xl border border-line bg-black">
          <canvas ref={liveCanvas} className={`block w-full ${live ? "" : "hidden"}`} aria-label="Live analysis preview" />
          {!live && (
            <div className="flex aspect-video items-center justify-center text-sm text-white/70">Waiting for the first detections…</div>
          )}
          {live && (
            <div className="absolute left-3 top-3 flex flex-wrap items-center gap-2 text-xs font-medium text-white">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1">
                <span className="h-2 w-2 animate-pulse rounded-full bg-[#e34948]" />
                ANALYZING {clock(live.t)} / {clock(live.duration)}
              </span>
              <span className="rounded-full bg-black/60 px-2.5 py-1">{live.players} tracked</span>
              <span className="rounded-full bg-black/60 px-2.5 py-1">{live.ball ? "ball ▼" : "ball not seen"}</span>
            </div>
          )}
        </div>
      ) : file && previewUrl && !file.name.endsWith(".json") ? (
        <div className="mt-4">
          <div className="overflow-hidden rounded-xl border border-line bg-black">
            {file?.type.startsWith("video/") ? (
              <video src={previewUrl} controls muted playsInline className="block max-h-[480px] w-full" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previewUrl} alt="Selected frame" className="block max-h-[480px] w-full object-contain" />
            )}
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
            <span>
              {file.name} · {(file.size / 1024 / 1024).toFixed(1)} MB
            </span>
            <button className="text-accent underline" onClick={() => input.current?.click()}>
              Choose a different file
            </button>
          </div>
        </div>
      ) : (
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
      )}
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
