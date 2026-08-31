# 口金で白い花 — Piping tips and one white cake

A 3D piping toy for a four-year-old, built for mobile Safari (WebGL 2, Three.js,
TypeScript, Vite). The whole point is one discovery: **the shape of the hole in
the metal tip becomes the shape of the cream**, and after that, the shape of
your finger's path becomes the rest.

No menus, no cards, no score, no stars awarded, no ads, no accounts.

## Running it

```bash
npm install
npm run dev        # vite dev server, open on the phone over the LAN
npm run build      # tsc --noEmit && vite build
npm run preview    # serve dist/
```

## How the cream is made

The extrusion is not an animation and not a preset. Each stroke is swept, live,
from the real cross-section of the fitted tip:

1. `PipingInput` turns the touch into a point on the cake top, placed a fixed
   distance **above** the fingertip so the hand never covers the nozzle. A 1-Euro
   filter removes a small child's tremor at low speed and lets deliberate waves
   and loops through untouched. There is no pressure input — iOS has none to give.
2. `PipingController` runs the flow model: a short ramp on touch, a constant base
   flow while held, less cream per unit length when the finger moves fast and more
   when it is slow (clamped, so extremes correct themselves), and a decay on
   release that lifts the tip a few millimetres and pinches the cream to a point.
   Holding still makes the nozzle climb — that is what builds a star.
3. `ExtrusionBuilder` sweeps the tip's cross-section polyline along that 3D path
   with a parallel-transported frame plus a rate-limited roll correction. Only the
   newly written rings are uploaded each frame (`addUpdateRange`); nothing is
   rebuilt. The ridges are **real geometry**, so they show in the silhouette.
4. On release the stroke is classified and, for two shapes, rebuilt through the
   same sweep with a purpose-made ring stream: `RosetteGenerator` spirals inward
   and upward so the outer coil supports the inner one and the tail flicks over
   the centre; `ShellGenerator` gives the stroke a head, a belly and a dragged-out
   tail. Held stars, ropes, waves and ribbons keep the swept geometry itself.
5. The finished stroke is baked into a tight static geometry carrying an extra
   "relaxed" position per vertex, so the piped shape settles a fraction of a
   millimetre over the next few seconds on the GPU, with no per-frame CPU cost.

## Gestures

| what the finger does | what comes out |
| --- | --- |
| hold still | star (open star tip) / ball (round tip) |
| short move, then release | shell |
| small circle | rosette |
| long move | rope or wave |
| small side-to-side while advancing | ribbon |

Every one of them is a success. Nothing is measured.

## Tips

Three real tips lie on the bench: 8-tooth open star, round, and petal. Drag one
to the bag; it snaps to the socket and screws on. Each has real sheet-metal wall
thickness, a sharp opening rim, a rolled band at the bag end, drawing marks in the
reflection, and a thin film of cream near the opening.

## Responsibilities

| module | job |
| --- | --- |
| `piping/PipingInput` | touch → filtered piping point, finger offset, speed |
| `piping/NozzleProfile` | the three real cross-sections, metal and cream |
| `piping/ExtrusionBuilder` | streaming sweep, frames, normals, bake |
| `piping/RosetteGenerator` | inward-and-upward spiral |
| `piping/ShellGenerator` | head / belly / tail |
| `piping/GestureClassifier` | which structure the stroke asks for |
| `piping/PipingController` | flow, height, contact, finalisation |
| `render/CreamMaterial` | warm off-white, sheen, forward scatter, bubbles, settle |
| `scene/BagMorphController` | sag, squeeze, twist, remaining cream |
| `scene/CakeSurfaceContact` | nappe, dents, deposited-cream height field |
| `camera/CameraDirector` | the fixed shots; there is no free camera |
| `state/DecorationHistory` | keeps every stroke, merges in batches, one undo |
| `core/AdaptiveQuality` | tier selection, DPR and shadow-map adaptation |

## Quality tiers

Section density, micro-bubble detail, cake tessellation, shadow-map size and DPR
come from one of three tiers picked at start-up from core count, memory and
whether the device advertises WebGPU; DPR and shadow size then adapt to the
measured frame time. Rendering itself is WebGL 2 everywhere, including on
WebGPU-capable devices — see *Known limits*.

## Diagnostics

Append `?debug=1` to expose a read-only `window.__dbg` (beat, gesture, draw calls,
fps, tier, screen anchors). `tools/probe*.mjs` drive the built app in headless
Chromium against that object; they need `npx playwright` and a running
`npm run preview`.

## Known limits

* Rendering is WebGL 2 on every device. A WebGPU device is detected and used to
  raise the quality tier (denser sections, finer bubbles, more contact detail),
  but the renderer is not swapped, because the cream and steel shaders are written
  as GLSL chunk injections.
* The finale turns the cake, not the camera.
* No audio.
