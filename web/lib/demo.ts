import type { PlayerRow, TrackingFrame, TrackingResult } from "./types";

/** Seeded PRNG so the demo is identical on every load. */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const lanes = (n: number, spread = 52) => Array.from({ length: n }, (_, i) => 34 - spread / 2 + ((i + 0.5) * spread) / n);

/**
 * A synthetic 60 s, 5 fps tracking result: team 0 in a 4-3-3 attacking left→right,
 * team 1 in a 4-4-2 with a high line that builds up mostly down its left side.
 */
export function demoTracking(): TrackingResult {
  const rand = rng(7);
  const fps = 5;
  const n = 60 * fps;
  const home: [number, number][] = [[5, 34], ...lanes(4).map((y) => [24, y] as [number, number]), ...lanes(3, 40).map((y) => [40, y] as [number, number]), ...lanes(3, 50).map((y) => [58, y] as [number, number])];
  const away: [number, number][] = [[100, 34], ...lanes(4).map((y) => [64, y] as [number, number]), ...lanes(4).map((y) => [52, y] as [number, number]), ...lanes(2, 20).map((y) => [40, y] as [number, number])];
  const teams = [home, away];

  let owner = 1;
  let carrier = 5;
  let nextSwitch = 6;
  let nextPass = 1.5;
  let ball: [number, number] = [52.5, 34];
  let target: [number, number] = [52.5, 34];
  const frames: TrackingFrame[] = [];

  for (let i = 0; i < n; i++) {
    const t = i / fps;
    const shiftX = (ball[0] - 52.5) * 0.35;
    const shiftY = (ball[1] - 34) * 0.25;
    const pos = teams.map((team, k) =>
      team.map(([x, y], j) => {
        const gk = j === 0;
        const wob = Math.sin(t * 0.9 + j * 1.7 + k) * 1.6;
        return [
          Math.min(103, Math.max(2, x + (gk ? shiftX * 0.15 : shiftX) + wob)),
          Math.min(66, Math.max(2, y + (gk ? 0 : shiftY) + Math.cos(t * 0.7 + j) * 1.4)),
        ] as [number, number];
      }),
    );

    if (t >= nextSwitch) {
      owner = 1 - owner;
      carrier = 1 + Math.floor(rand() * 10);
      nextSwitch = t + 4 + rand() * 7;
    }
    if (t >= nextPass) {
      // The away team favours its left flank (high y on screen, since it attacks right→left).
      const pool = Array.from({ length: 10 }, (_, j) => j + 1).filter((j) => j !== carrier);
      const weighted = owner === 1 ? pool.filter((j) => pos[1][j][1] > 38 || rand() < 0.35) : pool;
      carrier = weighted[Math.floor(rand() * weighted.length)] ?? pool[0];
      nextPass = t + 1 + rand() * 1.5;
    }
    target = pos[owner][carrier];
    ball = [ball[0] + (target[0] - ball[0]) * 0.6, ball[1] + (target[1] - ball[1]) * 0.6];

    const players: PlayerRow[] = [];
    pos.forEach((team, k) =>
      team.forEach(([x, y], j) => {
        if (rand() < 0.04) return; // occasional missed detection
        players.push([k * 20 + j + 1, k, +(x / 105).toFixed(4), +(y / 68).toFixed(4), 0.08]);
      }),
    );
    frames.push({ t: +t.toFixed(2), players, ball: rand() < 0.85 ? [+(ball[0] / 105).toFixed(4), +(ball[1] / 68).toFixed(4)] : null });
  }

  return {
    version: 1,
    model: "demo (synthetic)",
    imgsz: 640,
    width: 1280,
    height: 720,
    fps,
    sourceFps: 25,
    duration: frames[frames.length - 1].t,
    teamColors: ["#d32f2f", "#f5f5f5"],
    tracks: {},
    ballDetectionRate: frames.filter((f) => f.ball).length / frames.length,
    frames,
    keyframes: [],
    calibrationFrame: null,
    processingSeconds: 0,
  };
}
