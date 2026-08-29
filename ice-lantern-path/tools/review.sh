#!/bin/sh
# The six states the brief asks to review, on every device frame.
set -e
for dev in "$@"; do
  for st in pour:scene=pour freezing:scene=freezing innerout:scene=innerOut demold:scene=demold lit:scene=lit allon:"scene=finale&progress=1"; do
    n=${st%%:*}; q=${st#*:}
    w=3200
    case "$n" in allon) w=11000;; esac
    URL=${URL:-http://127.0.0.1:4173/} node tools/shot1.mjs "$dev" "$n" "?$q&maxdt=0.5" "$w" 2>&1 | head -1
  done
done
