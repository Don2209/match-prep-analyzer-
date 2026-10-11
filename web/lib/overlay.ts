/** Shared drawing of tracking overlays (live preview, replay and keyframes). */

/** Ring colours: blue = jersey A, orange = jersey B, yellow = referee / keeper / unsure. */
export const RING = ["#3987e5", "#eb6834"] as const;
export const OTHER = "#ffd400";

export interface OverlayPlayer {
  id: number;
  team: number;
  /** Pixel coordinates in the canvas: centre x, foot y, box height. */
  cx: number;
  foot: number;
  height: number;
}

export function drawOverlay(ctx: CanvasRenderingContext2D, players: OverlayPlayer[], ball: [number, number] | null) {
  const k = Math.max(0.6, ctx.canvas.width / 1280);
  ctx.save();
  ctx.lineWidth = 2 * k;
  ctx.font = `bold ${Math.round(11 * k)}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 2 * k;
  for (const p of players) {
    const col = p.team === 0 || p.team === 1 ? RING[p.team] : OTHER;
    const rx = Math.max(6 * k, p.height * 0.32);
    ctx.strokeStyle = col;
    ctx.beginPath();
    ctx.ellipse(p.cx, p.foot, rx, rx * 0.32, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = col;
    ctx.fillText(String(p.id), p.cx, p.foot - p.height - 4 * k);
  }
  if (ball) {
    const [bx, by] = ball;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.moveTo(bx - 6 * k, by - 16 * k);
    ctx.lineTo(bx + 6 * k, by - 16 * k);
    ctx.lineTo(bx, by - 7 * k);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}
