# Spanbaum — 木を少しずつけずって、くるくるの枝をつくる

A one-finger, realistic 3D web game for a 4-year-old on iPhone / iPad.

The child finishes **one row** of a small Seiffen *Spanbaum* (chip tree). A
chisel is pushed up the turned linden blank; a thin shaving is lifted from the
surface, **is not cut off**, and rolls into a spiral that stays rooted in the
wood. After each shaving the blank is indexed a little and the next face comes
round. Six shavings complete the row.

---

## Run it

```sh
npm install
npm run dev        # http://localhost:5173
```

Production build / static preview:

```sh
npm run build      # type-check + bundle into dist/  (static files, no server code)
npm run preview    # http://localhost:4173
```

Static hosting only — WebGL2 + Three.js, no WebGPU, no external API, no login,
no payment, nothing to sign in to. Open the URL on the phone or tablet on the
same network (`npm run dev` binds `0.0.0.0`).

URL switches: `?q=low` forces the low-quality tier, `?fps` shows a frame
counter. Neither is needed to play.

---

## What the child does

1. A finger presses the chisel (a soft ring shows where, once, without words)
   and pushes **up**.
2. The blade advances exactly as far as the finger moves. A shaving peels off
   the surface, curls, and stays attached at the blade.
3. Stopping stops the cut. Pulling back pulls the tool back — the wood that is
   gone stays gone and the shaving keeps the length it has reached.
4. At the end of the stroke the tool lifts, the blank indexes 60°, and the next
   face is presented. **The next branch only happens when the child cuts it.**
5. After the sixth, the row is held still long enough to be seen, then the view
   moves once round to show the finished ring.
6. A wooden button swaps in a **new, unfinished blank** (an exchange, not a
   rewind).

Six pegs at the bottom fill in as branches are made. No numbers, no text, no
tracing, no failure, no score, no restart-from-scratch.

---

## The craft this models

From the Seiffen tradition (`geschichte.seiffen.de/spanbaumstechen`,
`schauwerkstatt.de` — both unreachable from this build environment; the facts
below were taken from secondary sources describing the same workshops):

* **Only straight-grown linden** is used — pale, fine, straight grain.
* The blank is **turned to a cone** and **held so it can be rotated**.
* A chisel **lifts** a shaving; it is *not* cut off — it stays hanging on the
  blank and **rolls up spirally**.
* Between shavings the **spindle is turned a little** and the next one is lifted.
* Neighbouring shavings should be of **equal length**; a shaving that breaks off
  ruins the piece.

What is modelled straight from that: the conical blank, support at both ends,
a chisel, one indexing step per shaving, the shaving staying rooted, the
spiral. The turning (lathe) stage that produces the cone is **not** part of the
main task and the blank is never spun to generate branches automatically.

Everything dimensional is a **design value**, stated in `src/config.ts` and not
claimed as a measurement: blank 1.42 units tall on a 0.44 base radius, shaving
0.32 long × 0.085 wide × 0.0065 thick, curl opening from a 0.022 tip radius.
No reference photograph is reproduced or used as a texture; every surface here
is generated procedurally in `src/scene/textures.ts`.

Why exactly six at the top row: the chisel has one width, so the number of
shavings that fit round a row is set by the local circumference. Six fit at the
working row; the craftsman's rows below it are fatter and carry 8, 10 and 12.

---

## How the shaving works

`src/geom/chip.ts` is the heart of it.

Material separates **at the cutting edge**, so:

```
root = the blade contact point   (rises as the stroke advances)
tip  = the first material formed (at the bottom of the stroke, tightly curled)
```

The intrinsic shape is a function of the **material coordinate** `s` — distance
from the free tip — never of time or frame:

```
curvature  kappa(s) = 1 / (tipRadius + curlOpen * s)
```

so the tip is tightly rolled and the curl opens out towards the root. Every
material point keeps its curvature, its width and its UV for good. As the
stroke advances the shaving is extruded and swings, exactly as a real one does,
but nothing already formed changes shape.

* **UVs are the wood's own coordinates on the blank** (axial position where the
  material came from, and arc position round it), divided by one global
  `GRAIN_PERIOD`. The grain of a shaving is therefore literally continuous with
  the trunk it came out of, cannot swim while the shaving moves, and is at one
  single scale on every branch and on the blank.
* The section is a **thin rectangular band**, not a tube: two faces, two thin
  arrises, a slight dish across the width. It is closed with a flat cap at the
  free tip.
* The root section is **buried under the intact skin** above the edge, deep
  enough to clear its own dishing, so the shaving grows out of the wood rather
  than being parked next to it.
* Near the tip the width and thickness ramp down — that is where the blade
  entered — and the blank's groove uses the **same ramp**, so trench and
  shaving cannot disagree.

`src/geom/blank.ts` removes the matching wood. For a branch rooted at
`(yStart + cut, phi)` the blank's radius is reduced over the axial span
`[yStart, yStart + cut]`, across the blade's width, by the depth of cut — with
a short run-out just past the edge where the material is still lifting, so
there is no wall where the shaving leaves. Position, width, length, depth and
root all come from **one set of numbers**; there is no separate "curl model"
placed next to an untouched cone.

The six branches differ slightly (curl tightness, width, a small lean), from a
per-blank seed fixed once. Nothing is randomised per frame. What changes with
how fast the child moves is the cutting **speed and sound**, nothing else.

---

## Control

* One finger, Pointer Events, with pointer capture. A **second finger is
  ignored**; `pointercancel`, `lostpointercapture`, window blur and tab-hide all
  release cleanly without disturbing the cut.
* Feed is **1:1 with the finger in screen space**: the finger's travel is
  projected onto the cutting direction and divided by the measured pixels-per-
  unit, so a full stroke is one comfortable swipe (~132 CSS px portrait,
  ~118 landscape at the reference sizes).
* `feed` follows the finger and may go back. `cut` is the high-water mark and
  **never falls** — reversing retracts the tool and regrows nothing.
* Assists are the tool and its guide, never the material: the **flat back of the
  blade rides on the floor of the cut**, which is what fixes the depth, and the
  stroke is clamped at its end, which is what stops the shaving being severed.
  The wood is never softened, stretched or "rescued".
* `touch-action: none`, `overscroll-behavior: none` and `preventDefault` on
  touch/gesture events keep the page from scrolling or zooming under the work.
* Rotating the device re-frames the camera and keeps every bit of state.

## Camera and framing

Fixed while working — the child never has to steer it. The camera orbits the
blank's axis but **aims between the axis and the face being cut**, so the
contact, the curl and its root stay together whatever the screen shape.

* **Portrait** uses the height of the screen for the length of the blank and
  the direction of the cut; the bench, the jig and the whole tree are in frame.
* **Landscape** comes closer and further round, so the curvature of the shaving
  and the blade contact read large.
* The blade and the start of the curl sit **55 CSS px** from the finger in both
  (checked at run time, target 40–60). The chisel's hit area is a 95 px band
  along the whole tool plus everything on the tool's side of the contact, so a
  small hand cannot miss it; the handle body runs down to the bottom of the
  screen and the finger never covers the edge.
* The one camera move in the game happens **1.5 s after the sixth shaving** —
  never across the moment the last curl reaches its root.

## Workshop

Real geometry throughout — nothing is an image on a card. Near: the carving
board's edge, loose shavings, the chisel handle. Middle: the blank held between
a lower cup-and-centre and an upper centre on an iron arm, on a six-notch index
ring with its detent. Far: shelves with a few finished Spanbäume and two turned
blanks.

Light is one broad window raking from the left plus a small HDR room
environment (`src/scene/env.ts`), which is also what the steel reflects. Wood
is unfinished — matte, no varnish anywhere. The grain is fine and low-contrast,
carried in colour rather than exaggerated relief. Trunk and shavings are the
**same wood**; a 0.65 mm shaving passes light and a solid cone does not, which
is one extra wrap term in the standard material, so the two read as one
material at two thicknesses.

Sound is a filtered noise band whose level and brightness follow cutting speed,
with a fast attack and a short settling tail; it stops when the finger stops.
A soft click marks the detent on each index. The game is completely
understandable with the sound off.

---

## Verification

```sh
npm run build
npm run preview &          # serves dist/ on 4173
sh verify/runall.sh        # acceptance + 20 replays + performance + images
```

Individual runs: `node verify/acceptance.mjs`, `verify/replay.mjs`,
`verify/perf.mjs [--low]`, `verify/evidence.mjs [--landscape]`,
`verify/study.mjs`. Images land in `verify/out/`.

The checks read the **actual buffers on screen** (`window.__spanbaum.probe()`),
not the intentions of the code: where the shaving's root section really is,
how long the shaving really is, how deep the blank has really been cut, and
whether wood above and beside the cut is really untouched.

See `VERIFICATION.md` for the recorded results.

---

## Limits and what is not claimed

* **No real-device test and no play test with a child were carried out.** All
  results were produced by headless Chromium with a software rasteriser in a
  container. Frame times measured there are *not* phone frame times and are
  reported as such.
* Dimensions, wood species detail beyond "pale straight-grained linden", and
  the exact form of the jig are design values, not measurements.
* The blank carries one UV seam on its far side; a fine grain mismatch on that
  one line comes round to the front as the blank is indexed.
