# 赤い輪の設計 — Designing the Red Ring

An iPhone / iPad web game about a spatial cause: put sliced strawberries in a
ring *inside* a cake, hide them under cream and a second sponge, close the
outside, then cut — and the red shapes that appear on the cut face are decided
by where those strawberries were put, which way each one faced, and which way
the knife went.

It is not a decorating game and it is not a quiz. There is no preview of the
section before the cut, no glow marking which berries are about to be sliced,
and no scoring. After one reveal a child goes straight back to the assembly
table in a single tap, changes something, closes it again and cuts again.

## How the section is produced

Twelve knife directions, and everything else is computed:

- **Sponge and cream** are built as real angular sectors of a solid of
  revolution (`content/PolarSolid.ts`). The two radial knife faces are geometry
  in the mesh, with their own material group and metric `(radius, height)` UVs
  so crumb pores stay round instead of smearing along the cut.
- **Cream** is a polar height field (`content/CreamField.ts`), not a painted
  surface. Setting a berry down presses a dimple and raises a rim; the piping
  bag fills a gap from the bottom up; the palette knife levels it; the upper
  sponge compresses it. The cream thickness in the reveal is whatever the child
  actually left there.
- **Each strawberry** is intersected analytically with the plane the knife
  really travelled (`game/SectionGenerator.ts`). Crossings are chained through
  shared mesh edges of a welded hull, so the outline closes even when the plane
  grazes the equator of a slice; the resulting polygon is trimmed to the half
  plane the blade swept and triangulated into a cut face. The body of the berry
  is clipped by the same planes, which travel with the wedge when it is lifted
  out.
- The cut face samples the berry's own painted interior in its `(width, length)`
  frame, so a cut across the slab reads a narrow column through the pith and a
  cut along it reads the whole silhouette with its skin ring, fibres and seed
  cross sections. Nothing is a red decal, and no finished picture is ever
  substituted for a computed one.

`scripts/verifySection.ts` runs the same geometry, seating and intersection code
with no renderer and prints what the knife would find, so the correspondence
between placement and section can be checked directly:

```
npx esbuild scripts/verifySection.ts --bundle --platform=node --format=esm \
  --outfile=/tmp/verify.mjs && node /tmp/verify.mjs
```

## Running it

```
npm install
npm run dev        # local dev server
npm run typecheck  # tsc --noEmit
npm run build      # typecheck + production build into dist/
npm run preview    # serve the production build
```

## Notes on the build

- Vite + TypeScript (strict) + three.js, WebGL 2. Every feature works on
  WebGL 2; WebGPU, when the browser exposes it, is used only as a capability
  signal to spend spare headroom on the cut faces — larger interior maps, denser
  seed geometry, a wetter clearcoat (`core/Quality.ts`).
- All materials are generated procedurally at runtime (crumb, cream, berry
  interior and skin, brushed steel, bench timber), so there are no texture or
  model downloads and nothing to decompress on a phone.
- The kitchen around the bench is imported lazily, after the cake is already on
  screen and touchable.
- One finger throughout: drag a slice into a well, tap it to turn it, drag it
  off the cake to take it away. No rotate handles and no two-finger gestures.
- Rotating the device keeps the whole arrangement; only the framing changes.
  Portrait works down the ring and switches to the cut face on reveal; landscape
  shows the assembly surface and the tray of slices at once.
- No ads, no purchases, no login, no leaderboard.
