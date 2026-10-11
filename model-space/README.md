---
title: Soccer YOLOv8 Tracker
emoji: ⚽
colorFrom: green
colorTo: blue
sdk: docker
app_port: 7860
pinned: false
license: agpl-3.0
---

# Soccer YOLOv8 Tracker

A public CPU inference service for the soccer match analysis dashboard. It needs no API key.

- `GET /health`: model status and queue length
- `POST /jobs`: multipart `file` (video or image) plus optional `accurate=true` (960px inference). Returns `{id}`.
- `GET /jobs/{id}`: `{status, progress, result?}`. `status` is one of `queued | running | done | error`.

The result contains per-frame player tracks (ByteTrack IDs, team split by jersey colour)
and ball positions in normalised image coordinates, plus annotated keyframes.

Set the `MODEL_WEIGHTS` Space variable to use football fine-tuned YOLOv8 weights
(any ultralytics `.pt` path or `hf://` style URL). Class names containing "ball" are treated as the ball.
Everything else counts as a person.
