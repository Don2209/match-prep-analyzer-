import path from "node:path";
import jpeg from "jpeg-js";
import * as ort from "onnxruntime-node";

/** Football fine-tuned YOLOv8s (uisikdag/yolo-v8-football-players-detection), exported to ONNX. */
export const MODEL_FILE = "football-yolov8s.onnx";
export const CLASSES = ["ball", "goalkeeper", "player", "referee"] as const;

/** [classIndex, confidence, x1, y1, x2, y2] in the pixel space of the submitted (letterboxed) image. */
export type Detection = [number, number, number, number, number, number];

let session: Promise<ort.InferenceSession> | null = null;

export function getSession() {
  session ??= ort.InferenceSession.create(path.join(process.cwd(), "models", MODEL_FILE), {
    graphOptimizationLevel: "all",
    executionProviders: ["cpu"],
  }).catch((e) => {
    session = null; // allow a retry on the next request
    throw e;
  });
  return session;
}

function toTensor(jpg: Uint8Array) {
  const { width, height, data } = jpeg.decode(jpg, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 256 });
  if (width % 32 || height % 32) throw new Error(`Image must be letterboxed to a multiple of 32 (got ${width}×${height}).`);
  const plane = width * height;
  const chw = new Float32Array(3 * plane);
  for (let i = 0, p = 0; p < plane; i += 4, p++) {
    chw[p] = data[i] / 255;
    chw[p + plane] = data[i + 1] / 255;
    chw[p + 2 * plane] = data[i + 2] / 255;
  }
  return new ort.Tensor("float32", chw, [1, 3, height, width]);
}

function iou(a: Detection, b: Detection) {
  const x1 = Math.max(a[2], b[2]), y1 = Math.max(a[3], b[3]);
  const x2 = Math.min(a[4], b[4]), y2 = Math.min(a[5], b[5]);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const area = (d: Detection) => (d[4] - d[2]) * (d[5] - d[3]);
  return inter / (area(a) + area(b) - inter + 1e-9);
}

/** Decode YOLOv8 output [1, 4 + C, N] and apply NMS (people are suppressed together, the ball separately). */
function postprocess(out: ort.Tensor, minConf: number): Detection[] {
  const [, rows, n] = out.dims as number[];
  const v = out.data as Float32Array;
  const C = rows - 4;
  const cands: Detection[] = [];
  for (let i = 0; i < n; i++) {
    let best = 0, cls = 0;
    for (let c = 0; c < C; c++) {
      const s = v[(4 + c) * n + i];
      if (s > best) {
        best = s;
        cls = c;
      }
    }
    // The ball is tiny and often blurred, so let it through at a lower score.
    if (best < (cls === 0 ? Math.min(minConf, 0.1) : minConf)) continue;
    const cx = v[i], cy = v[n + i], w = v[2 * n + i], h = v[3 * n + i];
    cands.push([cls, best, cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2]);
  }
  cands.sort((a, b) => b[1] - a[1]);
  const keep: Detection[] = [];
  for (const d of cands) {
    const group = d[0] === 0 ? 0 : 1;
    if (keep.every((k) => (k[0] === 0 ? 0 : 1) !== group || iou(k, d) < 0.5)) keep.push(d);
  }
  return keep.map((d) => [d[0], +d[1].toFixed(3), +d[2].toFixed(1), +d[3].toFixed(1), +d[4].toFixed(1), +d[5].toFixed(1)]);
}

export async function detect(jpg: Uint8Array, minConf = 0.25): Promise<Detection[]> {
  const s = await getSession();
  const out = await s.run({ [s.inputNames[0]]: toTensor(jpg) });
  return postprocess(out[s.outputNames[0]], minConf);
}
