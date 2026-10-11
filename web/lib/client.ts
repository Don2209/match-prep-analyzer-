import type { AnalysisConfig, Report, TrackingResult } from "./types";

export async function runAnalysis(tracking: TrackingResult, config: AnalysisConfig): Promise<Report> {
  // Images are only needed in the browser, so don't ship them to the API.
  const { keyframes: _k, calibrationFrame: _c, ...slim } = tracking;
  const res = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tracking: slim, config }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Analysis failed (HTTP ${res.status}).`);
  return body as Report;
}
