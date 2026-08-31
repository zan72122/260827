# Verification record

Everything below was produced by running the built app in headless Chromium
(Playwright, `chromium-1194`) against `npm run preview`, in this container.
Reproduce with:

```sh
npm run build
npm run preview &
sh verify/final.sh          # writes verify/out/final.log and verify/out/*.png
```

The checks do not read the code's intentions. They read the buffers that are
actually on screen — `window.__spanbaum.probe()` walks the shaving's own vertex
data and the blank's own radius field — and compare them.

**Not done, and not claimed:** no test on a real iPhone or iPad, no test on any
physical device at all, and no play test with a child. The frame times below
come from a software rasteriser and are not device numbers.

---

## 1. Objective checks — 48 passed, 0 failed

`node verify/acceptance.mjs` (full log: `verify/out/final.log`)

### One shaving, at 25 / 50 / 75 / 100 % of the stroke

| what | 25 % | 50 % | 75 % | 100 % |
|---|---|---|---|---|
| root ↔ blade contact error (world units) | 0.00046 | 0.00046 | 0.00046 | 0.00046 |
| shaving length vs stroke | 0.1509 / 0.1512 | 0.2302 / 0.2312 | 0.3097 / 0.3112 | 0.3893 / 0.3912 |
| tip clearance outside the blank | +0.054 | +0.075 | +0.067 | +0.070 |
| tip curl, total turn | 140° | 230° | 297° | 350° |
| wood removed, vs depth of cut 0.0065 | 0.00556¹ | 0.00650 | 0.00650 | 0.00650 |
| wood **above** the edge removed | 0 | 0 | 0 | 0 |
| wood **beside** the blade removed | 0 | 0 | 0 | 0 |

¹ at 25 % the probe point is still inside the blade's entry ramp, where the cut
is by design shallower — the shaving is correspondingly thinner there.

The root error of 0.46 mm-equivalent is the deliberate burial of the root
section under the intact skin, not a gap: the shaving starts inside the wood.

### Feed, reversal, re-grab

* finger held still for ~1.5 s → cut 0.32000 → 0.32000 (no progress)
* finger lifted for ~1.5 s → cut 0.32000 (no progress)
* finger pulled back → tool feed 0.3200 → 0.1600, **cut unchanged at 0.32000**,
  shaving length unchanged (0.3893), trench depth unchanged (0.00650)
* released and re-grabbed → cut still 0.32000; one shaving, right length
* `pointercancel` + window blur mid-stroke → cut unchanged; a released pointer
  then drives nothing
* a second finger, dispatched mid-stroke at cut 0.096 → cut unchanged

### The row

* six strokes → `done=6`; the spindle indexes 0.616 → 1.664 → 2.711 → 3.758 →
  4.805 rad, i.e. exactly 2π/6 per finished shaving, and never otherwise
* after the sixth the phase is `hold`, not `work`
* all six faces carry a real cut: `[0.00650, 0.00650, 0.00650, 0.00650,
  0.00650, 0.00650]`
* all six shavings are the same length: `[0.320 × 6]`
* **after indexing, exactly one branch exists** (`cuts=[0.320, 0, 0, 0, 0, 0]`),
  the new face is untouched, and no wood has been removed there — the game does
  not make branches the child has not cut
* the finished state is reached only after the hold
* rotating to landscape keeps the finished row

No console errors.

---

## 2. Twenty replays — no accumulation

`node verify/replay.mjs`

| after round | geometries | textures | shader programs | scene nodes | JS heap |
|---|---|---|---|---|---|
| 1  | 38 | 14 | 8 | 62 | 9.58 MB |
| 5  | 38 | 14 | 8 | 62 | 9.79 MB |
| 10 | 38 | 14 | 8 | 62 | 9.86 MB |
| 15 | 38 | 14 | 8 | 62 | 9.87 MB |
| 20 | 38 | 14 | 8 | 62 | 9.89 MB |

Heap read after a forced GC (`--js-flags=--expose-gc`). **+0.30 MB over 19
replays**, flat from round 10 on. Every replay produced six branches and
exchanged the blank (`blankSerial` reached 20). Nothing is allocated on a
replay: the blank's grid, the shaving pool, the row records and the per-branch
variation records are all written in place.

Two real leaks were found and fixed while building this: the blank's vertex
buffers were being reallocated on every replay (≈1.5 MB of typed arrays plus
orphaned GPU buffers each time), and the shaving's centreline scratch arrays
were being allocated every frame.

---

## 3. Cost

`node verify/perf.mjs [--low]`

| | high | low (`?q=low`) |
|---|---|---|
| triangles | 148 366 | 121 526 |
| draw calls | 38 | 38 |
| rewriting the live shaving, per frame | 0.183 ms | 0.192 ms |
| re-cutting the blank's working band, per frame | 0.663 ms | 0.479 ms |
| **this game's own CPU share, per frame** | **0.85 ms** | **0.67 ms** |

That last row is the part this game is responsible for and is meaningful
across machines. It started at **6.76 ms** and was brought down by evaluating
each radius in the band once instead of five times, caching the per-column
trigonometry, and re-cutting only the one sector being carved rather than the
whole ring.

The measured whole-frame time in this container is **~1035 ms (high) / ~524 ms
(low)** per frame. That is a software rasteriser (SwiftShader) drawing at
390 × 844 with a 2048² shadow map on a shared container CPU. **It says nothing
about a phone and is not evidence of hitting 60 fps.** The 60 fps target is
therefore *not* verified. What is in place for it: one draw call per material,
a fixed geometry budget, no physics, no per-frame allocation, and a runtime
tier that steps render resolution down and then shadows off after a sustained
shortfall (`src/main.ts`, `adapt()`); `?q=low` selects a smaller blank grid and
512² textures up front.

---

## 4. Images

`verify/out/`, portrait `P*` (390 × 844) and landscape `L*` (844 × 390).

| file | what it shows |
|---|---|
| `P0-start` | before the first touch: blank held between centres, top row unfinished, chisel, guide ring |
| `P1-cut-25/50/75/100` | one shaving at each quarter of the stroke |
| `P2-curl-50-side`, `P2-curl-100-side` | the curl face-on, from along the blade |
| `P2-curl-50-back`, `P2-curl-100-back` | from the other side: the root going into the wood, the groove it came out of, the edge at the point of separation |
| `P3-after-index` | after the first index: **one** branch, the new face bare |
| `P4-row-complete` | six branches, one row |
| `P5-done` | after the reveal move, with the new-blank button |
| `P6-swap`, `P7-new-blank` | the exchange: the finished piece leaves, an unfinished blank is set into the jig |
| `P8-finger-vs-blade` | a 44 px fingertip drawn where the finger is (red) and the blade contact (blue): 56.1 px apart, target 40–60 |
| `L*` | the same sequence in landscape; finger-to-blade 55.0 px |
| `B-row-complete`, `B-reveal-done`, `B-landscape-done` | taken by the acceptance run |

Measured framing: portrait stroke 132.0 CSS px, finger-to-blade 55.0 px;
landscape stroke 112.6 CSS px, finger-to-blade 55.0 px.

---

## 5. Bugs this verification caught

Listed because they are the reason for the numbers above, and because three of
them looked fine on screen.

1. **The blank was drawn inside-out** — triangle winding reversed, so the cone
   was back-face culled and the jig behind it showed through. Same fault in the
   chisel.
2. **The spindle rotated the wrong way**, so the face under the blade was not
   the face being cut. The shaving appeared 49° away from the tool.
3. **Material removal never ran.** The update was gated on comparing `cut`
   against a value read at the top of the same frame, but pointer events change
   `cut` *between* frames, so the difference was always zero. Every groove was
   missing and the cutting sound never played. Nothing on screen said so — the
   shaving looked right.
4. **A branch appeared before the child cut it.** During the index step the
   "live" branch index had already advanced, and the still-full `cut` value was
   written into the *next* branch's slot, so the face the blank had just been
   turned to arrived already finished. Check 6b exists to catch exactly this.
5. Two allocation leaks (§2) and a 6.76 ms/frame hot spot (§3).

---

## 6. Left open

* **No device or child testing.** See the top of this file.
* 60 fps is a design target, not a measured result.
* The blank carries one UV seam on its far side; as the blank is indexed the
  seam comes round to the front, where a fine grain mismatch is visible along
  one line. The alternative — snapping the grain to a whole number of repeats
  per ring — would break the requirement that the grain be at one scale
  everywhere, so the seam was kept.
* In landscape the frame is deliberately close and oblique, so the bench top is
  only just in frame at the bottom; the whole bench, jig and tree together are
  a portrait composition.
* Audio was exercised only in that it is driven and silenced by the same
  `cut` delta the checks above verify; the sound itself was not listened to.
