import { SPACE_URL } from "@/lib/config";

export const dynamic = "force-dynamic";

/** Pings the model Space. Also wakes it up if it went to sleep. */
export async function GET() {
  try {
    const res = await fetch(`${SPACE_URL}/health`, { cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (res.status === 404) return Response.json({ status: "missing", space: SPACE_URL });
    if (!res.ok) return Response.json({ status: "waking", http: res.status, space: SPACE_URL });
    return Response.json({ ...(await res.json()), space: SPACE_URL });
  } catch {
    return Response.json({ status: "waking", space: SPACE_URL });
  }
}
