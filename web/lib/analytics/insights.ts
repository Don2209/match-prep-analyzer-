import { Insight, Report, TeamReport } from "../types";

const MIRROR = { left: "right", center: "central", right: "left" } as const;
const LABEL = { left: "left", center: "central", right: "right" } as const;

function dominantChannel(t: TeamReport) {
  const entries = Object.entries(t.attackChannels) as [keyof typeof LABEL, number][];
  return entries.sort((a, b) => b[1] - a[1])[0];
}

/** Rule-based match-preparation notes. Thresholds are deliberately conservative. */
export function buildInsights(r: Report): Insight[] {
  const { ours, opp } = r.teams;
  const out: Insight[] = [];
  const add = (about: Insight["about"], kind: Insight["kind"], title: string, text: string) =>
    out.push({ about, kind, title, text });

  // ---- Data quality first, so the coach knows how far to trust the rest.
  if (!r.meta.calibrated)
    add("data", "info", "Positions are approximate",
      "No pitch calibration was set, so metres are estimated from the camera frame. Calibrate on a wide shot to get reliable distances, speeds and line heights.");
  if (r.meta.ballDetectionRate < 0.3)
    add("data", "info", "Ball rarely visible",
      `The ball was detected in only ${Math.round(r.meta.ballDetectionRate * 100)}% of frames, so possession and pressing numbers are rough. Wide tactical footage or "Accurate" mode improves this.`);

  // ---- Possession balance
  if (opp.possessionPct !== null && ours.possessionPct !== null) {
    if (opp.possessionPct >= 55)
      add("opp", "tip", `${opp.name} keep the ball (${opp.possessionPct}%)`,
        "Expect long spells without the ball. Rehearse a compact mid-block, pick pressing triggers (a back pass, or a poor touch to the full-back) and break quickly after winning it.");
    else if (ours.possessionPct >= 55)
      add("ours", "strength", `We controlled possession (${ours.possessionPct}%)`,
        "Keep the circulation, but prepare a rest-defence shape: 2–3 players staying behind the ball to stop counter-attacks.");
  }

  // ---- Opponent build-up channel
  const [ch, share] = dominantChannel(opp);
  if (share >= 40 && ch !== "center")
    add("opp", "tip", `${opp.name} attack mostly down their ${LABEL[ch]} side (${share}%)`,
      `Overload our ${MIRROR[ch]} flank in defence: the winger tracks back and the near central midfielder shifts across to double up.`);
  else if (share >= 45 && ch === "center")
    add("opp", "tip", `${opp.name} play through the middle (${share}%)`,
      "Stay narrow and screen the zone between our lines. Force them wide, where the touchline does the defending.");

  // ---- Opponent defensive line
  if (opp.shape.defLine > 0) {
    if (opp.shape.defLine >= 38)
      add("opp", "weakness", `High defensive line (~${opp.shape.defLine} m from their goal)`,
        "There is space behind them. Plan runs in behind, early balls over the top and diagonal switches into the channels.");
    else if (opp.shape.defLine <= 24)
      add("opp", "tip", `Deep defensive block (~${opp.shape.defLine} m)`,
        "Expect little space behind. Use width, cut-backs, second balls and shots from the edge of the box. Be patient with circulation.");
  }

  // ---- Opponent shape stability
  if (opp.shape.compactnessCv >= 0.35)
    add("opp", "weakness", `${opp.name}'s shape breaks up often`,
      "Their team area changes a lot from moment to moment, usually during transitions. Attack fast the moment we win the ball, before they reorganise.");
  if (opp.shape.width >= 45)
    add("opp", "weakness", `Stretched horizontally (avg width ${opp.shape.width} m)`,
      "Gaps open between their centre-backs and full-backs. Target the half-spaces with runs from midfield.");

  // ---- Opponent pressing
  if (opp.pressing.pressingRate >= 40)
    add("opp", "tip", `Aggressive press (${opp.pressing.pressingRate}% of our possession under 2+ pressers)`,
      "Play with one or two touches, use the goalkeeper as a free man, and have a direct outlet ready to bypass the first line.");
  else if (opp.pressing.pressingRate > 0 && opp.pressing.pressingRate <= 15)
    add("opp", "weakness", "Passive without the ball",
      "They rarely close down the ball carrier. Build patiently and let our centre-backs carry the ball forward into midfield.");
  if (opp.regains.count >= 3 && opp.regains.attThirdPct >= 35)
    add("opp", "tip", `They win the ball high (${opp.regains.attThirdPct}% of regains in our third)`,
      "Avoid risky passes in our own third. Clear our lines when we are under pressure.");

  if (opp.formation.shape)
    add("opp", "info", `Likely shape: ${opp.formation.shape}`,
      `Estimated from ${opp.formation.samples} frames with all 10 outfield players visible (${opp.formation.confidence}% agreement). Check it against the keyframes.`);

  // ---- Our own team
  if (ours.turnoversOwnThird >= 2)
    add("ours", "weakness", `${ours.turnoversOwnThird} turnovers in our defensive third`,
      "Work on build-up under pressure in training: angles of support, body shape on receiving the ball, and a safe outlet pass.");
  if (ours.shape.compactnessCv >= 0.35)
    add("ours", "weakness", "Our shape is inconsistent",
      "Our team area swings a lot. Drill compact distances (about 10–15 m between lines) and recovery runs after losing the ball.");
  const oursSides = ours.attackChannels;
  if (oursSides.left + oursSides.right > 0) {
    const weakSide = oursSides.left < oursSides.right ? "left" : "right";
    if (oursSides[weakSide] < 20)
      add("ours", "tip", `We rarely attack down the ${weakSide} (${oursSides[weakSide]}%)`,
        `We are predictable. Add rotations or switches of play to the ${weakSide} side so the opponent can't shift across early.`);
  }
  if (ours.pressing.pressingRate >= 40)
    add("ours", "strength", `Good pressing intensity (${ours.pressing.pressingRate}%)`,
      "Keep pressing, and make sure the back line steps up with it to keep the team compact.");
  if (ours.regains.count >= 3 && ours.regains.avgHeight >= 50)
    add("ours", "strength", `We win the ball high (avg ${ours.regains.avgHeight} m from our goal)`,
      "Prepare quick finishing patterns for after a high regain: the first pass forward within 3 seconds.");

  return out;
}
