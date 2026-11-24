#!/usr/bin/env bash
# Run atlasGenerate for the Tarnovo lane (22 target views with depth).
# Response JSON -> 03-op.json, progress -> 03-generate.log.
cd "$(dirname "$0")"
date | tee 03-generate.log
worldlabs --json tasks run atlasGenerate --request 03-generate.json \
  --idempotency-key tarnovo-gen-v1 --wait --timeout 1800 \
  > 03-op.json 2> >(tee -a 03-generate.log >&2)
status=$?
sleep 1
head -c 2000 03-op.json | tee -a 03-generate.log
echo
date | tee -a 03-generate.log
echo "EXIT=$status" | tee -a 03-generate.log
