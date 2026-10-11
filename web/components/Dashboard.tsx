"use client";

import { useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Insight, Level, Report, TeamReport } from "@/lib/types";
import { AttackArrow, HeatLayer, Pitch, PositionsLayer } from "./Pitch";

const C = { ours: "var(--series-1)", opp: "var(--series-2)" };
type Side = "ours" | "opp";

export function Dashboard({ report, onSave, saved }: { report: Report; onSave: () => void; saved: boolean }) {
  const { ours, opp } = report.teams;
  const approx = report.meta.calibrated ? "" : "≈";

  function exportJson() {
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `match-prep-${ours.name}-vs-${opp.name}.json`.replace(/\s+/g, "_");
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <section className="space-y-4">
      <div className="card flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="label">3 · Match-prep report</p>
          <h2 className="mt-1 text-xl font-semibold">
            <TeamName t={ours} /> <span className="text-muted">vs</span> <TeamName t={opp} />
          </h2>
          <p className="mt-1 text-xs text-muted">
            {report.meta.duration}s analysed · {report.meta.frames} frames · ball seen {Math.round(report.meta.ballDetectionRate * 100)}% ·{" "}
            {report.meta.calibrated ? "calibrated pitch" : "uncalibrated (≈ approximate metres)"}
          </p>
        </div>
        <div className="no-print flex flex-wrap gap-2">
          <button className="btn-ghost" onClick={onSave} disabled={saved}>
            {saved ? "Saved to history" : "Save to history"}
          </button>
          <button className="btn-ghost" onClick={exportJson}>
            Export JSON
          </button>
          <button className="btn-ghost" onClick={() => window.print()}>
            Print / PDF
          </button>
        </div>
      </div>

      {report.reliability && <TrustCard report={report} />}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <PossessionTile ours={ours} opp={opp} />
        <DuoTile label="Likely formation" ours={ours.formation.shape ?? "—"} opp={opp.formation.shape ?? "—"} note={formationNote(ours, opp)} />
        <DuoTile label="Defensive line (from own goal)" ours={`${approx}${ours.shape.defLine} m`} opp={`${approx}${opp.shape.defLine} m`} note="Average depth of the 4 deepest outfielders" />
        <DuoTile
          label="Pressing (2+ near ball)"
          ours={report.meta.ballReliable === false ? "—" : `${ours.pressing.pressingRate}%`}
          opp={report.meta.ballReliable === false ? "—" : `${opp.pressing.pressingRate}%`}
          note="Share of the opponent's possession with 2 or more players within 10 m of the ball"
        />
      </div>

      <Insights items={report.insights} names={{ ours: ours.name, opp: opp.name }} />

      <div className="grid gap-4 lg:grid-cols-2">
        <HeatmapCard ours={ours} opp={opp} />
        <div className="card">
          <h3 className="font-semibold">Average positions</h3>
          <p className="mt-1 text-xs text-muted">Most-visible tracks per team. {ours.name} attacks left → right.</p>
          <div className="mt-3">
            <Pitch caption="Numbers are tracker IDs. Hover for details.">
              <PositionsLayer points={opp.avgPositions} color={C.opp} />
              <PositionsLayer points={ours.avgPositions} color={C.ours} />
              <AttackArrow />
            </Pitch>
          </div>
          <TeamLegend ours={ours} opp={opp} />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <TimelineCard
          title="Defensive line height over time"
          unit="m"
          data={report.timeline.map((p) => ({ t: p.t, ours: p.oursDefLine, opp: p.oppDefLine }))}
          names={{ ours: ours.name, opp: opp.name }}
          note="Higher = defending further up the pitch."
        />
        <TimelineCard
          title="Team compactness over time"
          unit="m²"
          data={report.timeline.map((p) => ({ t: p.t, ours: p.oursCompact, opp: p.oppCompact }))}
          names={{ ours: ours.name, opp: opp.name }}
          note="Area covered by outfield players. Lower = more compact; spikes are moments when the shape broke."
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <SplitCard title="Where each team spends its time" keys={["def", "mid", "att"]} labels={["Own third", "Middle", "Final third"]} ours={ours.thirds} opp={opp.thirds} names={[ours.name, opp.name]} />
        <SplitCard title="Attacking channels (ball in possession)" keys={["left", "center", "right"]} labels={["Left", "Centre", "Right"]} ours={ours.attackChannels} opp={opp.attackChannels} names={[ours.name, opp.name]} note="Sides are from each team's own attacking point of view" />
        <CompareTable ours={ours} opp={opp} approx={approx} />
      </div>

      <PlayersCard ours={ours} opp={opp} calibrated={report.meta.calibrated} />
    </section>
  );
}

const LEVEL: Record<Level, { label: string; dots: string; color: string; advice: string }> = {
  high: { label: "Reliable", dots: "●●●", color: "var(--good)", advice: "Good enough to plan around." },
  medium: { label: "Indicative", dots: "●●○", color: "var(--warn)", advice: "Use for trends, not exact numbers." },
  low: { label: "Rough", dots: "●○○", color: "var(--bad)", advice: "Don't base decisions on these numbers." },
};

function LevelBadge({ level }: { level: Level }) {
  const l = LEVEL[level];
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-semibold" style={{ color: l.color }}>
      <span aria-hidden className="tracking-tighter">
        {l.dots}
      </span>
      {l.label}
    </span>
  );
}

function TrustCard({ report }: { report: Report }) {
  const { overall, items } = report.reliability;
  const tips: string[] = [];
  if (!report.meta.calibrated) tips.push("Calibrate the pitch (4 clicks in step 2). This is the biggest accuracy gain.");
  if (report.meta.cameraPanned) tips.push("Film from a fixed, high position (a stand, a roof, or a phone on a tripod) instead of following the ball.");
  if (report.meta.ballDetectionRate < 0.3) tips.push("Use Accurate mode, or film closer or at higher resolution, so the ball is seen more often.");
  if (items[0]?.level !== "high") tips.push("Teams are split by shirt colour, so bibs or clearly different kits help a lot.");
  return (
    <div className="card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">How much to trust this report</h3>
        <span className="inline-flex items-center gap-2 text-sm">
          Overall <LevelBadge level={overall} />
        </span>
      </div>
      <p className="mt-1 text-xs text-muted">{LEVEL[overall].advice} Ratings come from the footage and the setup, not the opponent.</p>
      <ul className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {items.map((i) => (
          <li key={i.area} className="flex items-start justify-between gap-3 border-t border-line pt-2 text-sm">
            <span>
              <span className="block">{i.area}</span>
              <span className="block text-xs text-muted">{i.why}</span>
            </span>
            <LevelBadge level={i.level} />
          </li>
        ))}
      </ul>
      {tips.length > 0 && (
        <div className="mt-3 rounded-xl bg-surface2 p-3 text-sm">
          <p className="font-medium">To get more accurate data next time</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-ink2">
            {tips.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function TeamName({ t }: { t: TeamReport }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="h-3 w-3 rounded-full" style={{ background: C[t.side] }} />
      {t.name}
    </span>
  );
}

function TeamLegend({ ours, opp }: { ours: TeamReport; opp: TeamReport }) {
  return (
    <div className="mt-2 flex flex-wrap gap-4 text-xs text-ink2">
      {[ours, opp].map((t) => (
        <span key={t.side} className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: C[t.side] }} />
          {t.name}
          <span className="h-2.5 w-2.5 rounded-sm border border-line" style={{ background: t.jersey }} title="Detected jersey colour" />
        </span>
      ))}
    </div>
  );
}

function formationNote(ours: TeamReport, opp: TeamReport) {
  const f = (t: TeamReport) => (t.formation.shape ? `${t.formation.confidence}% of ${t.formation.samples} frames` : "not enough full-team frames");
  return `${ours.name}: ${f(ours)} · ${opp.name}: ${f(opp)}`;
}

function PossessionTile({ ours, opp }: { ours: TeamReport; opp: TeamReport }) {
  const a = ours.possessionPct;
  const b = opp.possessionPct;
  return (
    <div className="card">
      <p className="label">Possession</p>
      {a === null || b === null ? (
        <p className="mt-2 text-sm text-muted">Hidden: the ball wasn&apos;t seen often enough to judge possession.</p>
      ) : (
        <>
          <div className="mt-2 flex items-baseline justify-between gap-2 text-xl font-semibold tabular-nums sm:text-2xl">
            <span>{a}%</span>
            <span>{b}%</span>
          </div>
          <div className="mt-2 flex h-2.5 gap-[2px] overflow-hidden rounded-full" role="img" aria-label={`${ours.name} ${a}%, ${opp.name} ${b}%`}>
            <div className="rounded-l-full" style={{ width: `${a}%`, background: C.ours }} />
            <div className="rounded-r-full" style={{ width: `${b}%`, background: C.opp }} />
          </div>
          <div className="mt-1.5 flex justify-between text-xs text-ink2">
            <span>{ours.name}</span>
            <span>{opp.name}</span>
          </div>
        </>
      )}
    </div>
  );
}

function DuoTile({ label, ours, opp, note }: { label: string; ours: string; opp: string; note?: string }) {
  return (
    <div className="card" title={note}>
      <p className="label">{label}</p>
      <div className="mt-2 space-y-1">
        {(["ours", "opp"] as const).map((s) => (
          <div key={s} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: C[s] }} />
            <span className="text-xl font-semibold tabular-nums">{s === "ours" ? ours : opp}</span>
          </div>
        ))}
      </div>
      {note && <p className="mt-2 text-[11px] leading-snug text-muted">{note}</p>}
    </div>
  );
}

const KIND = {
  strength: { label: "Strength", color: "var(--good)", icon: "▲" },
  weakness: { label: "Exploit / fix", color: "var(--bad)", icon: "▼" },
  tip: { label: "Plan", color: "var(--accent)", icon: "◆" },
  info: { label: "Note", color: "var(--text-muted)", icon: "●" },
};

function Insights({ items, names }: { items: Insight[]; names: Record<Side, string> }) {
  const groups: { key: Insight["about"]; title: string }[] = [
    { key: "opp", title: `Scouting ${names.opp}` },
    { key: "ours", title: `About ${names.ours}` },
    { key: "data", title: "Data quality" },
  ];
  return (
    <div className="card">
      <h3 className="font-semibold">Match-prep insights</h3>
      <div className="mt-3 grid gap-4 lg:grid-cols-3">
        {groups.map((g) => {
          const list = items.filter((i) => i.about === g.key);
          return (
            <div key={g.key}>
              <p className="label">{g.title}</p>
              {list.length === 0 ? (
                <p className="mt-2 text-sm text-muted">Nothing stood out.</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {list.map((i, n) => (
                    <li key={n} className="rounded-xl border border-line bg-surface2 p-3">
                      <p className="flex items-start gap-2 text-sm font-medium">
                        <span style={{ color: KIND[i.kind].color }} aria-hidden>
                          {KIND[i.kind].icon}
                        </span>
                        <span>
                          {i.title}
                          <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide text-muted">{KIND[i.kind].label}</span>
                        </span>
                      </p>
                      <p className="mt-1 text-sm text-ink2">{i.text}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function HeatmapCard({ ours, opp }: { ours: TeamReport; opp: TeamReport }) {
  const [side, setSide] = useState<Side>("opp");
  const t = side === "ours" ? ours : opp;
  return (
    <div className="card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">Territory heatmap</h3>
        <div className="no-print flex rounded-xl border border-line p-0.5 text-sm">
          {(["opp", "ours"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSide(s)}
              aria-pressed={side === s}
              className={`rounded-lg px-3 py-1 ${side === s ? "bg-surface2 font-medium" : "text-ink2"}`}
            >
              {s === "ours" ? ours.name : opp.name}
            </button>
          ))}
        </div>
      </div>
      <p className="mt-1 text-xs text-muted">Darker = more time spent in that zone. {ours.name} attacks left → right.</p>
      <div className="mt-3">
        <Pitch caption={`${t.name}: ${t.thirds.def}% own third · ${t.thirds.mid}% middle · ${t.thirds.att}% final third`}>
          <HeatLayer grid={t.heatmap} color={C[side]} />
          <AttackArrow />
        </Pitch>
      </div>
    </div>
  );
}

function TimelineCard({
  title,
  unit,
  data,
  names,
  note,
}: {
  title: string;
  unit: string;
  data: { t: number; ours: number | null; opp: number | null }[];
  names: Record<Side, string>;
  note: string;
}) {
  return (
    <div className="card">
      <h3 className="font-semibold">{title}</h3>
      <p className="mt-1 text-xs text-muted">{note}</p>
      <div className="mt-3 h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="0" vertical={false} />
            <XAxis dataKey="t" tick={{ fill: "var(--text-muted)", fontSize: 11 }} tickLine={false} axisLine={{ stroke: "var(--border)" }} tickFormatter={(v) => `${v}s`} />
            <YAxis tick={{ fill: "var(--text-muted)", fontSize: 11 }} tickLine={false} axisLine={false} width={48} />
            <Tooltip
              cursor={{ stroke: "var(--text-muted)", strokeWidth: 1 }}
              contentStyle={{ background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 12, fontSize: 12, color: "var(--text-primary)" }}
              labelFormatter={(v) => `${v}s`}
              formatter={(v: number, k: string) => [`${v} ${unit}`, k]}
            />
            <Legend wrapperStyle={{ fontSize: 12, color: "var(--text-secondary)" }} iconType="circle" iconSize={8} />
            <Line type="monotone" dataKey="ours" name={names.ours} stroke={C.ours} strokeWidth={2} dot={false} connectNulls activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface-1)" }} />
            <Line type="monotone" dataKey="opp" name={names.opp} stroke={C.opp} strokeWidth={2} dot={false} connectNulls activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface-1)" }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function SplitCard<K extends string>({
  title,
  keys,
  labels,
  ours,
  opp,
  names,
  note,
}: {
  title: string;
  keys: K[];
  labels: string[];
  ours: Record<K, number>;
  opp: Record<K, number>;
  names: [string, string];
  note?: string;
}) {
  return (
    <div className="card">
      <h3 className="font-semibold">{title}</h3>
      {note && <p className="mt-1 text-xs text-muted">{note}</p>}
      <div className="mt-3 space-y-3">
        {keys.map((k, i) => (
          <div key={k}>
            <p className="text-xs font-medium text-ink2">{labels[i]}</p>
            {([["ours", ours[k], names[0]], ["opp", opp[k], names[1]]] as const).map(([s, v, n]) => (
              <div key={s} className="mt-1 flex items-center gap-2" title={`${n}: ${v}%`}>
                <div className="h-2.5 flex-1 rounded-full bg-surface2">
                  <div className="h-full rounded-full" style={{ width: `${v}%`, background: C[s] }} />
                </div>
                <span className="w-11 text-right text-xs tabular-nums text-ink2">{v}%</span>
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="mt-3 flex gap-4 text-xs text-ink2">
        {names.map((n, i) => (
          <span key={n + i} className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: i ? C.opp : C.ours }} />
            {n}
          </span>
        ))}
      </div>
    </div>
  );
}

function CompareTable({ ours, opp, approx }: { ours: TeamReport; opp: TeamReport; approx: string }) {
  const rows: [string, (t: TeamReport) => string][] = [
    ["Team width", (t) => `${approx}${t.shape.width} m`],
    ["Team depth", (t) => `${approx}${t.shape.depth} m`],
    ["Compactness", (t) => `${approx}${t.shape.compactness} m²`],
    ["Shape stability (CV)", (t) => `${t.shape.compactnessCv}`],
    ["Ball in final third", (t) => `${t.ballInAttThirdPct}%`],
    ["Avg pressers", (t) => `${t.pressing.avgPressers}`],
    ["Ball regains", (t) => `${t.regains.count}`],
    ["Regain height", (t) => `${approx}${t.regains.avgHeight} m`],
    ["Turnovers in own third", (t) => `${t.turnoversOwnThird}`],
    ["Players visible (avg)", (t) => `${t.avgVisible}`],
  ];
  return (
    <div className="card overflow-x-auto">
      <h3 className="font-semibold">Head-to-head</h3>
      <table className="mt-3 w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted">
            <th className="pb-2 font-medium">Metric</th>
            <th className="pb-2 text-right font-medium">{ours.name}</th>
            <th className="pb-2 text-right font-medium">{opp.name}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, f]) => (
            <tr key={label} className="border-t border-line">
              <td className="py-1.5 text-ink2">{label}</td>
              <td className="py-1.5 text-right tabular-nums">{f(ours)}</td>
              <td className="py-1.5 text-right tabular-nums">{f(opp)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PlayersCard({ ours, opp, calibrated }: { ours: TeamReport; opp: TeamReport; calibrated: boolean }) {
  const [side, setSide] = useState<Side>("ours");
  const t = side === "ours" ? ours : opp;
  return (
    <div className="card overflow-x-auto">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">Player movement</h3>
        <div className="no-print flex rounded-xl border border-line p-0.5 text-sm">
          {(["ours", "opp"] as const).map((s) => (
            <button key={s} onClick={() => setSide(s)} aria-pressed={side === s} className={`rounded-lg px-3 py-1 ${side === s ? "bg-surface2 font-medium" : "text-ink2"}`}>
              {s === "ours" ? ours.name : opp.name}
            </button>
          ))}
        </div>
      </div>
      <p className="mt-1 text-xs text-muted">
        Per tracker ID (an ID can change when a player leaves the frame). Sprint = faster than 25 km/h for at least 1 s.
        {!calibrated && " Uncalibrated, so values are only roughly comparable within this clip."}
      </p>
      {t.players.length === 0 ? (
        <p className="mt-3 text-sm text-muted">Not enough continuous tracking (needs video with players visible for 3 s or more).</p>
      ) : (
        <table className="mt-3 w-full min-w-[480px] text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="pb-2 font-medium">ID</th>
              <th className="pb-2 text-right font-medium">Tracked</th>
              <th className="pb-2 text-right font-medium">Distance</th>
              <th className="pb-2 text-right font-medium">Top speed</th>
              <th className="pb-2 text-right font-medium">Sprints</th>
              <th className="pb-2 text-right font-medium">Avg position</th>
            </tr>
          </thead>
          <tbody>
            {t.players.map((p) => (
              <tr key={p.id} className="border-t border-line">
                <td className="py-1.5">
                  <span className="inline-flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: C[side] }} />#{p.id}
                  </span>
                </td>
                <td className="py-1.5 text-right tabular-nums text-ink2">{p.seconds}s</td>
                <td className="py-1.5 text-right tabular-nums">{p.distance} m</td>
                <td className="py-1.5 text-right tabular-nums">{p.topSpeed} km/h</td>
                <td className="py-1.5 text-right tabular-nums">{p.sprints}</td>
                <td className="py-1.5 text-right tabular-nums text-ink2">
                  {p.avgX}, {p.avgY} m
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
