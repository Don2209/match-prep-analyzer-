import { describe, expect, it } from "vitest";
import { analyze } from "@/lib/analytics/analyze";
import { homography, hullArea, partition1d } from "@/lib/analytics/geometry";
import type { PlayerRow, TrackingResult } from "@/lib/types";

/**
 * Synthetic 20 s clip at 5 fps, uncalibrated (x*105, y*68).
 * Team 0 sits in a 4-4-2 on the left half and has the ball for the first 15 s;
 * team 1 sits in a 4-3-3 on the right half.
 */
function synthetic(): TrackingResult {
  const t0 = [10, 30, 30, 30, 30, 45, 45, 45, 45, 58, 58]; // GK + 4-4-2 depths (m)
  const t1 = [95, 75, 75, 75, 75, 62, 62, 62, 52, 52, 52]; // GK + 4-3-3 (mirrored)
  const lanes = (n: number) => Array.from({ length: n }, (_, i) => ((i + 1) * 68) / (n + 1));
  const ys0 = [34, ...lanes(4), ...lanes(4), ...lanes(2)];
  const ys1 = [34, ...lanes(4), ...lanes(3), ...lanes(3)];
  const frames = Array.from({ length: 100 }, (_, i) => {
    const t = i / 5;
    const drift = Math.sin(t) * 0.5;
    const players: PlayerRow[] = [
      ...t0.map((x, k) => [k + 1, 0, (x + drift) / 105, ys0[k] / 68, 0.1] as PlayerRow),
      ...t1.map((x, k) => [k + 20, 1, (x + drift) / 105, ys1[k] / 68, 0.1] as PlayerRow),
    ];
    // Ball at the feet of team-0 striker for 15 s, then a team-1 striker.
    const ball: [number, number] = t < 15 ? [(58 + drift) / 105, ys0[9] / 68] : [(52 + drift) / 105, ys1[8] / 68];
    return { t, players, ball };
  });
  return {
    version: 1, model: "test", imgsz: 640, width: 1280, height: 720, fps: 5, sourceFps: 25, duration: 19.8,
    teamColors: ["#ff0000", "#0000ff"], tracks: {}, ballDetectionRate: 1, frames, processingSeconds: 0,
  };
}

describe("geometry", () => {
  it("homography maps the unit square onto a pitch rectangle", () => {
    const H = homography([[0, 0], [1, 0], [1, 1], [0, 1]], [[0, 0], [105, 0], [105, 68], [0, 68]]);
    const [x, y] = H([0.5, 0.5]);
    expect(x).toBeCloseTo(52.5);
    expect(y).toBeCloseTo(34);
  });
  it("hull area of a square", () => {
    expect(hullArea([[0, 0], [10, 0], [10, 10], [0, 10], [5, 5]])).toBeCloseTo(100);
  });
  it("partitions into lines", () => {
    expect(partition1d([1, 1, 1, 1, 5, 5, 5, 9, 9, 9], 3).sizes).toEqual([4, 3, 3]);
  });
});

describe("analyze", () => {
  const report = analyze(synthetic(), { ourTeam: 0, ourName: "Us", oppName: "Them", ourDirection: "ltr" });

  it("splits possession 75/25", () => {
    expect(report.teams.ours.possessionPct).toBeCloseTo(75, 0);
    expect((report.teams.ours.possessionPct ?? 0) + (report.teams.opp.possessionPct ?? 0)).toBeCloseTo(100, 0);
  });
  it("detects formations", () => {
    expect(report.teams.ours.formation.shape).toBe("4-4-2");
    expect(report.teams.opp.formation.shape).toBe("4-3-3");
  });
  it("measures line height from own goal for both sides", () => {
    expect(report.teams.ours.shape.defLine).toBeCloseTo(30, 0);
    expect(report.teams.opp.shape.defLine).toBeCloseTo(30, 0);
  });
  it("flipping attack direction mirrors the picture but not the metrics", () => {
    const flipped = analyze(synthetic(), { ourTeam: 1, ourName: "Us", oppName: "Them", ourDirection: "rtl" });
    expect(flipped.teams.ours.formation.shape).toBe("4-3-3");
    expect(flipped.teams.ours.shape.defLine).toBeCloseTo(30, 0);
    expect(flipped.teams.ours.avgPositions.every((p) => p.x < 55)).toBe(true);
  });
  it("produces insights and a timeline", () => {
    expect(report.insights.length).toBeGreaterThan(0);
    expect(report.timeline.length).toBe(20);
  });
  it("hides ball-based and shape claims when the data can't support them", () => {
    const t = synthetic();
    t.ballDetectionRate = 0.05;
    const r = analyze(t, { ourTeam: 0, ourName: "Us", oppName: "Them", ourDirection: "ltr" });
    expect(r.meta.ballReliable).toBe(false);
    expect(r.teams.ours.possessionPct).toBeNull();
    expect(r.insights.every((i) => i.about === "data" || i.kind === "info")).toBe(true);
  });
});
