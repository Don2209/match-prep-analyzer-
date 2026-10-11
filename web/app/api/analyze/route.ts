import { analyze } from "@/lib/analytics/analyze";
import type { AnalysisConfig, TrackingResult } from "@/lib/types";

export const maxDuration = 30;

export async function POST(req: Request) {
  let body: { tracking?: TrackingResult; config?: AnalysisConfig };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Body must be JSON: { tracking, config }" }, { status: 400 });
  }
  const { tracking, config } = body;
  if (!tracking?.frames?.length || !config) {
    return Response.json({ error: "Missing tracking frames or config." }, { status: 400 });
  }
  if (config.ourTeam !== 0 && config.ourTeam !== 1) {
    return Response.json({ error: "config.ourTeam must be 0 or 1." }, { status: 400 });
  }
  try {
    return Response.json(analyze(tracking, config));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Analysis failed." }, { status: 422 });
  }
}
