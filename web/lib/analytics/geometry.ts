export type Pt = [number, number];

/** Solve A·x = b (n×n) with partial pivoting. */
function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) throw new Error("Calibration points are degenerate (collinear or repeated).");
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/** Homography mapping 4 src points onto 4 dst points. Returns a projector function. */
export function homography(src: Pt[], dst: Pt[]): (p: Pt) => Pt {
  if (src.length !== 4 || dst.length !== 4) throw new Error("Homography needs exactly 4 point pairs.");
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [u, v] = src[i];
    const [X, Y] = dst[i];
    A.push([u, v, 1, 0, 0, 0, -u * X, -v * X]);
    b.push(X);
    A.push([0, 0, 0, u, v, 1, -u * Y, -v * Y]);
    b.push(Y);
  }
  const [a, bb, c, d, e, f, g, h] = solve(A, b);
  return ([u, v]) => {
    const w = g * u + h * v + 1;
    return [(a * u + bb * v + c) / w, (d * u + e * v + f) / w];
  };
}

export function dist(a: Pt, b: Pt): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

/** Convex hull area (monotone chain + shoelace). */
export function hullArea(points: Pt[]): number {
  if (points.length < 3) return 0;
  const pts = [...points].sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Pt[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Pt[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  const hull = [...lower.slice(0, -1), ...upper.slice(0, -1)];
  let area = 0;
  for (let i = 0; i < hull.length; i++) {
    const [x1, y1] = hull[i];
    const [x2, y2] = hull[(i + 1) % hull.length];
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area) / 2;
}

/**
 * Optimal partition of sorted 1-D values into k contiguous groups (min within-group SSE).
 * Returns group sizes from first to last, and the total SSE.
 */
export function partition1d(sorted: number[], k: number): { sizes: number[]; sse: number } {
  const n = sorted.length;
  if (k >= n) return { sizes: sorted.map(() => 1), sse: 0 };
  const pre = [0], pre2 = [0];
  for (const v of sorted) {
    pre.push(pre[pre.length - 1] + v);
    pre2.push(pre2[pre2.length - 1] + v * v);
  }
  const cost = (i: number, j: number) => {
    const m = j - i, s = pre[j] - pre[i];
    return pre2[j] - pre2[i] - (s * s) / m;
  };
  const dp = Array.from({ length: k + 1 }, () => new Array(n + 1).fill(Infinity));
  const cut = Array.from({ length: k + 1 }, () => new Array(n + 1).fill(0));
  dp[0][0] = 0;
  for (let g = 1; g <= k; g++)
    for (let j = g; j <= n; j++)
      for (let i = g - 1; i < j; i++) {
        const c = dp[g - 1][i] + cost(i, j);
        if (c < dp[g][j]) {
          dp[g][j] = c;
          cut[g][j] = i;
        }
      }
  const sizes: number[] = [];
  let j = n;
  for (let g = k; g >= 1; g--) {
    const i = cut[g][j];
    sizes.unshift(j - i);
    j = i;
  }
  return { sizes, sse: dp[k][n] };
}

export const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function std(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

export const round = (v: number, d = 1) => Math.round(v * 10 ** d) / 10 ** d;
