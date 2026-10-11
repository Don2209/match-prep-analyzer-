/**
 * Global camera-motion estimate between consecutive frames (pan/tilt as a 2-D translation).
 * Frames are reduced to a small greyscale thumbnail and aligned by minimising the mean
 * absolute difference over a search window. The background (stands, trees, ground texture)
 * dominates the image, so moving players barely affect the result. Zoom is not modelled.
 */

export const THUMB_W = 320;

export interface Thumb {
  g: Float32Array;
  w: number;
  h: number;
}

/** Box-averaged greyscale thumbnail, THUMB_W pixels wide. */
export function thumbnail(img: ImageData): Thumb {
  const k = Math.max(1, Math.floor(img.width / THUMB_W));
  const w = Math.floor(img.width / k), h = Math.floor(img.height / k);
  const g = new Float32Array(w * h);
  const d = img.data;
  for (let ty = 0; ty < h; ty++)
    for (let tx = 0; tx < w; tx++) {
      let sum = 0;
      for (let y = ty * k; y < (ty + 1) * k; y += 2)
        for (let x = tx * k; x < (tx + 1) * k; x += 2) {
          const i = (y * img.width + x) * 4;
          sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        }
      g[ty * w + tx] = sum;
    }
  // Normalise so exposure changes between frames don't bias the match.
  let mean = 0;
  for (const v of g) mean += v;
  mean /= g.length;
  let sd = 0;
  for (const v of g) sd += (v - mean) ** 2;
  sd = Math.sqrt(sd / g.length) || 1;
  for (let i = 0; i < g.length; i++) g[i] = (g[i] - mean) / sd;
  return { g, w, h };
}

function cost(a: Thumb, b: Thumb, dx: number, dy: number) {
  // b(x, y) ≈ a(x - dx, y - dy): content moved by (dx, dy) from a to b.
  let sum = 0, n = 0;
  const m = 2; // ignore a thin border
  for (let y = m; y < b.h - m; y += 2) {
    const ay = y - dy;
    if (ay < 0 || ay >= a.h) continue;
    for (let x = m; x < b.w - m; x += 2) {
      const ax = x - dx;
      if (ax < 0 || ax >= a.w) continue;
      sum += Math.abs(b.g[y * b.w + x] - a.g[ay * a.w + ax]);
      n++;
    }
  }
  return n > 50 ? sum / n : Infinity;
}

const refine = (cm: number, c0: number, cp: number) => {
  const den = cm - 2 * c0 + cp;
  return den > 1e-9 ? Math.max(-0.5, Math.min(0.5, (0.5 * (cm - cp)) / den)) : 0;
};

/**
 * Content shift from `a` to `b` as a fraction of frame width/height (sub-pixel).
 * Coarse-to-fine: a ±24 px search on every 2nd offset, then a ±2 px local search.
 */
export function estimateShift(a: Thumb, b: Thumb, range = 24): [number, number] {
  let best = Infinity, bx = 0, by = 0;
  for (let dy = -Math.floor(range / 2); dy <= Math.floor(range / 2); dy += 2)
    for (let dx = -range; dx <= range; dx += 2) {
      const c = cost(a, b, dx, dy);
      if (c < best) [best, bx, by] = [c, dx, dy];
    }
  const cx = bx, cy = by;
  for (let dy = cy - 2; dy <= cy + 2; dy++)
    for (let dx = cx - 2; dx <= cx + 2; dx++) {
      const c = cost(a, b, dx, dy);
      if (c < best) [best, bx, by] = [c, dx, dy];
    }
  const sx = bx + refine(cost(a, b, bx - 1, by), best, cost(a, b, bx + 1, by));
  const sy = by + refine(cost(a, b, bx, by - 1), best, cost(a, b, bx, by + 1));
  return [sx / b.w, sy / b.h];
}
