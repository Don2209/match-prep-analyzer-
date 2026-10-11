"use client";

import { useEffect, useRef, useState } from "react";
import { drawOverlay, OverlayPlayer } from "@/lib/overlay";
import type { TrackingFrame, TrackingResult } from "@/lib/types";

/** Index of the last frame with t <= time (frames are sorted by t). */
function frameAt(frames: TrackingFrame[], time: number) {
  let lo = 0, hi = frames.length - 1;
  if (time < frames[0].t) return -1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (frames[mid].t <= time) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/** Plays the original clip with tracking rings drawn on top, interpolated between analysed frames. */
export function Replay({ src, tracking }: { src: string; tracking: TrackingResult }) {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [show, setShow] = useState(true);

  useEffect(() => {
    let raf = 0;
    const frames = tracking.frames;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const v = video.current, c = canvas.current;
      if (!v || !c || !v.videoWidth || !frames.length) return;
      const s = Math.min(1, 1280 / v.videoWidth);
      const W = Math.round(v.videoWidth * s), H = Math.round(v.videoHeight * s);
      if (c.width !== W || c.height !== H) {
        c.width = W;
        c.height = H;
      }
      const ctx = c.getContext("2d")!;
      ctx.clearRect(0, 0, W, H);
      if (!show) return;

      const t = v.currentTime;
      const i = frameAt(frames, t);
      if (i < 0 || t > frames[frames.length - 1].t + 0.5) return;
      const a = frames[i], b = frames[i + 1];
      const k = b && b.t - a.t <= 1.2 ? Math.min(1, (t - a.t) / (b.t - a.t)) : 0;

      const next = new Map((b?.players ?? []).map((p) => [p[0], p]));
      const players: OverlayPlayer[] = [];
      for (const p of a.players) {
        const q = k > 0 ? next.get(p[0]) : undefined;
        if (!q && k >= 0.5) continue; // the track ended, so hide it once we're closer to the next frame
        const [x, y, h] = q ? [lerp(p[2], q[2], k), lerp(p[3], q[3], k), lerp(p[4], q[4], k)] : [p[2], p[3], p[4]];
        players.push({ id: p[0], team: p[1], cx: x * W, foot: y * H, height: h * H });
      }
      if (k >= 0.5 && b) {
        const seen = new Set(a.players.map((p) => p[0]));
        for (const q of b.players) if (!seen.has(q[0])) players.push({ id: q[0], team: q[1], cx: q[2] * W, foot: q[3] * H, height: q[4] * H });
      }
      let ball: [number, number] | null = null;
      if (a.ball && b?.ball && k > 0) ball = [lerp(a.ball[0], b.ball[0], k) * W, lerp(a.ball[1], b.ball[1], k) * H];
      else if (a.ball && k < 0.5) ball = [a.ball[0] * W, a.ball[1] * H];
      drawOverlay(ctx, players, ball);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [tracking, show]);

  return (
    <div>
      <div className="relative overflow-hidden rounded-xl border border-line bg-black">
        <video ref={video} src={src} controls muted playsInline className="block w-full" />
        <canvas ref={canvas} className="pointer-events-none absolute inset-0 h-full w-full" />
      </div>
      <label className="mt-2 flex items-center gap-2 text-xs text-ink2">
        <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} />
        Show tracking overlay. Blue and orange rings = the two teams, yellow = referee, keeper or unsure, ▼ = ball.
      </label>
    </div>
  );
}
