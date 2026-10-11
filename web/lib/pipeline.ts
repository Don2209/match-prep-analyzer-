"use client";

import { assignTeams, Lab, torsoColour } from "./teams";
import { Box, Tracker } from "./tracker";
import type { PlayerRow, TrackingResult } from "./types";

const BALL = 0;
const GOALKEEPER = 1;
const REFEREE = 3;
const WORK_WIDTH = 1280;
const MAX_SECONDS = 180;
const MAX_FRAMES = 600;
const TARGET_FPS = 5;
const BATCH = 4;
const CONCURRENCY = 3;

export interface Progress {
  stage: "reading" | "detecting" | "finishing";
  done: number;
  total: number;
}

type RawDet = [number, number, number, number, number, number];

interface Pending {
  t: number;
  img: ImageData;
  dets?: RawDet[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function detectBatch(images: string[], signal: AbortSignal): Promise<RawDet[][]> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
    try {
      const res = await fetch("/api/detect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ images, conf: 0.15 }),
        signal,
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) return body.detections;
      lastErr = new Error(body.error || `Detection failed (HTTP ${res.status})`);
    } catch (e) {
      if ((e as Error).name === "AbortError") throw e;
      lastErr = e;
    }
    await sleep(1500 * (attempt + 1)); // cold starts / transient 5xx
  }
  throw lastErr instanceof Error ? lastErr : new Error("Detection failed.");
}

/** Letterbox (top-left aligned) to `size` on the long side, padded to a multiple of 32. */
function letterbox(src: HTMLCanvasElement, size: number) {
  const s = size / Math.max(src.width, src.height);
  const w = Math.round(src.width * s), h = Math.round(src.height * s);
  const c = document.createElement("canvas");
  c.width = Math.ceil(w / 32) * 32;
  c.height = Math.ceil(h / 32) * 32;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "rgb(114,114,114)";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(src, 0, 0, w, h);
  return { data: c.toDataURL("image/jpeg", 0.85).split(",")[1], scale: s };
}

function workCanvas(w: number, h: number) {
  const s = Math.min(1, WORK_WIDTH / w);
  const c = document.createElement("canvas");
  c.width = Math.round(w * s);
  c.height = Math.round(h * s);
  return c;
}

function seek(video: HTMLVideoElement, t: number) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("The browser could not seek this video. Try converting it to MP4 (H.264).")), 15000);
    video.addEventListener("seeked", () => (clearTimeout(timer), resolve()), { once: true });
    video.currentTime = t;
  });
}

async function openVideo(file: File) {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = URL.createObjectURL(file);
  await new Promise<void>((resolve, reject) => {
    video.onloadeddata = () => resolve();
    video.onerror = () => reject(new Error("This browser can't decode that video. Use MP4 (H.264) or WebM."));
  });
  if (!Number.isFinite(video.duration)) {
    // Some WebM files report Infinity until you seek past the end.
    await seek(video, 1e7);
  }
  return video;
}

/** Runs the full detection + tracking + team-split pipeline and returns the tracking result. */
export async function processMedia(
  file: File,
  opts: { accurate: boolean; signal: AbortSignal; onProgress: (p: Progress) => void },
): Promise<TrackingResult> {
  const t0 = performance.now();
  const size = opts.accurate ? 960 : 640;
  const isImage = file.type.startsWith("image/");

  let canvas: HTMLCanvasElement;
  let times: number[];
  let fps = 0;
  let draw: (t: number) => Promise<void>;
  let cleanup = () => {};

  if (isImage) {
    const bmp = await createImageBitmap(file);
    canvas = workCanvas(bmp.width, bmp.height);
    times = [0];
    draw = async () => canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  } else {
    const video = await openVideo(file);
    cleanup = () => URL.revokeObjectURL(video.src);
    const duration = Math.min(video.duration, MAX_SECONDS);
    fps = Math.min(TARGET_FPS, MAX_FRAMES / Math.max(duration, 1));
    const n = Math.max(1, Math.floor(duration * fps));
    times = Array.from({ length: n }, (_, i) => +(i / fps).toFixed(3));
    canvas = workCanvas(video.videoWidth, video.videoHeight);
    draw = async (t) => {
      await seek(video, t);
      canvas.getContext("2d")!.drawImage(video, 0, 0, canvas.width, canvas.height);
    };
  }
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;

  const total = times.length;
  const keySlots = new Set(isImage ? [0] : [0.1, 0.5, 0.9].map((f) => Math.floor(total * f)));
  const keyframes = new Map<number, HTMLCanvasElement>();
  const pending = new Map<number, Pending>();
  const tracker = new Tracker(Math.max(5, Math.round(fps * 3)));
  const colours = new Map<number, Lab[]>();
  const roleVotes = new Map<number, [number, number]>(); // id → [referee/keeper votes, total]
  const raw: { t: number; dets: [number, Box][]; ball: [number, number] | null }[] = [];
  let next = 0; // next frame index to feed the tracker (must be in order)
  let detected = 0;

  const consume = () => {
    while (pending.get(next)?.dets) {
      const f = pending.get(next)!;
      pending.delete(next);
      const scale = size / Math.max(W, H);
      const boxes = f.dets!.map(([cls, conf, x1, y1, x2, y2]) => ({
        cls,
        conf,
        box: [x1 / scale, y1 / scale, x2 / scale, y2 / scale] as Box,
      }));
      const balls = boxes.filter((d) => d.cls === BALL).sort((a, b) => b.conf - a.conf);
      const people = boxes.filter((d) => d.cls !== BALL);
      const tracks = isImage
        ? people.filter((d) => d.conf >= 0.3).map((d, i) => ({ id: i + 1, box: d.box, cls: d.cls }))
        : tracker.update(people);
      const dets: [number, Box][] = [];
      for (const tr of tracks) {
        dets.push([tr.id, tr.box]);
        const v = roleVotes.get(tr.id) ?? [0, 0];
        roleVotes.set(tr.id, [v[0] + (tr.cls === REFEREE || tr.cls === GOALKEEPER ? 1 : 0), v[1] + 1]);
        const list = colours.get(tr.id) ?? [];
        if (list.length < 30) {
          const c = torsoColour(f.img, tr.box);
          if (c) list.push(c);
        }
        colours.set(tr.id, list);
      }
      const ball = balls[0] && balls[0].conf >= 0.15 ? balls[0].box : null;
      raw.push({ t: f.t, dets, ball: ball ? [(ball[0] + ball[2]) / 2 / W, (ball[1] + ball[3]) / 2 / H] : null });
      next++;
    }
  };

  const inflight = new Set<Promise<void>>();
  let batch: { idx: number; data: string }[] = [];
  const flush = () => {
    const items = batch;
    batch = [];
    const p = detectBatch(items.map((b) => b.data), opts.signal).then((res) => {
      items.forEach((b, k) => (pending.get(b.idx)!.dets = res[k] ?? []));
      detected += items.length;
      opts.onProgress({ stage: "detecting", done: detected, total });
      consume();
    });
    const tracked = p.finally(() => inflight.delete(tracked));
    inflight.add(tracked);
  };

  try {
    for (let i = 0; i < total; i++) {
      if (opts.signal.aborted) throw new DOMException("Cancelled", "AbortError");
      await draw(times[i]);
      pending.set(i, { t: times[i], img: ctx.getImageData(0, 0, W, H) });
      if (keySlots.has(i)) {
        const copy = document.createElement("canvas");
        copy.width = W;
        copy.height = H;
        copy.getContext("2d")!.drawImage(canvas, 0, 0);
        keyframes.set(i, copy);
      }
      batch.push({ idx: i, data: letterbox(canvas, size).data });
      if (detected === 0) opts.onProgress({ stage: "reading", done: i + 1, total });
      if (batch.length === BATCH || i === total - 1) {
        flush();
        while (inflight.size >= CONCURRENCY) await Promise.race(inflight);
      }
    }
    await Promise.all(inflight);
  } finally {
    cleanup();
  }

  opts.onProgress({ stage: "finishing", done: total, total });
  const others = new Set([...roleVotes].filter(([, [o, n]]) => o / n >= 0.5).map(([id]) => id));
  return buildResult(raw, W, H, fps, colours, others, keyframes, (performance.now() - t0) / 1000, size);
}

function interpolateBall(balls: ([number, number] | null)[], maxGap = 3) {
  const out = [...balls];
  let last = -1;
  out.forEach((b, i) => {
    if (!b) return;
    if (last >= 0 && i - last > 1 && i - last <= maxGap + 1) {
      const [x0, y0] = out[last]!;
      for (let k = 1; k < i - last; k++) {
        const f = k / (i - last);
        out[last + k] = [x0 + (b[0] - x0) * f, y0 + (b[1] - y0) * f];
      }
    }
    last = i;
  });
  return out;
}

/** Rings use fixed high-contrast colours (blue = jersey A, orange = jersey B, yellow = referee/keeper/unsure). */
const RING = ["#3987e5", "#eb6834"];

function annotate(src: HTMLCanvasElement, dets: [number, Box][], ball: [number, number] | null, teams: Map<number, number>) {
  const c = document.createElement("canvas");
  const s = Math.min(1, 960 / src.width);
  c.width = Math.round(src.width * s);
  c.height = Math.round(src.height * s);
  const ctx = c.getContext("2d")!;
  ctx.drawImage(src, 0, 0, c.width, c.height);
  ctx.lineWidth = 2;
  ctx.font = "bold 11px system-ui, sans-serif";
  ctx.textAlign = "center";
  for (const [id, [x1, y1, x2, y2]] of dets) {
    const team = teams.get(id) ?? -1;
    const col = team === 0 || team === 1 ? RING[team] : "#ffd400";
    const cx = ((x1 + x2) / 2) * s, foot = y2 * s, rx = Math.max(6, (x2 - x1) * 0.6 * s);
    ctx.strokeStyle = col;
    ctx.beginPath();
    ctx.ellipse(cx, foot, rx, 4, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = col;
    ctx.fillText(String(id), cx, y1 * s - 4);
  }
  if (ball) {
    const bx = ball[0] * c.width, by = ball[1] * c.height;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.moveTo(bx - 6, by - 16);
    ctx.lineTo(bx + 6, by - 16);
    ctx.lineTo(bx, by - 7);
    ctx.fill();
  }
  return c.toDataURL("image/jpeg", 0.75);
}

function buildResult(
  raw: { t: number; dets: [number, Box][]; ball: [number, number] | null }[],
  W: number,
  H: number,
  fps: number,
  colours: Map<number, Lab[]>,
  others: Set<number>,
  keyframes: Map<number, HTMLCanvasElement>,
  seconds: number,
  imgsz: number,
): TrackingResult {
  const { teams, teamColors } = assignTeams(colours, others);
  others.forEach((id) => teams.set(id, -1));
  const balls = interpolateBall(raw.map((r) => r.ball));
  const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

  const frames = raw.map((r, i) => ({
    t: r.t,
    players: r.dets.map(
      ([id, [x1, y1, x2, y2]]) => [id, teams.get(id) ?? -1, r4((x1 + x2) / 2 / W), r4(y2 / H), r4((y2 - y1) / H)] as PlayerRow,
    ),
    ball: balls[i] ? ([r4(balls[i]![0]), r4(balls[i]![1])] as [number, number]) : null,
  }));

  const tracks: TrackingResult["tracks"] = {};
  for (const f of frames)
    for (const [id, team] of f.players) {
      tracks[id] ??= { team, frames: 0 };
      tracks[id].frames++;
    }

  const slots = [...keyframes.keys()].sort((a, b) => a - b);
  const mid = slots[Math.floor(slots.length / 2)];
  return {
    version: 1,
    model: "YOLOv8s football (ONNX on Vercel)",
    imgsz,
    width: W,
    height: H,
    fps: Math.round(fps * 1000) / 1000,
    sourceFps: 0,
    duration: frames.length > 1 ? frames[frames.length - 1].t - frames[0].t : 0,
    teamColors,
    tracks,
    ballDetectionRate: Math.round((1000 * balls.filter(Boolean).length) / Math.max(1, balls.length)) / 1000,
    frames,
    keyframes: slots.filter((s) => raw[s]).map((s) => ({ t: raw[s].t, image: annotate(keyframes.get(s)!, raw[s].dets, balls[s], teams) })),
    calibrationFrame: mid !== undefined ? keyframes.get(mid)!.toDataURL("image/jpeg", 0.8) : null,
    processingSeconds: Math.round(seconds),
  };
}
