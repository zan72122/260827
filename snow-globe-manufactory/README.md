# ちいさな雪の町 — スノーグローブ製造所

A mobile web game for a four-year-old, played entirely with one finger on an
iPhone or iPad. You build a tiny town, seal it inside a glass sphere with snow
and water, turn it over, shake it, and then step inside your own town while the
snow is still falling.

The whole chain is one continuous scene: the workbench, the globe, and the world
inside the globe are the same objects seen from different distances. Nothing
fades to a separate screen.

## The eight steps

| # | Step | Gesture |
|---|------|---------|
| 1 | Place 3–5 miniatures on the base | tap a picture, then drag to move — pieces snap to natural spots |
| 2 | Scoop snow into the open sphere | swipe to tip the scoop |
| 3 | Pump the water in | press and hold; the hanging town sinks under as the level rises |
| 4 | Bubble, gasket, plug, collar | tilt · drag the rubber ring down · push the lid in · turn in a circle |
| 5 | Turn it over | one big arc swipe — 180° |
| 6 | Set it on the pedestal | drag down, then a small circular twist to lock |
| 7 | Shake | left–right swipes; what matters is what happens **after** you let go |
| 8 | Go inside | tap the glass — the camera travels through it down into the town |

Afterwards: shake the same globe again, rearrange the town, start a new one, or
open the shelf. Up to three finished globes are kept in `localStorage` as a few
hundred bytes of layout data — no images, no accounts, no analytics, no ads.

## Running it

```bash
npm install
npm run dev        # http://localhost:5173  (also served on the LAN for device testing)
npm run typecheck  # tsc --noEmit, strict
npm run build      # typecheck + production bundle into dist/
npm run preview    # serve the production build
```

Requires WebGL2. Tested at 390×844 and 844×390 (iPhone) and 820×1180 and
1180×820 (iPad), in both orientations, and across an orientation change at every
step.

### URL options

- `?q=low` · `?q=mid` · `?q=high` — force a quality tier instead of detecting
  one. Useful for QA and for a device the detector misreads.
- `?auto=1` — runs the whole sequence unattended, from the empty base through
  the inside-the-globe trip and back out. This is how the build is verified
  end to end.

## How it is put together

```
src/
  core/      renderer + loop (app), gestures (input), procedural WebAudio,
             device tiering, save data, and the plain-data game state
  world/     dims (one source of truth for the geometry), glass, liquid, snow,
             the miniatures, the town/plug assembly, the workshop, and the rig
             that binds them
  camera/    eased framing plus the scripted path into and out of the globe
  stages/    the step machine and a small tween list
  ui/        DOM overlay and the pictogram set
```

A few decisions worth knowing about:

**Everything is measured from the sphere's centre.** `world/dims.ts` holds the
outer radius, the glass thickness, the plane of the mouth, and the heights of
the cradle and the pedestal. The glass is a dome truncated at the mouth plane,
so the finished globe genuinely sits on its base instead of hovering.

**The globe turns; gravity does not.** During filling the whole assembly is
rolled 180° so its mouth faces up and the town hangs into it — which is how a
real globe is filled, and what makes step 5 pay off. The liquid is solved
analytically against world +Y, so a level waterline, a correct air pocket, and a
bubble that slides to the raised side when you tilt all come out of one uniform.

**Snow lives in the assembly's local frame.** Containment is a single length
test, the ground plane and the rooftop height field stay still however the globe
is held, and gravity is what gets transformed. Flakes are one `THREE.Points`
draw with per-particle size, stepped at a fixed 1/60 s. Nothing collides with
building geometry: settling reads a 32×32 height field, and what lands becomes
snow caps whose opacity is one shared uniform.

**The glass is two single-pass draws.** No render targets and no screen-space
refraction — a far-wall pass and a near-wall pass, with reflections evaluated
from a world-space reflection vector against an analytic room, which is what
keeps the highlight from sticking to the camera when the globe turns. The rim
Fresnel and the thick-edge band carry the read; the centre of the sphere stays
almost clear so the town is never hidden.

**No binary assets.** Wood, frost, snow, enamel and the winter sky beyond the
pane are all generated into canvases at boot, and every sound is synthesised on
first touch.

## Known limits

- Refraction is approximated by the rim, not simulated. Looking through the
  glass does not magnify or displace the town the way real curved glass and
  water would. This was a deliberate trade: multi-pass refraction is the first
  thing that makes the interior hard to read on a phone.
- The glass is not a shadow caster (it would darken its own interior), so the
  globe's contact with the bench is drawn by a decal offset and stretched along
  the key light rather than by the shadow map. Miniatures, tools and the
  pedestal cast real shadows.
- The sequence is fixed. There is no free camera and no free-form editor: the
  camera follows short scripted paths and miniatures snap to nine candidate
  spots, which is what keeps every step reachable with one finger.
- Snow settles onto a coarse height field, so a flake can come to rest a
  centimetre or two off a steep roof edge. At this scale it reads as a drift.
- `DeviceMotion` shaking is an optional extra behind a settings toggle and an
  explicit permission prompt. Every step, including the shake, is completable
  with touch alone.
