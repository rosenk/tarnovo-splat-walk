#!/usr/bin/env bash
# Wait for the already-submitted atlasGenerate operation (do not resubmit).
cd "$(dirname "$0")"
OP=9e1570779ce14e5d8a4271a894496061
date | tee -a 03-generate.log
worldlabs --json operations wait "$OP" --timeout 1800 \
  > 03-op.json 2> >(tee -a 03-generate.log >&2)
status=$?
sleep 1
head -c 2000 03-op.json | tee -a 03-generate.log
echo
date | tee -a 03-generate.log
echo "EXIT=$status" | tee -a 03-generate.log
