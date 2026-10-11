# Match Prep Analyzer

A soccer footage analysis tool for preparing for your next opponent. It is hosted entirely on the free Vercel Hobby plan and needs no API keys.

- **Model:** Ultralytics YOLOv8s fine-tuned for football (classes: ball, goalkeeper, player, referee; weights from
  [uisikdag/yolo-v8-football-players-detection](https://huggingface.co/uisikdag/yolo-v8-football-players-detection)),
  exported to ONNX ([web/models/](web/models/)). It runs with `onnxruntime-node` in the `/api/detect` Vercel function.
- **Browser:** pulls frames from the video (5 fps, up to 3 min), sends them in batches to `/api/detect`, tracks players
  (ByteTrack-style, [web/lib/tracker.ts](web/lib/tracker.ts)) and splits the teams by jersey colour ([web/lib/teams.ts](web/lib/teams.ts)).
- **`/api/analyze`:** turns the tracks into tactics ([web/lib/analytics/](web/lib/analytics/)).

```
Browser: video → frames ──JPEG batches──▶ Vercel /api/detect (YOLOv8 ONNX) ──boxes──▶ Browser: tracking + team split
Browser ──tracks──▶ Vercel /api/analyze (possession, formation, lines, pressing, heatmaps, insights) ──report──▶ Browser
```

## What it measures
- Possession split, ball regains (where and how high up the pitch), turnovers in your own third
- Likely formation (line detection over frames where all 10 outfield players are visible)
- Defensive line height, team width and depth, compactness over time, shape stability
- Territory heatmaps, time in each third, attacking channel preference (left / centre / right)
- Pressing intensity (players within 10 m of the ball while defending)
- Per-player distance, top speed and sprints (with pitch calibration)
- Rule-based scouting notes: how to attack the opponent, what to fix in your own team

## Deploy
```bash
./deploy.sh          # vercel deploy --prod from web/
```
The free plan includes a monthly CPU allowance. Each analysed frame costs roughly 0.3–0.7 s of function CPU,
so a 1-minute clip (300 frames) uses about 2–4 CPU-minutes.

## Develop
```bash
cd web && npm install && npm run dev   # open http://localhost:3000/?demo=1
npm test                               # analytics unit tests
```

## Tips for good results
- Use wide, mostly static camera angles (tactical cam or drone). Broadcast close-ups and camera pans distort positions.
- Calibrate: click 4 corners of a known area (full pitch, half, or penalty box) on the setup frame.
- Clips of 30 s to 3 min work best. Use **Accurate mode** (960 px) when players or the ball are small.
- Possession and pressing need the ball visible in at least 15% of frames. Shape and line insights need calibration. Otherwise the report hides them instead of guessing.
