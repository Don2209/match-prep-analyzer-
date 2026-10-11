import { HEAT_COLS, HEAT_ROWS, PITCH } from "@/lib/types";

const L = PITCH.length;
const W = PITCH.width;

/** Neutral pitch drawing in metres (105 × 68). Children render in the same coordinate space. */
export function Pitch({ children, caption }: { children?: React.ReactNode; caption?: string }) {
  const stroke = { stroke: "var(--pitch-line)", strokeWidth: 0.35, fill: "none" };
  return (
    <figure className="w-full">
      <svg viewBox={`-2 -2 ${L + 4} ${W + 4}`} className="w-full rounded-xl" role="img" aria-label={caption ?? "Pitch"}>
        <rect x={-2} y={-2} width={L + 4} height={W + 4} fill="var(--pitch)" />
        <rect x={0} y={0} width={L} height={W} {...stroke} />
        <line x1={L / 2} y1={0} x2={L / 2} y2={W} {...stroke} />
        <circle cx={L / 2} cy={W / 2} r={9.15} {...stroke} />
        <circle cx={L / 2} cy={W / 2} r={0.4} fill="var(--pitch-line)" />
        {[0, 1].map((side) => {
          const x = (v: number) => (side ? L - v : v);
          const box = (depth: number, width: number) => (
            <rect x={side ? L - depth : 0} y={(W - width) / 2} width={depth} height={width} {...stroke} />
          );
          return (
            <g key={side}>
              {box(16.5, 40.32)}
              {box(5.5, 18.32)}
              <circle cx={x(11)} cy={W / 2} r={0.4} fill="var(--pitch-line)" />
              <rect x={side ? L : -1.5} y={W / 2 - 3.66} width={1.5} height={7.32} {...stroke} />
            </g>
          );
        })}
        {children}
      </svg>
      {caption && <figcaption className="mt-2 text-xs text-muted">{caption}</figcaption>}
    </figure>
  );
}

export function HeatLayer({ grid, color }: { grid: number[][]; color: string }) {
  const cw = L / HEAT_COLS;
  const ch = W / HEAT_ROWS;
  return (
    <g>
      {grid.map((row, r) =>
        row.map((v, c) =>
          v > 0.02 ? (
            <rect
              key={`${r}-${c}`}
              x={c * cw + 0.3}
              y={r * ch + 0.3}
              width={cw - 0.6}
              height={ch - 0.6}
              rx={0.8}
              fill={color}
              fillOpacity={0.1 + v * 0.75}
            >
              <title>{`${Math.round(v * 100)}% of peak occupancy`}</title>
            </rect>
          ) : null,
        ),
      )}
    </g>
  );
}

export function PositionsLayer({
  points,
  color,
}: {
  points: { id: number; x: number; y: number; presence?: number }[];
  color: string;
}) {
  return (
    <g>
      {points.map((p) => (
        <g key={p.id} className="cursor-default">
          <circle cx={p.x} cy={p.y} r={2.3} fill={color} stroke="var(--surface-1)" strokeWidth={0.5} />
          <text x={p.x} y={p.y + 0.9} textAnchor="middle" fontSize={2.3} fontWeight={700} fill="#fff">
            {p.id}
          </text>
          <title>{`Track #${p.id} · avg (${p.x} m, ${p.y} m)${p.presence ? ` · visible ${Math.round(p.presence * 100)}%` : ""}`}</title>
        </g>
      ))}
    </g>
  );
}

export function AttackArrow() {
  return (
    <g opacity={0.8}>
      <line x1={L / 2 - 8} y1={W + 1} x2={L / 2 + 8} y2={W + 1} stroke="var(--series-1)" strokeWidth={0.5} />
      <path d={`M ${L / 2 + 8} ${W + 0.1} L ${L / 2 + 9.6} ${W + 1} L ${L / 2 + 8} ${W + 1.9} Z`} fill="var(--series-1)" />
    </g>
  );
}
