import type { Level, Reliability, Report, TrackingResult } from "../types";

const RANK: Record<Level, number> = { low: 0, medium: 1, high: 2 };
const min = (...ls: Level[]) => ls.reduce((a, b) => (RANK[b] < RANK[a] ? b : a));
const grade = (v: number, high: number, medium: number): Level => (v >= high ? "high" : v >= medium ? "medium" : "low");

/** How far each part of the report can be trusted, given the footage and setup. */
export function assessReliability(r: Report, tracking: TrackingResult): Reliability {
  const { calibrated, cameraPanned, ballDetectionRate } = r.meta;
  const isVideo = tracking.frames.length > 1;

  const position: Level = !calibrated ? "low" : cameraPanned ? "medium" : "high";
  const positionWhy = !calibrated
    ? "no pitch calibration, so positions come straight from the camera image"
    : cameraPanned
      ? "calibrated, but the camera pans (pans are corrected, zoom is not)"
      : "calibrated with a fixed camera";

  const visibleShare = (r.teams.ours.avgVisible + r.teams.opp.avgVisible) / 22;
  const visibility = grade(visibleShare, 0.8, 0.5);
  const visibleWhy = `on average ${Math.round(visibleShare * 22)} of 22 players are in view`;

  const trackSeconds = Object.values(tracking.tracks).map((t) => t.frames / Math.max(tracking.fps, 1e-9));
  const avgTrack = isVideo && trackSeconds.length ? trackSeconds.reduce((a, b) => a + b, 0) / trackSeconds.length : 0;
  const continuity: Level = isVideo ? grade(avgTrack, 8, 3) : "low";

  const ball = grade(ballDetectionRate, 0.4, 0.15);
  const unassigned = tracking.frames.reduce((n, f) => n + f.players.filter((p) => p[1] === -1).length, 0);
  const allDets = tracking.frames.reduce((n, f) => n + f.players.length, 0) || 1;
  const split: Level = grade(1 - unassigned / allDets, 0.85, 0.65);

  const items: Reliability["items"] = [
    {
      area: "Team split (jersey colours)",
      level: split,
      why: `${Math.round((100 * unassigned) / allDets)}% of detections couldn't be placed in a team. Check the replay rings.`,
    },
    {
      area: "Possession, pressing & regains",
      level: min(ball, position === "low" ? "medium" : position),
      why: `ball seen in ${Math.round(ballDetectionRate * 100)}% of frames`,
    },
    { area: "Shape, width & defensive line", level: min(position, visibility), why: `${positionWhy}; ${visibleWhy}` },
    {
      area: "Formation",
      level: r.teams.opp.formation.shape || r.teams.ours.formation.shape ? min(position, visibility) : "low",
      why: "needs all 10 outfield players of a team in view at once",
    },
    { area: "Heatmaps & territory", level: position, why: positionWhy },
    {
      area: "Player distance & speed",
      level: min(position, continuity),
      why: isVideo ? `players stay tracked for ${avgTrack.toFixed(1)} s on average before their ID changes` : "a single image has no movement",
    },
  ];
  const core = [items[0].level, items[2].level, items[4].level];
  return { overall: min(...core), items };
}
