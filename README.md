# 雪を走るベル / Sleigh Bell Harness Run

A single-horse sleigh-bell game for a four-year-old, played in a browser on an
iPhone or an iPad. There is no written language anywhere in it.

One loop of play runs:

**warm tack room → fit bells to the leather strap → shake the finished strap →
put it on the horse → the horse's first step, and the first sound it makes →
a sleigh ride across the snow → arrive at a lit village → go round again.**

The whole game is built around one chain of cause and effect: bells go onto a
strap, the strap goes onto a horse, the horse moves, and *that* is what makes
the bells ring. Nothing rings because a timer said so.

## Running it

```bash
npm install
npm run dev        # http://localhost:5173  (also served on the LAN for phones)
npm run typecheck  # tsc --noEmit
npm run build      # typecheck + production build into dist/
npm run preview    # serve the production build
```

Requires Node 20+. WebGL 2 is the quality baseline; nothing here needs WebGPU.

## The seven beats

| Scene | What the player does | What the game shows |
| --- | --- | --- |
| 1 Tack room | nothing — one bell rolls | near: bench edge and strap end · mid: the working strap under the lantern · far: the stall, the horse, the cold window |
| 2 Fitting | drags bells onto the strap | the shank slides through the hole, the leather dents, the keeper turns a quarter turn behind, the strap takes the weight |
| 3 Trying it | shakes the strap left and right | single bells become an irregular cloud |
| 4 Harnessing | drags the strap to the horse, then pulls the buckle closed | the adult holds it up; the leather settles onto the neck and moves with the breathing |
| 5 First step | one short forward swipe | in one shot: the shoulder moves, the leather answers late, the bells tilt, the balls strike, the hoof lands |
| 6 The ride | swipes to ask for a step, a walk or a gentle trot; taps to look at the bells | barn → open road → trees → a small hill → the village |
| 7 Again | picks one of three pictures | same run again · change the bells · just walk about |

There are no obstacles, no collisions, no failure, no timer, no score, and no
star rating. The horse cannot bolt, shy, or fall.

## What was built rather than faked

**Bells.** Each bell is a stamped brass shell with a real cross-shaped hole cut
in its geometry (faces removed, not a dark decal), two sound holes, an equator
crimp, a foot plate, and a shank riveted through the leather with a keeper on
the far side. The shell is rigid on the strap, as a riveted bell is. What moves
is the loose ball inside: a point mass constrained to the shell's interior,
driven by gravity and by the strap's own acceleration as a pseudo-force. Its
collisions with the wall are the *only* thing that schedules a bell sound. Two
or three bells — the ones a close shot can reach — run the full three-axis
solver; the rest run the same solver in the plane the strap swings in.

**Leather.** The strap is a 26-node verlet chain with distance constraints for
its length, a second-neighbour constraint for its bending stiffness, per-node
inverse mass so a heavy bell drags its part of the strap down further than a
light one, ellipsoid colliders it must lie *on top of*, and a rectangular tube
mesh so it has thickness and a visible cut edge at both ends. On the bench it
is guided straight in plan and left free to sag vertically, which is where the
bells' weight reads. On the horse it is pulled toward a rest path round the
neck, loosely at the throat and tightly at the buckle, so it stays where a
buckled strap stays while still lagging behind the stride.

**The horse.** A CC0 skinned model with a 56-bone anatomical rig (see
`public/assets/CREDITS.md`). Stride length drives clip playback rate, so the
hooves never skate. Ground contacts are read off the foot bones' world height
with a self-calibrating threshold, not assumed from the clip — that is what
makes the hoof, the puff of snow, the track and the sound land together.
Breathing scales the ribcage and paces the vapour; the ears flick. There is no
face animation, no eyebrows and no smile: the calm is in the ears, the neck and
the breath.

**Sound.** Nothing is a recording and nothing is a loop. Three bell sizes are
rendered offline at boot as short modal samples — an inharmonic partial stack
plus the metallic transient of the ball hitting brass — then retuned, filtered
by strike strength and panned per bell. Hooves, leather, the iron buckle, the
runners hissing on packed snow, the horse's breath and a thin wind are all
built from filtered noise and swept tones. Strikes are spread by tens of
milliseconds according to bell index and size, so a stride never lands as a
chord. Walk and trot differ in event *density* and spectral mix, not only in
level. The context is created and resumed inside the first touch; there is a
mute button and a volume slider.

**Snow.** One displaced plane, a compacted road ribbon dished into it, ploughed
banks either side, instanced conifers in two tiers (near ones keep their
colour, far ones lose saturation and contrast but keep their shape), and a ring
buffer of quads for the tracks the runners and hooves leave. Shadows are cast
only by the horse, the strap, the sleigh, the handler and the ground near them.

## Input

Pointer Events only, with mouse, pen and touch on one state machine.

* Bell hit areas are measured from where the finger *landed*, at a radius never
  smaller than a thumb tip, and the drop test ignores how high the bell is held.
* The buckle closes with one thick drag; letting go part-way eases back a
  little and never resets.
* Speed snaps to three coarse bands — a step, a walk, a gentle trot. A fast
  flick can never exceed the trot band. Letting go coasts down.
* Nothing on the strap may move more than 25 cm in one step, so rapid taps and
  reversed swipes cannot teleport the leather or the bells.
* The main interaction sits in the middle of the screen, clear of the OS edge
  gestures; the only chrome is a speaker and a slider in the top corner.
* `prefers-reduced-motion` slows the camera moves and removes the hand-held
  micro-movement.

## Orientation

Turning the device re-composes the bench: in landscape the strap lies across
it, in portrait it runs away from the player up the tall frame, and the loose
bells move between a row and two short columns. Fitted bells are stored by
socket index, so not one of them is lost in the turn. During the ride, a tall
frame switches to a depth composition — horse low, road and destination running
up the screen — while a wide frame gets the authored side and rear-three-quarter
beats.

## Performance

The device is tiered at boot from memory, cores and screen area, and re-tiered
from a rolling frame-time average. Quality comes off in a fixed order: snow
particles, distant tree density, shadow map resolution, environment probe
refresh, pixel ratio. Gait, bell swing and audio scheduling are never scaled
down.

## Layout

```
src/
  core/      app (renderer, loop, resize), pointer state machine, quality tiers
  audio/     context and buses, bell modal synthesis, foley
  world/     textures, materials, bells, strap, horse, harness, tack room,
             winter (terrain, route, trees, village, tracks), props, sky
  camera/    the shot director
  ui/        the on-screen furniture
  game.ts    the seven beats and everything that connects them
tools/       the browser harness used to drive and photograph the game
```

## Testing aids

`tools/shoot.mjs` drives the built game in Chromium through real Pointer
Events and photographs it at iPhone and iPad sizes. Two debug hooks exist for
it and are harmless in play:

* `?speed=N` multiplies the simulation's time step, so a whole run fits in a
  reasonable number of frames under a software rasteriser.
* a URL hash (`#fitting`, `#shake`, `#harness`, `#step`, `#ride`, `#trees`,
  `#hill`, `#arrival`) jumps straight to a beat.

```bash
npm run preview &
PW_CHROME=/path/to/chrome node tools/shoot.mjs iphone-p full
```

## Assets and licences

The horse — mesh, 56-bone rig and the walk/trot/idle clips — comes from the
Mesh2Motion asset set and is **CC0 1.0**. Everything else is generated by this
project. Full detail, including how the model was re-graded rather than used
as shipped, is in `public/assets/CREDITS.md`.
