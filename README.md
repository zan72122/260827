# Lauscha Glass Ornament Workshop — 20–30 second prototype

**ガラスをあつくして、ふーってして、まるいキラキラかざりを作る。**

A mobile web prototype for four-year-olds, set in a traditional Lauscha glass
ornament workshop. It is deliberately *not* an encyclopaedia of the craft: it
exists to make one thing land inside a single sitting —

> *at first it is a slightly mysterious place; then you turn the glass in the
> fire and blow into it, it swells, and it turns into play.*

- **Signature actions:** drag sideways to turn the tube in the flame, then
  swipe up (or press and hold) to blow.
- **Middle peak:** the red-hot glass going *puku* — the bubble pushing out.
- **Final peak:** a plain hot tube suddenly reading as a finished Christmas
  ornament, hanging on its hook and swinging with weight.
- **Replay hook:** "when I went *fuu*, the red glass went *puku*."
- **No text anywhere on screen.** All coaching is a translucent hand doing the
  gesture in the lower third of the frame.

## Run it

Any static file server; ES modules will not load from `file://`.

```bash
python3 -m http.server 8000        # then open http://localhost:8000/
```

three.js is vendored under `vendor/`, so the game runs with no network access
and no build step.

### Debug query parameters

| parameter | effect |
|---|---|
| `?tier=low\|mid\|high` | force a quality preset instead of detecting one |
| `?res=0.5` | scale render resolution (rescue hatch / test harness) |
| `?fixeddt=1` | advance the show by a fixed step per frame (harness only) |

## The one unbroken take

The camera is never under the player's control. It is a declarative chain of
shots; each shot says *stand here, look at this, and make this much of the
world fill the frame*, so the framing survives every phone aspect ratio.

| phase | camera | who acts |
|---|---|---|
| `establish` | the whole bench: window, shelf, hands, burner | — (3.3 s) |
| `approach` | in to the tube tip and the flame | — (1.6 s) |
| `spin` | action close-up | **child: drag sideways** |
| `macro` | material macro of the softening, sagging tip | — (1.25 s) |
| `blow` | frames the bubble, widening as it grows | **child: swipe up / hold** |
| `silver` | the mirror climbing inside the ball | **child: drag sideways** |
| `colour` | colour and lamé go on | **child: touch** |
| `finish` | off the tube, onto the hook, swinging | — (≈4 s) |
| `again` | back to the tube, straight into the signature move | loops |

There is no screen change, no menu and no loading break anywhere in the chain.
A child who reaches for the screen during `establish` or `approach` skips
ahead: touching is already the answer to the invitation.

**A first run:** about 5 drags to bring the tube up to heat, 4 puffs to blow it
out, 4 drags to silver it and one touch for the colour — roughly 25 seconds
from the first frame to the ornament swinging on its hook. Every ornament made
stays hanging on the stand, so the second run starts with the first one in
frame.

## Local causality (the part that has to be felt, not read)

*Turning* is what heats the glass. Heat is stored **per angular sector of the
material**, not as one global number: the flame only works on the side facing
it, so leaving the tube still gives you one glowing stripe, and only turning
carries every sector through the flame. "It went red **because I turned it**"
is therefore true in the simulation, not just in the animation. A few seeds
(bubbles) in the tubing keep the rotation legible before it glows.

*Blowing* is what inflates it. Each puff is a spring impulse with overshoot and
a decaying wobble, one `puku` sound and one haptic tick per quarter — never a
smooth automatic fade.

If a child does nothing, the hint appears after ~1 s, grows after 5.5 s, and
after 8.5 s the game starts helping a little. It never dead-ends and it never
takes the action away from them.

## Input rules

One finger, whole screen. Extra pointers are ignored rather than fighting the
first one, and **there is no small hit target anywhere** — the gesture is read
from the entire canvas. The hint hand sits in the lower third and the subject
is framed above the centre of the screen (`bias` per shot), so the child's own
hand never covers the glass they are changing.

## Rendering

WebGL2 is the baseline and everything the game has to communicate survives on
the `low` tier. WebGPU is *not* used as a renderer and is never required; its
presence is read only as one hint that the device has a modern GPU stack, and
it can only add resolution, shadow size and particle count.

Five hero materials, and no sixth:

| material | how it is done |
|---|---|
| clear glass | `MeshPhysicalMaterial` transmission, real wall thickness, IOR 1.52 |
| red-hot glass | emissive injected per vertex from the sector heat, plus local flame light |
| small flame | nested cones, animated value noise, additive, one flickering point light |
| silvered mirror | a second lathe just inside the wall, metal, revealed by a rising liquid line in the shader |
| coloured lamé | tint mixed into that mirror, plus animated speckle locked to the surface and a light particle burst |

The glass itself is a surface of revolution whose profile is re-evaluated every
frame — a morph, not a fluid sim. It carries a genuine wall (outer wall up,
inner wall back down, closed at the tip), the wall thins as the bubble grows,
the neck pulls thin, and the hot part sags along gravity in the piece's own
tilted frame. Nothing is baked: expansion is the profile, heat is emissive plus
light, silvering is a shader switch, lamé is faked with cheap particles.

## Layout

```
index.html          entry, import map, hint layer
css/style.css       full-bleed canvas, wordless hint animations
src/main.js         renderer, loop, resize, adaptive resolution
src/director.js     the phase machine and the whole show
src/camera.js       the automatic camera chain
src/glass.js        the tube -> bubble -> ornament (profile morph, sector heat)
src/workshop.js     room, bench, burner, shelf, window, tools, hands
src/flame.js        flame shader + embers
src/particles.js    lamé burst, snow
src/input.js        one finger, whole screen
src/hints.js        wordless gesture coaching
src/audio.js        fully synthetic sound, no asset files
src/env.js          procedural environment map and textures
src/quality.js      device tiering
tools/              headless screenshot / playthrough harness (dev only)
vendor/three*.js    three.js r180, vendored (MIT, see vendor/THREE.LICENSE)
```
