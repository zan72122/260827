# ねている巨木を、街のツリーへ

A mobile web game for a four-year-old, about the day a very large conifer is
stood up in a city square and lit.

The player works a remote construction console in the safe zone outside the
fence. Adults do every dangerous thing on site: the crane operator is in the
cab, the slinger works the hook, the ground crew hold the taglines, the
electrician makes off the connectors. The child never operates plant directly
and is never depicted at height.

The square is invented. No real plaza, tree, company or trademark is
reproduced; the *procedure* is what was researched, not any particular event.

## The chain

One continuous piece of work, each step ending in the state the next one
starts from:

1. **Arrival** — a strapped load on a low-loader, seen low and three-quarters
   on. It reads as a long green package. The finished tree is never shown.
2. **Rigging** — swipe the hook down; two slings are placed at different points
   on the stem.
3. **Raising** — hold the hoist lever. The slings come tight, the stem lifts off
   the bolsters, the branches lag, the tip swings to the sky, and the triangle
   appears for the first time. The camera rises with it in one unbroken move.
4. **Seating** — the same lever lowers the butt into the steel receiver: guide
   plates, centring spike, plate thickness, bark chips, a low thud, then the
   jaws close.
5. **Plumbing** — three guy legs and three tension drums. Three rounds: one
   slack leg with the drum pointed out, then a lean in another direction with no
   hint, then two legs needing a little each. Nothing to read: the leader
   against the buildings, the bullseye level at the base, the slack in the wire
   and the shadow all move together.
6. **Branch release** — the transport straps come off bottom-first and the crown
   opens out. The tree's footprint on the square grows.
7. **Light harness** — wind the reel to pay the sectioned harness out, then winch
   the hoop up the guide rope. The strands hang as a vertical curtain and drop
   to ground anchors.
8. **Star** — an assembled alloy star with lens fixtures, a lifting eye and two
   taglines is craned to the leader; the collar closes and the weight leaves the
   hook.
9. **Sector test** — the proving light climbs from the base and stops at a dark
   sector. Push the big weatherproof connector home and it reaches the top.
10. **Switch-on** — three mechanical lamps, a low tone, the crowd quiets, and the
    player pushes the enable handle. The tree comes up base-to-leader over about
    a second, and the star lights last.

Then the square is a Christmas place, and the replay handle puts the load back
on the trailer.

## What the research fixed

Large public trees of this size are not decorated like domestic ones, and the
game follows the real sequence:

- The tree arrives lying on a trailer, is lifted from its side by a crane, and
  is held by a **steel spike/socket at the base plus guy wires with turnbuckles**
  for fine adjustment — ground conditions and load are never symmetric, which is
  exactly why the plumbing step is a game.
- Lighting is a **pre-sectioned harness**, not fifty thousand individually
  placed bulbs; each sector has its own feed, which is what makes a sector test
  meaningful.
- The lighting method used here is the **vertical curtain**: strands hung from a
  hoop at the leader, falling straight to evenly spaced ground anchors. That one
  choice is applied consistently — the reel, the hoop, the winch, the strand
  geometry and the sector bands all belong to it. (The other common method,
  spiral wrapping from the base, would have implied a different rig entirely.)

Sources consulted for the procedure:
[Union Square tree build (KQED)](https://www.kqed.org/news/10763798/how-the-86-foot-tall-union-square-christmas-tree-is-built),
[Giant commercial tree installation guide](https://www.creativedisplays.com/giant-commercial-christmas-tree-installation/),
[Everest tree install / wiring harness](http://www.allamericanchristmas.com/tree-install),
[large tree services](https://www.pinesandneedles.com/pages/specialist-large-christmas-tree-services),
[mega-tree guying and turnbuckles](https://auschristmaslighting.com/threads/mega-tree-and-tie-down-wire-rope-or-anchor-wire-rope-size-strength.8349/),
[vertical strand vs spiral wrap](https://www.eufy.com/blogs/smart-lights/stringing-christmas-tree-lights).

## Running it

```bash
npm install
npm run dev        # http://127.0.0.1:5173
npm run build      # type check + production build
npm run preview    # serve the build on :4173
npm test           # Playwright: full chain, portrait and landscape
```

The Playwright suite drives the real controls and asserts the completion
rules — bundled crown, monotonic uninterrupted raise, seating and clamping,
three plumbing rounds solved from the tension state, crown growth on release,
harness and star, the sector fault and its repair, a switch-on that ramps rather
than flashes, and the replay. Headless animation frames are throttled on a
software renderer, so the suite advances simulated time itself
(`window.__tree.tick`) instead of waiting it out; every rate limit and
transition it exercises is the shipping one.

## Structure

| Module | Job |
| --- | --- |
| `tree/TreeHierarchy` | Kinematic stem, hierarchical branch springs, instanced limbs and needle sprigs, crown LOD |
| `tree/BranchRelease` | Transport strapping and the bundled-to-open crown |
| `world/Crane` | Outriggers, slew, four-section boom, reeved rope, hook block, rate-limited tracking and stow |
| `rig/SlingAndTaglineRig` | Two webbing slings with load-dependent sag and taglines |
| `rig/BaseSocket` | Steel receiver, guide plates, spike, jaws, touchdown chips and dust |
| `rig/GuyWireTension` | Three-leg tension solver, catenary wires, bullseye level |
| `lights/LightHarness` | Reel, guide rope, hoop, curtain strands, instanced lamps, sector connectors |
| `lights/StarHoist` | Star structure, bridle, taglines, lift path, locking collar |
| `lights/LightingSequence` | Sector test, the fault, the ramped switch-on, per-sector light proxies |
| `camera/CameraDirector` | Named shots, per-axis framing, portrait/landscape behaviour |
| `world/Sky`, `world/Plaza` | Continuous time of day, buildings, window lights, fence, crowd |
| `core/AdaptiveQuality` | Tier selection, DPR ceiling, dynamic resolution, WebGPU-only density boosts |
| `core/Assets` | Optional GLB + KTX2 + Meshopt pipeline (see below) |

### Engineering notes

- The stem is a controlled kinematic body; nothing integrates it. Limbs are on a
  slow, heavily damped angular spring and their outer thirds on a faster one,
  both forced by the stem's angular acceleration — that is what reads as mass.
- Slings are sampled catenaries, guy wires and cables are swept tubes with real
  thickness, and webbing is a ribbon with a face and an edge.
- Lamps are one `InstancedMesh` with a per-instance glow attribute feeding the
  emissive term; the plaza is re-lit by at most five sector light proxies plus
  the star, never one light per lamp.
- The needle canopy is instanced and shuffled so any prefix of the instance list
  is an even covering — the distance LOD cut is invisible.
- Everything runs on WebGL 2. A WebGPU-capable device only earns denser lamps,
  more spectators and a stronger wet-stone reflection; no step depends on it.
- Textures (bark with strap compression marks, sling webbing, galvanised
  spangle, machine enamel, granite setts, cable jacket, fence mesh) are baked
  procedurally at boot, so the repository carries no placeholder art.
- The harness, star and lighting sequence are a lazily imported chunk, built only
  when the build reaches them.
- Drop a compressed `public/assets/plaza-extras.glb` (KTX2 textures, Meshopt
  geometry) and it is loaded and added to the square; without it the procedural
  plaza stands alone.
