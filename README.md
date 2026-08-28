# christmas-tree-shake-bale-open

A one-finger web game for a four-year-old, built for iPhone and iPad Safari.
The subject is not decorating a tree. It is the machine chain a cut Christmas
tree actually goes through at a winter shipping yard:

1. shake it on a vibrating table so the dry old needles fall off
2. feed it butt-first into a cone baler, which folds the branches up the trunk
3. wrap it in netting so it comes out long and thin
4. take it to a delivery hall and pull the netting off
5. watch the branches open in a wave from the bottom of the trunk to the top

The two moments the whole build is aimed at are the *buru-buru* — vibration
travelling from the trunk out to the branch tips while only brown needles, dust
and twigs come loose — and the *basa* — the branches springing open one after
another as the net lets go.

Nothing is explained in words. The opening frame simply puts a wide tree and a
narrow loading gate in the same shot; the tree does not fit, and that is the
entire premise.

## Running it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type check + production bundle into dist/
npm run preview    # serve the production build on :4173
npm run test:e2e   # Playwright: a full play-through at iPhone and iPad sizes
```

Useful query parameters: `?quality=low|medium|high` pins the quality tier and
`?renderer=webgl` forces the plain WebGL 2 renderer.

## How it is put together

- **Vite + TypeScript + three.js**, no other runtime dependencies.
- **Renderer**: `WebGPURenderer` when the browser exposes WebGPU, otherwise the
  classic `WebGLRenderer`. Every part of the game loop runs on either. An
  adaptive resolution controller watches the frame time and scales the drawing
  buffer between 0.62x and the device ratio (capped per tier), so a strong
  device gets 60 fps and a weak one stays above 30.
- **The tree** is a bone rig, not a soft body: a trunk chain plus three bones
  per branch, skinned into one `SkinnedMesh` for the wood. Foliage is a second
  instanced mesh of real needle sprigs whose matrices are written from the bone
  world matrices each frame, which allows per-sprig behaviour (dry needles are
  hidden as they are shaken loose; sprays are squeezed flat under the net).
  - *shake*: a per-bone spring driven by a waveform delayed by the bone's depth,
    so motion arrives at the trunk first and the tips last, and overshoots there.
  - *compression*: each branch's fold target comes from how far the cone has
    travelled past it, so the fold is a wave running from the butt to the tip.
  - *release*: the same fold, springing back underdamped with a per-branch
    delay, gated by a rate-limited release front so it can never open at once.
- **The net** is a knitted tube: a live grid mesh sized to the tree's silhouette,
  with tension rings that snap and a tail that gathers into a bunch as it is
  pulled off. Near the camera it uses the fine weave; further away, a coarser one.
- **Materials** are all generated procedurally into canvases at load: conifer
  bark with scale plates, fissures and resin; sawn butt end; painted steel; bare
  steel worn only where trees rub; roller rubber; yard mud, stone and needle
  litter; concrete; netting. No external asset files exist in the project, so
  there is nothing to compress into GLB/KTX2 — the trade is a small download for
  a short procedural build at startup.
- **Shadows** stay on the trunk, branches and machines; needles never cast, and
  a soft contact shadow grounds the tree.
- **Audio** is synthesised with WebAudio and follows the deformation: the shaker
  motor beats at the same rate the tree wobbles, branches rub while they fold,
  needles tick as they land, the net creaks while it is stretched, and each
  branch that springs open gets its own whoosh.

## Controls

One finger, four verbs, big targets: swipe the tree across, press and hold the
safety lever, swipe up and down on the feed rollers, pull the net end down. No
pinch, no rotate, no free camera. Nothing can fail or damage the tree; how long
you shake, how fast you feed and where you grab the net change how much falls,
how the branches rattle and the rhythm of the opening.

The camera is one continuous rig with a shot per beat, solved against the live
viewport so portrait and landscape each get their own framing. Rotating the
device keeps the vibration, compression and net-release state.
