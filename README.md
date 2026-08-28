# Jingle Bell Flower Forge

A small workshop game for a four-year-old. A flat metal flower is pressed into a
cup, a pellet is dropped inside, the petals are folded closed one at a time, the
shell is clinched into a bell, polished, threaded and finally — for the first
time in the whole game — rung.

No text, no score, no timer, no fail state. One verb per scene: push, drop in,
close, clinch, polish, swing.

## Run it

```sh
npm install
npm run dev        # http://localhost:5173
```

Build and serve the production bundle:

```sh
npm run build
npm run preview    # http://localhost:4173
```

`npm run typecheck` runs the TypeScript check on its own.

Open it on a phone or tablet in either orientation; the composition, the camera
and the tool placement are rebuilt for the screen it finds.

## How it is put together

* `src/world/sheet.ts` — a solid metal sheet built from a parametric mid-surface,
  with real thickness, chamfered cut edges and punched holes.
* `src/world/bell.ts` — the flower blank. One arc-length parameter runs from the
  centre outwards; giving that arc a curvature draws the cup and curls each
  petal onto a sphere. The bend preserves arc length, so the flat flower and the
  closed shell are literally the same piece of metal.
* `src/audio/audio.ts` — everything is synthesised. The finished bell is a modal
  synth whose partial balance and decay follow strike strength, so no two shakes
  sound alike.
* `src/game/director.ts` — one camera shot per step, per orientation, always
  tweened; the metal is never cut away from mid-deformation.
* `src/gfx/textures.ts` — every map is drawn at boot, so there is nothing to
  download and the wear can be authored by process rather than tiled from a photo.
