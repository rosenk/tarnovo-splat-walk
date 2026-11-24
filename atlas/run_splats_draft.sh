#!/usr/bin/env bash
# Run the draft posedImages2Splats (refine=false, 500 credits).
# Response JSON -> 04-op.json, progress -> 04-splats.log.
# If interrupted after "Operation: <id>", wait with: worldlabs operations wait <id>
cd "$(dirname "$0")"
date | tee 04-splats.log
worldlabs --json tasks run posedImages2Splats --request 04-splats-draft.json \
  --idempotency-key tarnovo-splats-draft-v1 --wait --timeout 3000 \
  > 04-op.json 2> >(tee -a 04-splats.log >&2)
status=$?
sleep 1
head -c 1500 04-op.json | tee -a 04-splats.log
echo
date | tee -a 04-splats.log
echo "EXIT=$status" | tee -a 04-splats.log
