#!/usr/bin/env bash
# Refined posedImages2Splats for the arcade segment (5000 credits, ~15-25 min).
# Response -> a-refined-op.json, progress -> a-refined.log.
# If interrupted after "Operation: <id>", wait with: bash wait_op.sh <id> a-refined
cd "$(dirname "$0")"
date | tee a-refined.log
worldlabs --json tasks run posedImages2Splats --request a-splats-refined.json \
  --idempotency-key arcades-splats-refined-v1 --wait --timeout 3600 \
  > a-refined-op.json 2> >(tee -a a-refined.log >&2)
status=$?
sleep 1
head -c 1200 a-refined-op.json | tee -a a-refined.log
echo
date | tee -a a-refined.log
echo "EXIT=$status" | tee -a a-refined.log
