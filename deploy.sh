#!/usr/bin/env bash
# Deploys the YOLOv8 model to a public Hugging Face Space and the web app to Vercel (both free).
# Uses the logins already on this machine (huggingface-cli / vercel CLI).
set -euo pipefail
cd "$(dirname "$0")"
SPACE="${SPACE:-Rufaro2209/soccer-yolo}"

echo "==> Model: Hugging Face Space $SPACE"
python3 - "$SPACE" <<'PY'
import sys
from huggingface_hub import HfApi
repo = sys.argv[1]
api = HfApi()
api.create_repo(repo, repo_type="space", space_sdk="docker", private=False, exist_ok=True)
api.upload_folder(folder_path="model-space", repo_id=repo, repo_type="space",
                  commit_message="Deploy soccer YOLOv8 tracker", ignore_patterns=["__pycache__/*", "*.pyc"])
print("Uploaded. Build status:", api.get_space_runtime(repo).stage)
PY

URL="https://$(echo "$SPACE" | tr '[:upper:]/' '[:lower:]-').hf.space"
echo "==> Web: Vercel (NEXT_PUBLIC_SPACE_URL=$URL)"
cd web
npx --yes vercel@latest deploy --prod --yes --build-env NEXT_PUBLIC_SPACE_URL="$URL" --env NEXT_PUBLIC_SPACE_URL="$URL"
