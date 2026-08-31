#!/bin/sh
set -e
cd "$(dirname "$0")/.."
echo "########## acceptance ##########"; node verify/acceptance.mjs || true
echo; echo "########## replay x20 ##########"; node verify/replay.mjs || true
echo; echo "########## performance ##########"; node verify/perf.mjs || true
node verify/perf.mjs --low || true
echo; echo "########## evidence images ##########"
node verify/evidence.mjs
node verify/evidence.mjs --landscape
