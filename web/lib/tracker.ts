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
  // The same player can't suddenly be half or double the size between frames.
  const ratio = (d.box[3] - d.box[1]) / Math.max(1, t.box[3] - t.box[1]);
  if (ratio < 0.6 || ratio > 1.67) return 0;
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

  constructor(
    private maxLost: number,
    private frameSize?: [number, number],
  ) {}

  /**
   * @param camera content shift since the previous frame in pixels (camera-motion compensation):
   * every track is moved with the camera before its own velocity is applied, so a pan doesn't
   * look like all players sprinting the same way and IDs don't hop between neighbours.
   */
  update(dets: Det[], camera: [number, number] = [0, 0]): TrackOut[] {
    this.frame++;
    for (const t of this.tracks) {
      const dx = t.vel[0] + camera[0], dy = t.vel[1] + camera[1];
      t.box = [t.box[0] + dx, t.box[1] + dy, t.box[2] + dx, t.box[3] + dy];
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
        const [ox, oy] = centre(t.box); // predicted (camera + velocity) position
        const [nx, ny] = centre(d.box);
        // Velocity is the player's own motion: the prediction already contained it, so add the residual.
        t.vel = [t.vel[0] + 0.5 * (nx - ox), t.vel[1] + 0.5 * (ny - oy)];
        const cap = 0.6 * (d.box[3] - d.box[1]); // nobody covers more than ~1 m per sampled frame
        const speed = Math.hypot(t.vel[0], t.vel[1]);
        if (speed > cap) t.vel = [(t.vel[0] * cap) / speed, (t.vel[1] * cap) / speed];
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
    const inFrame = (t: Track) => {
      if (!this.frameSize) return true;
      const [cx, cy] = centre(t.box);
      return cx >= 0 && cx <= this.frameSize[0] && cy >= 0 && cy <= this.frameSize[1];
    };
    // Lost tracks expire after maxLost frames, or at once if the prediction has left the picture.
    this.tracks = this.tracks.filter((t) => t.lost === 0 || (t.lost <= this.maxLost && inFrame(t)));
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
