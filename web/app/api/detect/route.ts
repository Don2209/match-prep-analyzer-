import { CLASSES, MODELS, detect, getSession, isModelKey } from "@/lib/detector";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_IMAGES = 8;

/** Health check + warm-up: loads the model so the first real batch is fast. */
export async function GET() {
  const t0 = Date.now();
  try {
    await getSession("grassroots");
    return Response.json({ status: "ok", models: Object.keys(MODELS), classes: CLASSES, loadMs: Date.now() - t0 });
  } catch (e) {
    return Response.json({ status: "error", error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

/** Body: { images: base64 JPEG[] (letterboxed, sides multiple of 32), model?: "grassroots" | "pro", conf?: number } */
export async function POST(req: Request) {
  let body: { images?: string[]; conf?: number; model?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Body must be JSON: { images: string[] }" }, { status: 400 });
  }
  const images = body.images ?? [];
  if (!images.length || images.length > MAX_IMAGES) {
    return Response.json({ error: `Send between 1 and ${MAX_IMAGES} images per request.` }, { status: 400 });
  }
  const model = isModelKey(body.model) ? body.model : "grassroots";
  const conf = Math.min(0.9, Math.max(0.05, body.conf ?? 0.25));
  const t0 = Date.now();
  try {
    const detections = [];
    for (const b64 of images) {
      detections.push(await detect(Buffer.from(b64.replace(/^data:image\/\w+;base64,/, ""), "base64"), model, conf));
    }
    return Response.json({ detections, ms: Date.now() - t0 });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Detection failed." }, { status: 500 });
  }
}
