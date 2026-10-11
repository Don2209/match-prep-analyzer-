/** Jersey-colour team assignment: torso colour per detection → per-track median → 2-means clustering. */

export type Lab = [number, number, number];

function srgbToLinear(c: number) {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function rgbToLab(r: number, g: number, b: number): Lab {
  const R = srgbToLinear(r), G = srgbToLinear(g), B = srgbToLinear(b);
  const x = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047;
  const y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  const z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

export function labToHex([L, a, b]: Lab): string {
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
  const inv = (t: number) => (t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787);
  const X = inv(fx) * 0.95047, Y = inv(fy), Z = inv(fz) * 1.08883;
  const lin = [3.2406 * X - 1.5372 * Y - 0.4986 * Z, -0.9689 * X + 1.8758 * Y + 0.0415 * Z, 0.0557 * X - 0.204 * Y + 1.057 * Z];
  const gam = (c: number) => Math.round(255 * Math.min(1, Math.max(0, c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)));
  return "#" + lin.map((c) => gam(c).toString(16).padStart(2, "0")).join("");
}

/** Green-ish hue with some saturation = pitch. Catches shadowed grass too; leaves navy, white and dark kits alone. */
function isGrass(r: number, g: number, b: number) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const v = max / 255;
  const s = max ? (max - min) / max : 0;
  if (s < 0.15 || v < 0.06 || max !== g) return false;
  const h = 60 * (2 + (b - r) / (max - min)); // hue in degrees when green is the max channel
  return h >= 65 && h <= 170;
}

/** Median Lab colour of the shirt region (upper-middle of the box), ignoring grass pixels. */
export function torsoColour(img: ImageData, box: [number, number, number, number]): Lab | null {
  const [x1, y1, x2, y2] = box;
  const w = x2 - x1, h = y2 - y1;
  if (w < 4 || h < 10) return null;
  const xa = Math.max(0, Math.floor(x1 + 0.25 * w)), xb = Math.min(img.width, Math.ceil(x2 - 0.25 * w));
  const ya = Math.max(0, Math.floor(y1 + 0.15 * h)), yb = Math.min(img.height, Math.ceil(y1 + 0.5 * h));
  const Ls: number[] = [], As: number[] = [], Bs: number[] = [];
  const step = Math.max(1, Math.floor(Math.sqrt(((xb - xa) * (yb - ya)) / 200))); // sample at most ~200 pixels
  for (let y = ya; y < yb; y += step)
    for (let x = xa; x < xb; x += step) {
      const i = (y * img.width + x) * 4;
      const r = img.data[i], g = img.data[i + 1], b = img.data[i + 2];
      if (isGrass(r, g, b)) continue;
      const [L, A, B] = rgbToLab(r, g, b);
      Ls.push(L);
      As.push(A);
      Bs.push(B);
    }
  if (Ls.length < 5) return null;
  return [median(Ls), median(As), median(Bs)];
}

function median(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

const d2 = (a: number[], b: number[]) => a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0);

function kmeans2(points: number[][]): { labels: number[]; centres: number[][] } {
  let best = { labels: [] as number[], centres: [] as number[][], cost: Infinity };
  // Deterministic seeds: every pair among the most distant points + a few spread samples.
  const seeds: [number, number][] = [];
  const far = points.map((p, i) => [d2(p, points[0]), i]).sort((a, b) => b[0] - a[0])[0][1];
  const far2 = points.map((p, i) => [d2(p, points[far]), i]).sort((a, b) => b[0] - a[0])[0][1];
  seeds.push([far, far2]);
  for (let k = 1; k < Math.min(8, points.length); k++) seeds.push([0, Math.floor((k * points.length) / 8)]);
  for (const [a, b] of seeds) {
    if (a === b) continue;
    let centres = [points[a], points[b]];
    let labels: number[] = [];
    for (let it = 0; it < 30; it++) {
      labels = points.map((p) => (d2(p, centres[0]) <= d2(p, centres[1]) ? 0 : 1));
      const next = [0, 1].map((c) => {
        const members = points.filter((_, i) => labels[i] === c);
        return members.length ? members[0].map((_, j) => members.reduce((s, m) => s + m[j], 0) / members.length) : centres[c];
      });
      if (next.every((c, i) => d2(c, centres[i]) < 1e-6)) break;
      centres = next;
    }
    const cost = points.reduce((s, p, i) => s + d2(p, centres[labels[i]]), 0);
    if (cost < best.cost) best = { labels, centres, cost };
  }
  return best;
}

/**
 * @param colours track id → sampled torso colours
 * @param others track ids that are referees/goalkeepers by class majority (always team -1)
 */
export function assignTeams(colours: Map<number, Lab[]>, others: Set<number>) {
  const ids = [...colours.keys()].filter((id) => colours.get(id)!.length && !others.has(id));
  const teams = new Map<number, number>();
  if (ids.length < 2) {
    ids.forEach((id) => teams.set(id, 0));
    return { teams, teamColors: ["#d32f2f", "#1e3a8a"] as [string, string] };
  }
  const feat = (id: number) => {
    const cs = colours.get(id)!;
    return [0, 1, 2].map((k) => median(cs.map((c) => c[k])));
  };
  // Fit on well-observed tracks only; short fragments have noisy colours.
  const solid = ids.filter((id) => colours.get(id)!.length >= 3);
  const fitIds = solid.length >= 4 ? solid : ids;
  const { centres } = kmeans2(fitIds.map(feat));
  const label = (f: number[]) => (d2(f, centres[0]) <= d2(f, centres[1]) ? 0 : 1);

  // Robust per-axis spread (MAD) per team, so a keeper's or official's unusual hue stands out
  // while ordinary lighting differences in lightness don't.
  const FLOOR = [6, 4, 4];
  const chroma = (f: number[]) => Math.hypot(f[1], f[2]);
  const spread = [0, 1].map((c) => {
    const members = fitIds.map(feat).filter((f) => label(f) === c);
    return [0, 1, 2].map((k) => {
      const vals = members.map((m) => m[k]);
      if (!vals.length) return { med: centres[c][k], mad: FLOOR[k] };
      const med = median(vals);
      return { med, mad: Math.max(FLOOR[k], 1.4826 * median(vals.map((v) => Math.abs(v - med)))) };
    });
  });
  const teamChroma = [0, 1].map((c) => median(fitIds.map(feat).filter((f) => label(f) === c).map(chroma).concat(chroma(centres[c]))));
  for (const id of ids) {
    const f = feat(id);
    const c = label(f);
    // Officials' and keepers' kits are usually far more vivid (yellow, orange, pink) than the team's.
    const outlier =
      chroma(f) - teamChroma[c] > 12 || f.some((v, k) => Math.abs(v - spread[c][k].med) / spread[c][k].mad > 3.5);
    teams.set(id, outlier ? -1 : c);
  }
  const teamColors = centres.map((c) => labToHex(c as Lab)) as [string, string];
  return { teams, teamColors };
}
