# こおりのランタンみち (Ice Lantern Path)

お水を型へ入れて凍らせ、型を外すと透明な灯籠ができて、雪道が光る。

A photoreal-leaning mobile web toy for a four year old, built with TypeScript,
Vite and three.js (WebGL 2). No login, no ads, no purchases, no network calls at
runtime.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type check + production bundle into dist/
npm run preview    # serve the production bundle
```

Open on an iPhone or iPad in either orientation. Everything is one finger:
large drags, a long press to pour, upward swipes to lift the moulds, a sideways
swipe for the master switch.

## The seven beats

| # | beat | input | camera |
|---|------|-------|--------|
| 1 | 型を組む | drag the inner mould onto the three spacers | three-quarter from above |
| 2 | 飾りを入れる | drag berries, fir sprigs and petals into the gap | steeper three-quarter |
| 3 | 水を満たす | drag the pitcher over, then press and hold | near overhead |
| 4 | 凍らせる | swipe the mould onto the shelf, close the cover | fixed side, unmoving through the lapse |
| 5 | 内型を抜く | twist, then swipe up | mid close-up |
| 6 | 外型を外す | swipe up on the handles | low three-quarter |
| 7 | 灯りを入れる | drag the LED in, tap the switch | ice interior plus its light on the snow |

Then a worker sleds the lanterns out to the path and a sideways swipe on the big
waterproof switch lights the row from front to back.

## Notes on the simulation

* **No fire.** The lanterns hold a sealed, waterproof warm-white LED puck.
* **Freezing** is a material transition, not physics: the freeze front marches in
  from both mould walls (readable on the exposed top ring), transmission falls,
  roughness rises, air rejected by the advancing ice piles up in a milky core,
  bubbles lock in place, and the last-frozen band heaves up two millimetres as
  the water expands.
* **Water** is a level mesh with local ripples, a representative stream, and a
  small fixed pool of bubbles. There is no fluid solver.
* **Demoulding** is authored animation. The moulds are drafted, so lifting the
  outer one lets the ice slide down and seat on the bench - it never floats,
  shrinks or breaks. Warming the outside with a cloth first is what frees the
  spacer grooves.
* **Nothing can fail.** There is no timer, no score and no losing state; a
  misplaced drop simply goes home.

## Transparency order

Everything transparent has an explicit `renderOrder`, and the ice is limited to
two layers:

| order | object |
|-------|--------|
| 2 / 5 | contact shadows, light pools on snow |
| 9 / 10 | water body, water surface |
| 11 | ice back shell (no depth write), pour stream, bubbles |
| 13 | ice front shell (writes depth) |
| 20 | translucent outer mould |
| 22 | windproof lid |
| 30 | falling snow |

## Performance

`src/core/quality.ts` is a single ordered ladder. Under sustained slow frames it
gives up, in order: environment/reflection resolution, transmission quality,
particle counts, render scale, then shadows. Input handling never depends on it.

The finale uses at most three real point lights (foreground only); the rest of
the row is an `InstancedMesh` driven by instance colour into emissive, with the
light on the snow painted by instanced gradient decals.

## Capture harness

`tools/` drives the real pointer input through the whole game and takes
screenshots, for checking composition and transparency ordering on phone and
tablet frames.

```bash
npm run preview &
URL=http://127.0.0.1:4173/ node tools/play.mjs iphone-p
URL=http://127.0.0.1:4173/ node tools/capture.mjs quick ipad-l
```

Debug-only query parameters: `?q=<0-6>` forces a quality rung, `?maxdt=<s>`
raises the frame-time clamp for software rasterisers, `?fast=<n>` speeds up
scripted beats, `?scene=lit|demold|finale` jumps to a beat.
