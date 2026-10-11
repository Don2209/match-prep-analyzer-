"use client";

import type { AnalysisConfig, PitchRegion, TrackingResult } from "@/lib/types";

const REGIONS: { label: string; region: PitchRegion }[] = [
  { label: "Full pitch (105 × 68 m)", region: { x0: 0, y0: 0, length: 105, width: 68 } },
  { label: "Left half", region: { x0: 0, y0: 0, length: 52.5, width: 68 } },
  { label: "Right half", region: { x0: 52.5, y0: 0, length: 52.5, width: 68 } },
  { label: "Left penalty box", region: { x0: 0, y0: 13.84, length: 16.5, width: 40.32 } },
  { label: "Right penalty box", region: { x0: 88.5, y0: 13.84, length: 16.5, width: 40.32 } },
];
const CORNERS = ["far-left", "far-right", "near-right", "near-left"];

export function Setup({
  tracking,
  config,
  onChange,
  onRun,
  running,
}: {
  tracking: TrackingResult;
  config: AnalysisConfig;
  onChange: (c: AnalysisConfig) => void;
  onRun: () => void;
  running: boolean;
}) {
  const set = (patch: Partial<AnalysisConfig>) => onChange({ ...config, ...patch });
  const cal = config.calibration;
  const points = cal?.image ?? [];
  const regionIdx = Math.max(0, REGIONS.findIndex((r) => JSON.stringify(r.region) === JSON.stringify(cal?.region)));

  function addPoint(e: React.MouseEvent<HTMLDivElement>) {
    if (points.length >= 4) return;
    const box = e.currentTarget.getBoundingClientRect();
    const p: [number, number] = [(e.clientX - box.left) / box.width, (e.clientY - box.top) / box.height];
    set({ calibration: { region: REGIONS[regionIdx].region, image: [...points, p] } });
  }

  const team = (k: 0 | 1) => {
    const ours = config.ourTeam === k;
    const players = Object.values(tracking.tracks).filter((t) => t.team === k).length;
    return (
      <button
        key={k}
        onClick={() => set({ ourTeam: k })}
        className={`flex items-center gap-3 rounded-xl border px-3 py-2 text-left text-sm transition ${
          ours ? "border-accent bg-surface2" : "border-line hover:border-ink2"
        }`}
        aria-pressed={ours}
      >
        <span className="h-6 w-6 shrink-0 rounded-full border border-line" style={{ background: tracking.teamColors[k] }} />
        <span>
          <span className="block font-medium">Jersey {k === 0 ? "A" : "B"}</span>
          <span className="block text-xs text-muted">
            {tracking.keyframes?.length ? `${k === 0 ? "blue" : "orange"} rings · ` : ""}
            {players ? `${players} tracks · ` : ""}
            {ours ? "our team" : "opponent"}
          </span>
        </span>
      </button>
    );
  };

  return (
    <section className="card">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">2 · Match setup</h2>
        <span className="text-xs text-muted">
          {tracking.frames.length} frames · {tracking.fps || "—"} fps · ball seen in {Math.round(tracking.ballDetectionRate * 100)}% ·{" "}
          {tracking.model}
        </span>
      </div>

      {!!tracking.keyframes?.length && (
        <div className="mt-4">
          <p className="label">Detection check: blue and orange rings = the two teams, yellow = referee, keeper or unsure, ▼ = ball</p>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
            {tracking.keyframes.map((k) =>
              k.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={k.t} src={k.image} alt={`Annotated frame at ${k.t}s`} className="w-full rounded-lg border border-line" />
              ) : null,
            )}
          </div>
        </div>
      )}

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <div className="space-y-4">
          <div>
            <p className="label">Which jersey is your team?</p>
            <div className="mt-2 grid grid-cols-2 gap-2">{([0, 1] as const).map(team)}</div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-sm">
              <span className="label">Our name</span>
              <input className="input mt-1" value={config.ourName} onChange={(e) => set({ ourName: e.target.value })} />
            </label>
            <label className="text-sm">
              <span className="label">Opponent</span>
              <input className="input mt-1" value={config.oppName} onChange={(e) => set({ oppName: e.target.value })} />
            </label>
          </div>
          <div>
            <p className="label">In this footage, our team attacks</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {(["ltr", "rtl"] as const).map((d) => (
                <button
                  key={d}
                  onClick={() => set({ ourDirection: d })}
                  aria-pressed={config.ourDirection === d}
                  className={`rounded-xl border px-3 py-2 text-sm transition ${
                    config.ourDirection === d ? "border-accent bg-surface2 font-medium" : "border-line hover:border-ink2"
                  }`}
                >
                  {d === "ltr" ? "Left → right" : "Right → left"}
                </button>
              ))}
            </div>
          </div>
          <button className="btn-primary w-full" onClick={onRun} disabled={running}>
            {running ? "Building report…" : "Generate match-prep report"}
          </button>
        </div>

        <div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="label">Pitch calibration (optional, recommended)</p>
            {!!points.length && (
              <button className="text-xs text-accent underline" onClick={() => set({ calibration: null })}>
                Reset points
              </button>
            )}
          </div>
          {tracking.calibrationFrame ? (
            <>
              <select
                className="input mt-2"
                value={regionIdx}
                onChange={(e) => set({ calibration: { region: REGIONS[+e.target.value].region, image: points } })}
              >
                {REGIONS.map((r, i) => (
                  <option key={r.label} value={i}>
                    {r.label}
                  </option>
                ))}
              </select>
              <p className="mt-2 text-xs text-ink2">
                {points.length < 4
                  ? `Click the ${CORNERS[points.length]} corner of the selected area (${points.length}/4).`
                  : "Calibrated. Distances and speeds are now in real metres."}
              </p>
              <div className="relative mt-2 cursor-crosshair select-none overflow-hidden rounded-lg border border-line" onClick={addPoint}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={tracking.calibrationFrame} alt="Frame for calibration" className="block w-full" draggable={false} />
                <svg viewBox="0 0 1 1" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full">
                  {points.length > 1 && (
                    <polygon
                      points={points.map((p) => p.join(",")).join(" ")}
                      fill="rgba(57,135,229,0.15)"
                      stroke="var(--series-1)"
                      strokeWidth={0.004}
                    />
                  )}
                </svg>
                {points.map(([x, y], i) => (
                  <span
                    key={i}
                    className="pointer-events-none absolute flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white bg-accent text-[10px] font-bold text-white"
                    style={{ left: `${x * 100}%`, top: `${y * 100}%` }}
                  >
                    {i + 1}
                  </span>
                ))}
              </div>
            </>
          ) : (
            <p className="mt-2 text-sm text-muted">No frame is available for calibration (demo or imported data). Positions are estimated from the frame.</p>
          )}
          <p className="mt-2 text-xs text-muted">
            Calibration assumes a mostly fixed camera. Panning broadcast footage shifts positions, so treat its metres as indicative.
          </p>
        </div>
      </div>
    </section>
  );
}
