# 木の輪から、ひつじの形の木を取り出す
### Reifendrehen — taking one lamb blank out of a turned ring

A small 3D web toy for a four-year-old, on an iPhone or iPad.

A grooved wooden ring is clamped to a workshop bench. It does not look like an
animal. The child feeds a saw inwards until one small wedge comes free, pulls
that wedge out of the ring, and turns it on the table — and the same piece of
wood, seen from a new side, turns out to be a lamb.

The whole point is that **nothing is swapped**. The ring, the wedge and the
notch the wedge leaves behind all come from a single closed 2-D outline —
the lamb's side profile — revolved around the lathe axis. Put the wedge back
and the ring is whole again to within the width of the saw kerf.

## Running it

```bash
npm install
npm run dev        # http://localhost:5173
```

or a production build:

```bash
npm run build
npm run preview    # http://localhost:4173
```

Open it on a phone or tablet on the same network (`--host` is already on) and
play with one finger. Nothing else is needed: no login, no network, no WebGPU.

### Query flags (development only — never shown in normal play)

| flag | what it does |
| --- | --- |
| `?plain=1` | bare turntable: ring and wedge only, no workshop |
| `?debug=1` | numbers, plus the profile outline, the cut plane and the wedge's home position as wireframes |
| `?orbit=1` | frees the camera so the sides and the back can be checked |
| `?auto=1` | skip the title card |

## Checking it

```bash
npm test                            # 36 geometry / motion / view assertions
npx tsx scripts/perf-geometry.ts    # mesh sizes and per-frame rebuild cost
```

The browser scripts drive a running build; point them at it with `BASE`, and
turn the render scale down with `SCALE` if you are on software rendering:

```bash
BASE=http://localhost:4173 node scripts/verify.mjs   # bare-environment shape evidence
BASE=http://localhost:4173 node scripts/flow.mjs     # the whole flow, both orientations
BASE=http://localhost:4173 node scripts/input.mjs    # play it with pointer events only
BASE=http://localhost:4173 node scripts/reset.mjs    # the replay, frame by frame
BASE=http://localhost:4173 node scripts/stroke.mjs   # how much finger travel the cut takes
BASE=http://localhost:4173 node scripts/perf-runtime.mjs
BASE=http://localhost:4173 node scripts/soak.mjs     # 20 replays back to back
```

## How the shape identity is guaranteed

`src/core/profile.ts` holds the only shape definition in the project: a closed
polygon in the meridian half-plane `(radius, height)`. Everything else is
derived from it by `src/core/sector.ts`, which sweeps that polygon between two
boundary surfaces:

```
ring blank   = sector(theta1 .. theta0 + 2pi)     stays clamped
lamb wedge   = sector(theta0 .. theta1)           the child takes this
```

A boundary surface is a plane through the lathe axis, optionally pushed
sideways by half a saw kerf, and optionally pushed only beyond a given radius —
which is exactly what a half-finished cut is. There is no second model, no
morph and no reveal animation; the wedge that comes out is the wedge that was
in there, with the same vertices it was built with.

## Dimensions

Design values for this prototype, not measurements of any historical piece:

| | |
| --- | --- |
| ring outside diameter | 410 mm |
| centre hole diameter | 210 mm |
| ring thickness (hoof to crown) | 60 mm |
| lamb blank length | 99 mm |
| wedge angle | 7.5° — 48 animals per ring |
| saw kerf | 1.6 mm |

A full verification write-up, including what is **not** verified, is in `REPORT.md`.
