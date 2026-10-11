#!/usr/bin/env bash
# Deploys the whole app (page, analytics API and the YOLOv8 ONNX model) to Vercel's free Hobby plan.
set -euo pipefail
cd "$(dirname "$0")/web"
npx --yes vercel@latest link --yes --project match-prep-analyzer >/dev/null
npx --yes vercel@latest deploy --prod --yes
