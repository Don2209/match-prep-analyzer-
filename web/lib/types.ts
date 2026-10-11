/** [trackId, team (0 | 1 | -1 = other), x, y (foot point), boxHeight], all normalised 0..1 */
export type PlayerRow = [number, number, number, number, number];

export interface TrackingFrame {
  t: number;
  players: PlayerRow[];
  ball: [number, number] | null;
}

export interface TrackingResult {
  version: number;
  model: string;
  imgsz: number;
  width: number;
  height: number;
  fps: number;
  sourceFps: number;
  duration: number;
  teamColors: [string, string];
  tracks: Record<string, { team: number; frames: number }>;
  ballDetectionRate: number;
  frames: TrackingFrame[];
  keyframes?: { t: number; image: string | null }[];
  calibrationFrame?: string | null;
  processingSeconds: number;
}

/** A rectangle on the pitch (metres). x runs along the 105 m length, y across the 68 m width. */
export interface PitchRegion {
  x0: number;
  y0: number;
  length: number;
  width: number;
}

export interface Calibration {
  /** Normalised image points clicked in order: top-left, top-right, bottom-right, bottom-left of the region. */
  image: [number, number][];
  region: PitchRegion;
}

export interface AnalysisConfig {
  ourTeam: 0 | 1;
  ourName: string;
  oppName: string;
  /** Direction our team attacks in the footage. */
  ourDirection: "ltr" | "rtl";
  calibration?: Calibration | null;
}

export type Split3<K extends string> = Record<K, number>;

export interface PlayerStat {
  id: number;
  seconds: number;
  distance: number;
  topSpeed: number;
  sprints: number;
  avgX: number;
  avgY: number;
}

export interface TeamReport {
  side: "ours" | "opp";
  name: string;
  jersey: string;
  possessionPct: number | null;
  avgVisible: number;
  formation: { shape: string | null; confidence: number; samples: number };
  avgPositions: { id: number; x: number; y: number; presence: number }[];
  shape: { width: number; depth: number; compactness: number; defLine: number; compactnessCv: number };
  heatmap: number[][];
  thirds: Split3<"def" | "mid" | "att">;
  channels: Split3<"left" | "center" | "right">;
  attackChannels: Split3<"left" | "center" | "right">;
  ballInAttThirdPct: number;
  pressing: { avgPressers: number; pressingRate: number };
  regains: { count: number; avgHeight: number; attThirdPct: number };
  turnoversOwnThird: number;
  players: PlayerStat[];
}

export interface TimelinePoint {
  t: number;
  oursDefLine: number | null;
  oppDefLine: number | null;
  oursCompact: number | null;
  oppCompact: number | null;
  possession: "ours" | "opp" | null;
}

export interface Insight {
  about: "ours" | "opp" | "data";
  kind: "strength" | "weakness" | "tip" | "info";
  title: string;
  text: string;
}

export interface Report {
  meta: {
    duration: number;
    frames: number;
    fps: number;
    calibrated: boolean;
    ballDetectionRate: number;
    model: string;
    generatedAt: string;
  };
  teams: { ours: TeamReport; opp: TeamReport };
  timeline: TimelinePoint[];
  insights: Insight[];
}

export const PITCH = { length: 105, width: 68 } as const;
export const HEAT_COLS = 12;
export const HEAT_ROWS = 8;
