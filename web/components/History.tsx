"use client";

import type { Report } from "@/lib/types";

export interface HistoryEntry {
  id: string;
  savedAt: string;
  label: string;
  report: Report;
}

const KEY = "match-prep-history-v1";

export function loadHistory(): HistoryEntry[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]");
  } catch {
    return [];
  }
}

export function storeHistory(list: HistoryEntry[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, 20)));
    return true;
  } catch {
    return false;
  }
}

/** Compare saved analyses across games. Stored only in this browser. */
export function History({
  entries,
  onOpen,
  onDelete,
}: {
  entries: HistoryEntry[];
  onOpen: (e: HistoryEntry) => void;
  onDelete: (id: string) => void;
}) {
  if (!entries.length) return null;
  return (
    <section className="card no-print overflow-x-auto">
      <h2 className="text-lg font-semibold">Saved analyses</h2>
      <p className="mt-1 text-xs text-muted">Stored in this browser only. Use them to compare opponents and spot trends across games.</p>
      <table className="mt-3 w-full min-w-[640px] text-sm">
        <thead>
          <tr className="text-left text-xs text-muted">
            <th className="pb-2 font-medium">Match</th>
            <th className="pb-2 text-right font-medium">Possession</th>
            <th className="pb-2 text-right font-medium">Formations</th>
            <th className="pb-2 text-right font-medium">Opp. line</th>
            <th className="pb-2 text-right font-medium">Opp. press</th>
            <th className="pb-2" />
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => {
            const { ours, opp } = e.report.teams;
            return (
              <tr key={e.id} className="border-t border-line">
                <td className="py-2">
                  <button className="text-left font-medium hover:underline" onClick={() => onOpen(e)}>
                    {e.label}
                  </button>
                  <span className="block text-xs text-muted">{new Date(e.savedAt).toLocaleString()}</span>
                </td>
                <td className="py-2 text-right tabular-nums">
                  {ours.possessionPct ?? "—"}% / {opp.possessionPct ?? "—"}%
                </td>
                <td className="py-2 text-right tabular-nums">
                  {ours.formation.shape ?? "—"} / {opp.formation.shape ?? "—"}
                </td>
                <td className="py-2 text-right tabular-nums">{opp.shape.defLine} m</td>
                <td className="py-2 text-right tabular-nums">{opp.pressing.pressingRate}%</td>
                <td className="py-2 text-right">
                  <button className="text-xs text-muted hover:text-ink" onClick={() => onDelete(e.id)} aria-label={`Delete ${e.label}`}>
                    Delete
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
