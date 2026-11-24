#!/usr/bin/env bash
# Wait for an already-submitted Atlas operation (never resubmits).
# usage: wait_op.sh <operation-id> <prefix>   -> <prefix>-op.json, <prefix>.log
cd "$(dirname "$0")"
op=$1 prefix=$2
date | tee -a "$prefix.log"
worldlabs --json operations wait "$op" --timeout 3000 \
  > "$prefix-op.json" 2> >(tee -a "$prefix.log" >&2)
status=$?
sleep 1
head -c 1500 "$prefix-op.json" | tee -a "$prefix.log"
echo
date | tee -a "$prefix.log"
echo "EXIT=$status" | tee -a "$prefix.log"
