# ツリー しゅっかじょう — Tree Shipping Yard

A one-finger, no-text mobile web game for a four-year-old, made to be played in
Safari on an iPhone or iPad. The subject is not decorating a tree. It is the
machine chain a cut tree actually goes through on its way out of a yard:

1. **ブルブル** — clamp the tree on the shaker and hold the safety lever. The
   vibration travels up the trunk, out along the main branches and finally to
   the tips, and only last year's dry needles, a little dust and the odd dead
   twig come off.
2. **ベーラー** — feed the tree butt-first through a steel cone. As the cone
   narrows, each rank of branches folds back toward the trunk, in the order it
   meets the cone.
3. **ネット** — it comes out of the exit ring wrapped in netting, thin enough to
   pass the loading gate it plainly could not fit through on the title screen.
4. **バサッ** — in the delivery hall, pull the net end down. The netting comes
   off from the bottom up and the branches spring open in a wave, lowest rank
   first, overshoot and settle.

After the first tree the guidance thins out and three more shapes come through
the line: one wider and stouter, one with soft weeping branches, one slim but
very densely branched. Same machines, different tree — which is the point.

## Running it

```bash
npm install
npm run dev        # vite dev server
npm run build      # type check + production build
npm run preview    # serve the production build on :4173
npm test           # Playwright: a whole round on a phone and on a tablet
```

`npm test` needs a Chromium with WebGL. In a headless runner, point it at an
installed browser and let the software renderer through:

```bash
PW_CHROMIUM_PATH=/path/to/chrome npm test
```

`tools/capture.mjs` plays the same round and writes one frame per beat to
`/tmp/ctg`, which is how the shots were art-directed.

## Controls

One finger, four gestures, no precision, no pinch, no free camera:

| gesture | what it does |
| --- | --- |
| big swipe right | move the tree to the next machine |
| press and hold | run the shaker (the tree rings down when you let go) |
| swipe up/down | drive the feed rollers; stroke speed sets the feed speed |
| long pull down | strip the netting, one rank of branches at a time |

Nothing the player can do damages the tree or fails. Input differences show up
as *how much* dry material falls, *how* the branches swing, and the *rhythm* of
the opening.

## How it is built

Vite + TypeScript + three.js, rendering through **WebGL 2** so the whole loop
runs on every current iOS Safari. No binary assets: every colour, normal and
roughness map is generated into a canvas at boot, and every sound is
synthesised in the Web Audio graph and driven by the same numbers that drive
the deformation.

### The tree (`src/tree/`)

Not a soft-body sim. A bone rig — trunk chain → main branches → sub branches —
with three separate drivers:

* **shake** (`Tree.poseRig`) samples a rising/decaying envelope at
  `t - delay`, where `delay` is the distance of that bone from the butt divided
  by a wave speed. That single line is what makes the vibration arrive at the
  trunk first and the tips last.
* **fold** (`Tree.applyCone`) asks the baler how wide the tree may be at the
  height each branch has reached, and converts the shortfall into a target
  angle. Branches fold because of where they are in the cone, not because a
  timeline says so.
* **release** (`Tree.releaseTo`) frees each branch as the net front passes its
  base and hands it to an under-damped spring with an inward velocity, while
  each bone along the branch lags its parent — so the wave travels up the tree
  and out along every branch, and overshoots before it settles.

Wood is one `InstancedMesh` (~1700 tapered segments), needle sprays are another
(~5200 real blade clusters, no billboards), so the hero tree costs three draw
calls plus its trunk sections. Crown self-shadowing is baked per spray from how
deep inside the silhouette it sits; the shadow map is spent on the trunk, the
main branches and a whole-tree contact shadow instead.

### The netting (`src/tree/net.ts`)

A real diamond lattice — two sets of helical strands with a knot at every
crossing — whose radius follows the measured crown profile, so it visibly grips
each rank of branches and stretches when they push out. Stripped rows slump into
a crumpled bunch under the butt rather than vanishing.

### Camera (`src/game/director.ts`)

Shots are described by *what has to stay in frame*, not by a lens, so portrait
and landscape both keep the whole subject: the camera moves, the framing does
not stretch. The two establishing frames are staged by hand instead, once per
orientation, because they have to hold two things at once — the crown and the
loading gate thirty metres behind it. Portrait uses a wider lens and vertical framing (tree height, and
the bottom-to-top opening wave); landscape frames the direction of travel and
the whole tree at once. Rotating the device mid-round changes nothing but the
framing — shake state, fold state and net release are all in the simulation, not
the view. There is no cut anywhere in the causal chain: the tree entering the
cone, the branches folding, the netting forming and the narrow gate are one
continuous camera move.

### Performance

`Stage` measures frame time and steps down in this order: resolution scale →
spray density, debris count, shadow map size, radial segments. Sprays that are
dropped make the survivors larger so the silhouette does not open up. Target is
60 fps on a recent iPhone/iPad and a stable 30+ on weaker hardware.

Two query parameters exist for verification and are invisible in play:
`?q=high|mid|low` pins the quality budget, and `?speed=1..8` advances the
simulation in stable sub-steps so an automated pass can play a whole round on a
software renderer.

## What is deliberately absent

No ads, no purchases, no login, no analytics, no management layer, no felling.
No written instructions either: the only sentence on screen is the one for the
grown-up, after the machine has already explained itself —
**おおきな木を ブルブルして ぎゅっと ほそくした**.
