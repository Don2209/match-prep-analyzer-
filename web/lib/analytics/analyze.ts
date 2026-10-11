import {
  AnalysisConfig,
  HEAT_COLS,
  HEAT_ROWS,
  PITCH,
  PlayerStat,
  Report,
  TeamReport,
  TimelinePoint,
  TrackingResult,
} from "../types";
import { dist, homography, hullArea, mean, partition1d, Pt, round, std } from "./geometry";
import { buildInsights } from "./insights";
import { assessReliability } from "./reliability";

type Side = "ours" | "opp";
const SIDES: Side[] = ["ours", "opp"];
const other = (s: Side): Side => (s === "ours" ? "opp" : "ours");

interface Body {
  id: number;
  p: Pt; // absolute pitch metres, our team attacking towards +x
}

interface Frame {
  t: number;
  bodies: Record<Side, Body[]>;
  ball: Pt | null;
  owner: Side | null;
}

interface FrameShape {
  width: number;
  depth: number;
  compact: number;
  defLine: number;
  formation: string | null;
}

const L = PITCH.length;
const W = PITCH.width;
const PRESS_RADIUS = 10;
const SPRINT_SPEED = 7; // m/s ≈ 25 km/h
const MAX_SPEED = 12; // faster than any human → tracking glitch

/** Express an absolute point in a team's own frame (team attacks towards +x, its left is low y). */
const teamFrame = (side: Side, p: Pt): Pt => (side === "ours" ? p : [L - p[0], W - p[1]]);

/** Camera pans larger than this (fraction of frame width) count as a moving camera. */
const PAN_THRESHOLD = 0.08;

export function cameraExtent(tracking: TrackingResult) {
  const cam = tracking.camera;
  if (!cam?.length) return 0;
  const xs = cam.map((c) => c[0]);
  return Math.max(...xs) - Math.min(...xs);
}

/**
 * Maps a normalised image point in frame `i` to absolute pitch metres (our team attacking +x).
 * Camera pans are undone first by shifting every point into the coordinates of the reference
 * (calibration) frame, so a static player stays put even when the camera follows play.
 */
function makeProjector(tracking: TrackingResult, cfg: AnalysisConfig): (p: Pt, i: number) => Pt | null {
  const cam = tracking.camera?.length === tracking.frames.length ? tracking.camera : null;
  const ref = cam ? cam[Math.min(tracking.calibrationIndex ?? 0, cam.length - 1)] : [0, 0];
  const stabilise = ([x, y]: Pt, i: number): Pt => (cam ? [x - cam[i][0] + ref[0], y - cam[i][1] + ref[1]] : [x, y]);

  let toPitch: (p: Pt) => Pt = ([x, y]) => [x * L, y * W];
  const cal = cfg.calibration;
  if (cal && cal.image.length === 4) {
    const { x0, y0, length, width } = cal.region;
    toPitch = homography(cal.image, [
      [x0, y0],
      [x0 + length, y0],
      [x0 + length, y0 + width],
      [x0, y0 + width],
    ]);
  } else if (cam && cameraExtent(tracking) > PAN_THRESHOLD) {
    // Uncalibrated panning footage: stretch the stitched "panorama" of player positions over the pitch.
    const xs: number[] = [], ys: number[] = [];
    tracking.frames.forEach((f, i) => f.players.forEach((p) => {
      const [x, y] = stabilise([p[2], p[3]], i);
      xs.push(x);
      ys.push(y);
    }));
    const q = (v: number[], f: number) => [...v].sort((a, b) => a - b)[Math.floor(f * (v.length - 1))];
    const [x0, x1, y0, y1] = [q(xs, 0.02), q(xs, 0.98), q(ys, 0.02), q(ys, 0.98)];
    toPitch = ([x, y]) => [((x - x0) / Math.max(1e-6, x1 - x0)) * L, ((y - y0) / Math.max(1e-6, y1 - y0)) * W];
  }
  const flip = cfg.ourDirection === "rtl";
  return (p, i) => {
    let [x, y] = toPitch(stabilise(p, i));
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    if (x < -3 || x > L + 3 || y < -3 || y > W + 3) return null; // off the pitch (bench, spectators, stands)
    x = Math.min(L, Math.max(0, x));
    y = Math.min(W, Math.max(0, y));
    return flip ? [L - x, W - y] : [x, y];
  };
}

function buildFrames(tracking: TrackingResult, cfg: AnalysisConfig, calibrated: boolean): Frame[] {
  const project = makeProjector(tracking, cfg);
  const ownRadius = calibrated ? 3.5 : 5;
  const carry = 1.5; // seconds a possession persists without a confirmed owner
  let lastOwner: Side | null = null;
  let lastOwnedAt = -Infinity;

  return tracking.frames.map((f, i) => {
    const bodies: Record<Side, Body[]> = { ours: [], opp: [] };
    for (const [id, team, x, y] of f.players) {
      if (team !== 0 && team !== 1) continue;
      const p = project([x, y], i);
      if (!p) continue;
      bodies[team === cfg.ourTeam ? "ours" : "opp"].push({ id, p });
    }
    const ball = f.ball ? project(f.ball, i) : null;

    let owner: Side | null = null;
    if (ball) {
      let best = Infinity;
      for (const s of SIDES)
        for (const b of bodies[s]) {
          const d = dist(b.p, ball);
          if (d < best) {
            best = d;
            owner = s;
          }
        }
      if (best > ownRadius) owner = null;
    }
    if (owner) {
      lastOwner = owner;
      lastOwnedAt = f.t;
    } else if (lastOwner && f.t - lastOwnedAt <= carry) {
      owner = lastOwner;
    }
    return { t: f.t, bodies, ball, owner };
  });
}

function frameShape(side: Side, bodies: Body[]): FrameShape | null {
  if (bodies.length < 4) return null;
  let pts = bodies.map((b) => teamFrame(side, b.p)).sort((a, b) => a[0] - b[0]);
  // A lone deepest player close to goal is treated as the goalkeeper.
  if (pts.length >= 5 && pts[0][0] < 25 && pts[1][0] - pts[0][0] > 12) pts = pts.slice(1);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);

  let formation: string | null = null;
  if (pts.length === 10) {
    const p3 = partition1d(xs, 3);
    const p4 = partition1d(xs, 4);
    const best = p4.sse < 0.55 * p3.sse ? p4 : p3;
    if (best.sizes[0] >= 3) formation = best.sizes.join("-");
  }
  return {
    width: Math.max(...ys) - Math.min(...ys),
    depth: xs[xs.length - 1] - xs[0],
    compact: hullArea(pts),
    defLine: mean(xs.slice(0, Math.min(4, xs.length))),
    formation,
  };
}

const pct = (n: number, total: number) => (total > 0 ? round((100 * n) / total) : 0);

function split3(counts: [number, number, number], keys: [string, string, string]) {
  const total = counts[0] + counts[1] + counts[2];
  return Object.fromEntries(keys.map((k, i) => [k, pct(counts[i], total)]));
}

const third = (x: number) => (x < L / 3 ? 0 : x < (2 * L) / 3 ? 1 : 2);
const channel = (y: number) => (y < W / 3 ? 0 : y < (2 * W) / 3 ? 1 : 2);

function playerStats(side: Side, frames: Frame[], fps: number): PlayerStat[] {
  const series = new Map<number, { t: number; p: Pt }[]>();
  for (const f of frames)
    for (const b of f.bodies[side]) {
      if (!series.has(b.id)) series.set(b.id, []);
      series.get(b.id)!.push({ t: f.t, p: b.p });
    }
  const dtMax = 1.0;
  const out: PlayerStat[] = [];
  for (const [id, rawSeries] of series) {
    const seconds = fps > 0 ? rawSeries.length / fps : 0;
    if (seconds < 3) continue;
    // ~1 s centred moving average: detection jitter would otherwise add phantom distance.
    const half = Math.max(1, Math.round(fps / 2));
    const s = rawSeries.map((pt, i) => {
      const win = rawSeries.slice(Math.max(0, i - half), i + half + 1).filter((q) => Math.abs(q.t - pt.t) <= 1);
      return { t: pt.t, p: [mean(win.map((q) => q.p[0])), mean(win.map((q) => q.p[1]))] as Pt };
    });
    let distance = 0;
    const speeds: { t: number; v: number; dt: number }[] = [];
    for (let i = 1; i < s.length; i++) {
      const dt = s[i].t - s[i - 1].t;
      if (dt <= 0 || dt > dtMax) continue;
      const d = dist(s[i].p, s[i - 1].p);
      const v = d / dt;
      if (v > MAX_SPEED) continue;
      distance += d;
      speeds.push({ t: s[i].t, v, dt });
    }
    // 3-sample rolling mean smooths detection jitter before peak / sprint detection.
    const smooth = speeds.map((_, i) => mean(speeds.slice(Math.max(0, i - 1), i + 2).map((x) => x.v)));
    let sprints = 0;
    let run = 0;
    let counted = false;
    smooth.forEach((v, i) => {
      if (v >= SPRINT_SPEED) {
        run += speeds[i].dt;
        if (run >= 1 && !counted) {
          sprints++;
          counted = true;
        }
      } else {
        run = 0;
        counted = false;
      }
    });
    out.push({
      id,
      seconds: round(seconds),
      distance: Math.round(distance),
      topSpeed: round((smooth.length ? Math.max(...smooth) : 0) * 3.6),
      sprints,
      avgX: round(mean(s.map((x) => x.p[0]))),
      avgY: round(mean(s.map((x) => x.p[1]))),
    });
  }
  return out.sort((a, b) => b.distance - a.distance).slice(0, 14);
}

function teamReport(side: Side, frames: Frame[], cfg: AnalysisConfig, tracking: TrackingResult): TeamReport {
  const opp = other(side);
  const shapes = frames.map((f) => frameShape(side, f.bodies[side])).filter((s): s is FrameShape => !!s);

  // Formation: most common line structure among frames where all 10 outfielders are visible.
  const counts = new Map<string, number>();
  for (const s of shapes) if (s.formation) counts.set(s.formation, (counts.get(s.formation) ?? 0) + 1);
  const samples = [...counts.values()].reduce((a, b) => a + b, 0);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  const formation =
    top && samples >= 5
      ? { shape: top[0], confidence: round((100 * top[1]) / samples), samples }
      : { shape: null, confidence: 0, samples };

  const heat = Array.from({ length: HEAT_ROWS }, () => new Array(HEAT_COLS).fill(0));
  const thirds: [number, number, number] = [0, 0, 0];
  const chans: [number, number, number] = [0, 0, 0];
  const presence = new Map<number, Pt[]>();
  for (const f of frames)
    for (const b of f.bodies[side]) {
      const c = Math.min(HEAT_COLS - 1, Math.floor((b.p[0] / L) * HEAT_COLS));
      const r = Math.min(HEAT_ROWS - 1, Math.floor((b.p[1] / W) * HEAT_ROWS));
      heat[r][c]++;
      const tp = teamFrame(side, b.p);
      thirds[third(tp[0])]++;
      chans[channel(tp[1])]++;
      if (!presence.has(b.id)) presence.set(b.id, []);
      presence.get(b.id)!.push(b.p);
    }
  const heatMax = Math.max(1, ...heat.flat());

  const minPresence = Math.max(3, 0.15 * frames.length);
  const avgPositions = [...presence.entries()]
    .filter(([, ps]) => ps.length >= minPresence)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 11)
    .map(([id, ps]) => ({
      id,
      x: round(mean(ps.map((p) => p[0]))),
      y: round(mean(ps.map((p) => p[1]))),
      presence: round(ps.length / frames.length, 2),
    }));

  // In possession: where does the ball go?
  const attack: [number, number, number] = [0, 0, 0];
  let ownedWithBall = 0;
  let ballAttThird = 0;
  // Out of possession: how many players close down the ball?
  const pressers: number[] = [];
  for (const f of frames) {
    if (!f.ball) continue;
    if (f.owner === side) {
      const b = teamFrame(side, f.ball);
      ownedWithBall++;
      if (b[0] >= (2 * L) / 3) ballAttThird++;
      if (b[0] >= L / 3) attack[channel(b[1])]++;
    } else if (f.owner === opp) {
      pressers.push(f.bodies[side].filter((x) => dist(x.p, f.ball!) <= PRESS_RADIUS).length);
    }
  }

  const regainsAt = regainPositions(frames, side);
  const conceded = regainPositions(frames, opp).filter((p) => teamFrame(opp, p)[0] >= (2 * L) / 3).length;

  const owned = frames.filter((f) => f.owner).length;
  const ballOk = ballReliable(tracking, owned);
  const compacts = shapes.map((s) => s.compact);
  return {
    side,
    name: side === "ours" ? cfg.ourName : cfg.oppName,
    jersey: tracking.teamColors[side === "ours" ? cfg.ourTeam : ((1 - cfg.ourTeam) as 0 | 1)] ?? "#888888",
    possessionPct: ballOk ? pct(frames.filter((f) => f.owner === side).length, owned) : null,
    avgVisible: round(mean(frames.map((f) => f.bodies[side].length))),
    formation,
    avgPositions,
    shape: {
      width: round(mean(shapes.map((s) => s.width))),
      depth: round(mean(shapes.map((s) => s.depth))),
      compactness: Math.round(mean(compacts)),
      defLine: round(mean(shapes.map((s) => s.defLine))),
      compactnessCv: compacts.length ? round(std(compacts) / Math.max(1, mean(compacts)), 2) : 0,
    },
    heatmap: heat.map((row) => row.map((v) => round(v / heatMax, 3))),
    thirds: split3(thirds, ["def", "mid", "att"]) as TeamReport["thirds"],
    channels: split3(chans, ["left", "center", "right"]) as TeamReport["channels"],
    attackChannels: split3(attack, ["left", "center", "right"]) as TeamReport["attackChannels"],
    ballInAttThirdPct: pct(ballAttThird, ownedWithBall),
    pressing: {
      avgPressers: round(mean(pressers)),
      pressingRate: pct(pressers.filter((n) => n >= 2).length, pressers.length),
    },
    regains: {
      count: regainsAt.length,
      avgHeight: round(mean(regainsAt.map((p) => teamFrame(side, p)[0]))),
      attThirdPct: pct(regainsAt.filter((p) => teamFrame(side, p)[0] >= (2 * L) / 3).length, regainsAt.length),
    },
    turnoversOwnThird: conceded,
    players: playerStats(side, frames, tracking.fps),
  };
}

export const MIN_BALL_RATE = 0.15;
const MIN_OWNED_FRAMES = 25;
const ballReliable = (t: TrackingResult, owned: number) => t.ballDetectionRate >= MIN_BALL_RATE && owned >= MIN_OWNED_FRAMES;

/** Ball positions (absolute) where `side` won possession and kept it for at least 0.6 s. */
function regainPositions(frames: Frame[], side: Side): Pt[] {
  const out: Pt[] = [];
  let prev: Side | null = null;
  for (let i = 0; i < frames.length; i++) {
    const o = frames[i].owner;
    if (!o) continue;
    if (o === side && prev === other(side)) {
      let j = i;
      while (j + 1 < frames.length && frames[j + 1].owner === side) j++;
      const ball = frames[i].ball;
      if (frames[j].t - frames[i].t >= 0.6 && ball) out.push(ball);
    }
    prev = o;
  }
  return out;
}

function timeline(frames: Frame[]): TimelinePoint[] {
  const buckets = new Map<number, Frame[]>();
  for (const f of frames) {
    const k = Math.floor(f.t);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k)!.push(f);
  }
  const agg = (fs: Frame[], side: Side, key: "defLine" | "compact") => {
    const vals = fs.map((f) => frameShape(side, f.bodies[side])).filter(Boolean).map((s) => s![key]);
    return vals.length ? round(mean(vals), key === "compact" ? 0 : 1) : null;
  };
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, fs]) => {
      const ours = fs.filter((f) => f.owner === "ours").length;
      const opp = fs.filter((f) => f.owner === "opp").length;
      return {
        t,
        oursDefLine: agg(fs, "ours", "defLine"),
        oppDefLine: agg(fs, "opp", "defLine"),
        oursCompact: agg(fs, "ours", "compact"),
        oppCompact: agg(fs, "opp", "compact"),
        possession: ours === 0 && opp === 0 ? null : ours >= opp ? "ours" : "opp",
      };
    });
}

export function analyze(tracking: TrackingResult, cfg: AnalysisConfig): Report {
  if (!tracking?.frames?.length) throw new Error("Tracking data has no frames.");
  const calibrated = !!(cfg.calibration && cfg.calibration.image?.length === 4);
  const frames = buildFrames(tracking, cfg, calibrated);
  const teams = {
    ours: teamReport("ours", frames, cfg, tracking),
    opp: teamReport("opp", frames, cfg, tracking),
  };
  const meta = {
    duration: round(tracking.duration),
    frames: frames.length,
    fps: tracking.fps,
    calibrated,
    ballReliable: ballReliable(tracking, frames.filter((f) => f.owner).length),
    ballDetectionRate: tracking.ballDetectionRate,
    cameraPanned: cameraExtent(tracking) > PAN_THRESHOLD,
    model: tracking.model,
    generatedAt: new Date().toISOString(),
  };
  const report: Report = { meta, teams, timeline: timeline(frames), insights: [], reliability: { overall: "low", items: [] } };
  report.reliability = assessReliability(report, tracking);
  report.insights = buildInsights(report);
  return report;
}
