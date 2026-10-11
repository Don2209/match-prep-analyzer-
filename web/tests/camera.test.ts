import { describe, expect, it } from "vitest";
import { analyze } from "@/lib/analytics/analyze";
import { estimateShift, Thumb } from "@/lib/camera";
import type { PlayerRow, TrackingResult } from "@/lib/types";

const identity = { image: [[0, 0], [1, 0], [1, 1], [0, 1]] as [number, number][], region: { x0: 0, y0: 0, length: 105, width: 68 } };

/** Two standing players filmed by a camera panning right: in the image they drift left. */
function panning(withCamera: boolean): TrackingResult {
  const frames = Array.from({ length: 50 }, (_, i) => {
    const shift = -0.004 * i; // content moves left as the camera pans right
    const players: PlayerRow[] = [
      [1, 0, 0.4 + shift, 0.5, 0.1],
      [2, 1, 0.6 + shift, 0.5, 0.1],
    ];
    return { t: i / 5, players, ball: null };
  });
  return {
    version: 1, model: "test", imgsz: 640, width: 1280, height: 720, fps: 5, sourceFps: 25, duration: 9.8,
    teamColors: ["#f00", "#00f"], tracks: { "1": { team: 0, frames: 50 }, "2": { team: 1, frames: 50 } },
    ballDetectionRate: 0, frames, processingSeconds: 0, calibrationIndex: 0,
    camera: withCamera ? frames.map((_, i) => [-0.004 * i, 0] as [number, number]) : undefined,
  };
}

describe("camera motion", () => {
  it("recovers a synthetic pan between two thumbnails", () => {
    const w = 160, h = 90;
    const pattern = (x: number, y: number) => Math.sin(x * 0.37) * Math.cos(y * 0.23) + Math.sin((x + y) * 0.11);
    const make = (dx: number): Thumb => {
      const g = new Float32Array(w * h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) g[y * w + x] = pattern(x - dx, y);
      return { g, w, h };
    };
    const [sx, sy] = estimateShift(make(0), make(6));
    expect(sx * w).toBeCloseTo(6, 0);
    expect(Math.abs(sy * h)).toBeLessThan(0.6);
  });

  it("a player standing still while the camera pans covers ~0 m once compensated", () => {
    const cfg = { ourTeam: 0 as const, ourName: "A", oppName: "B", ourDirection: "ltr" as const, calibration: identity };
    const raw = analyze(panning(false), cfg).teams.ours.players[0];
    const fixed = analyze(panning(true), cfg).teams.ours.players[0];
    expect(raw.distance).toBeGreaterThan(15); // the pan looks like running
    expect(fixed.distance).toBeLessThan(1);
  });

  it("rates uncalibrated positions as low and flags the pan", () => {
    const r = analyze(panning(true), { ourTeam: 0, ourName: "A", oppName: "B", ourDirection: "ltr" });
    expect(r.meta.cameraPanned).toBe(true);
    expect(r.reliability.items.find((i) => i.area.startsWith("Heatmaps"))!.level).toBe("low");
    expect(r.reliability.overall).toBe("low");
  });
});

import { Tracker } from "@/lib/tracker";

describe("tracker", () => {
  it("doesn't hand a lost ID to a differently sized person elsewhere", () => {
    const tr = new Tracker(15, [1280, 720]);
    const big = (x: number) => ({ box: [x, 500, x + 60, 680] as [number, number, number, number], conf: 0.9, cls: 2 });
    let id = 0;
    for (let i = 0; i < 6; i++) id = tr.update([big(200 - i * 40)], [-40, 0])[0]?.id ?? id; // walks out on the left with the pan
    for (let i = 0; i < 4; i++) tr.update([], [-40, 0]);
    const small = { box: [400, 520, 430, 610] as [number, number, number, number], conf: 0.9, cls: 2 };
    tr.update([small], [-40, 0]);
    const out = tr.update([{ ...small, box: [395, 520, 425, 610] }], [-5, 0]);
    expect(out[0].id).not.toBe(id);
  });
});
