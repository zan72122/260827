#!/bin/sh
cd "$(dirname "$0")/.."
L=verify/out/final.log
: > $L
echo "########## acceptance ##########" >> $L
node verify/acceptance.mjs >> $L 2>&1
echo >> $L; echo "########## replay x20 ##########" >> $L
node verify/replay.mjs >> $L 2>&1
echo >> $L; echo "########## performance ##########" >> $L
node verify/perf.mjs >> $L 2>&1
node verify/perf.mjs --low >> $L 2>&1
echo >> $L; echo "########## evidence: portrait ##########" >> $L
node verify/evidence.mjs >> $L 2>&1
echo >> $L; echo "########## evidence: landscape ##########" >> $L
node verify/evidence.mjs --landscape >> $L 2>&1
echo "ALLDONE" >> $L
