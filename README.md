# Match Prep Analyzer

A soccer footage analysis tool for preparing for your next opponent.

- **Model:** Ultralytics YOLOv8 with ByteTrack, running on a free public Hugging Face Space ([model-space/](model-space/)). Calling it needs no API key.
- **App:** a single-page Next.js app with a serverless analytics API, on the free Vercel Hobby plan ([web/](web/)).

```
Browser ──upload clip──▶ HF Space (YOLOv8 + ByteTrack + jersey-colour team split) ──tracks──▶ Browser
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
./deploy.sh          # pushes model-space/ to the HF Space, then web/ to Vercel
```
The first Space build takes about 5–10 min. Free Spaces sleep when idle, and the page shows "waking up" for about a minute after that.

## Develop
```bash
cd web && npm install && npm run dev   # open http://localhost:3000/?demo=1
npm test                               # analytics unit tests
```

## Tips for good results
- Use wide, mostly static camera angles (tactical cam or drone). Broadcast close-ups and camera pans distort positions.
- Calibrate: click 4 corners of a known area (full pitch, half, or penalty box) on the setup frame.
- Clips of 30 s to 3 min work best on the free CPU. Use **Accurate mode** when the ball is small.
- For better player, goalkeeper and referee separation, set the Space variable `MODEL_WEIGHTS` to football fine-tuned YOLOv8 weights.
