/**
 * Lightweight ByteTrack-style multi-object tracker.
 * Two-stage association (confident detections first, then low-confidence ones) with
 * constant-velocity prediction. Matching uses IoU plus centre distance, because at
 * 3–5 fps small players often don't overlap their previous box.
 */
export type Box = [number, number, number, number];

export interface Det {
  box: Box;
  conf: number;
  cls: number;
}

export interface TrackOut {
  id: number;
  box: Box;
  cls: number;
}

interface Track {
  id: number;
  box: Box;
  vel: [number, number];
  cls: number;
  hits: number;
  lost: number;
}

const HIGH = 0.4;

function iou(a: Box, b: Box) {
  const w = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
  const h = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const inter = w * h;
  return inter / ((a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter + 1e-9);
}

const centre = (b: Box): [number, number] => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];

function affinity(t: Track, d: Det) {
  const overlap = iou(t.box, d.box);
  const [tx, ty] = centre(t.box);
  const [dx, dy] = centre(d.box);
  const h = Math.max(t.box[3] - t.box[1], d.box[3] - d.box[1], 1);
  const near = 1 - Math.hypot(tx - dx, ty - dy) / (1.5 * h); // 1 = same centre, 0 = 1.5 box heights away
  return Math.max(overlap, near * 0.8);
}

export class Tracker {
  private tracks: Track[] = [];
  private nextId = 1;
  private frame = 0;

  constructor(private maxLost: number) {}

  update(dets: Det[]): TrackOut[] {
    this.frame++;
    for (const t of this.tracks) {
      t.box = [t.box[0] + t.vel[0], t.box[1] + t.vel[1], t.box[2] + t.vel[0], t.box[3] + t.vel[1]];
    }
    const high = dets.filter((d) => d.conf >= HIGH);
    const low = dets.filter((d) => d.conf < HIGH);
    const matched = new Set<Track>();
    const out: TrackOut[] = [];

    const associate = (pool: Det[], minAffinity: number) => {
      const pairs: [number, Track, Det][] = [];
      for (const t of this.tracks) {
        if (matched.has(t)) continue;
        for (const d of pool) {
          const a = affinity(t, d);
          if (a >= minAffinity) pairs.push([a, t, d]);
        }
      }
      pairs.sort((x, y) => y[0] - x[0]);
      const used = new Set<Det>();
      for (const [, t, d] of pairs) {
        if (matched.has(t) || used.has(d)) continue;
        const [ox, oy] = centre(t.box);
        const [nx, ny] = centre(d.box);
        t.vel = [0.5 * t.vel[0] + 0.5 * (nx - ox), 0.5 * t.vel[1] + 0.5 * (ny - oy)];
        t.box = d.box;
        t.cls = d.cls;
        t.hits++;
        t.lost = 0;
        matched.add(t);
        used.add(d);
      }
      return pool.filter((d) => !used.has(d));
    };

    const unmatchedHigh = associate(high, 0.2);
    associate(low, 0.3);

    for (const t of this.tracks) {
      if (!matched.has(t)) {
        t.lost++;
        t.vel = [t.vel[0] * 0.5, t.vel[1] * 0.5];
      }
    }
    this.tracks = this.tracks.filter((t) => t.lost <= this.maxLost);
    for (const d of unmatchedHigh) {
      const t: Track = { id: this.nextId++, box: d.box, vel: [0, 0], cls: d.cls, hits: 1, lost: 0 };
      this.tracks.push(t);
      matched.add(t);
    }

    for (const t of this.tracks) {
      // New tracks must be seen twice (except on the first frame) to filter one-off false positives.
      if (matched.has(t) && t.lost === 0 && (t.hits >= 2 || this.frame === 1)) out.push({ id: t.id, box: t.box, cls: t.cls });
    }
    return out;
  }
}
