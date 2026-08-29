# しろい かべの ひみつ / The Secret Inside the White Wall

A short mobile web game for a four-year-old. A finished strawberry shortcake is
sealed in plain white cream, so its inside is a mystery. You cut it, draw one
slice towards you, and the red, white and yellow layers appear for the first
time. Then you build the inside of a second cake yourself — where the
strawberries go, how they face, how the gap is filled — and cut it to see the
cross-section your own arrangement produces.

## Running it

```bash
npm install
npm run dev        # http://localhost:5173
```

Production build and type check:

```bash
npm run build      # tsc --noEmit && vite build  -> dist/
npm run preview
```

The build output is static; serve `dist/` from any file host.

## Controls

One finger only. A tap, a wide drag, or a single-direction swipe — never a
pinch, a two-finger rotate, or a free camera.

| Beat | Input |
| --- | --- |
| Cut | Swipe from the rim of the cake towards its centre |
| Turn the board | Drag the turntable sideways; it settles into its detent |
| Serve a slice | Drag towards yourself |
| Place a strawberry | Drag a slice from the tray onto a dip in the cream |
| Turn a strawberry | Tap a slice you already placed |
| Fill the gaps | Drag the piping nozzle across the layer |
| Close the cake | Drag the top sponge onto the middle |
| Aim the cut | Drag around the top edge |

## How the cross-section stays honest

`src/cake/design.ts` holds the placement list — slot, orientation, size and
slice thickness for every strawberry. That list is the only source of truth:

- the meshes the player drags into place are built from it,
- and when the cake is cut, `src/cake/crossSection.ts` marches the cut plane
  across the very same analytic berry definition to solve the true outline of
  each cut face.

There is no pre-rendered cross-section image anywhere in the project, so the
revealed face cannot disagree with what the player put inside.

## Checked in a real browser

The whole loop was driven end to end in headless Chromium (WebGL 2, software
rasteriser) — cut, turn, cut, draw the slice out, walk to the build bench,
place nine slices, change one slice's orientation with a tap, pipe the cream,
close with the top sponge, watch the coat go on, aim, cut, draw the second
slice out, and start another round — at:

- 390 x 844 (iPhone-class portrait)
- 844 x 390 (iPhone-class landscape)
- 820 x 1180 (iPad-class portrait)

with a device pixel ratio of 2. Every touch target the game asks for is on
screen at each of those sizes, and the point being filled sits above the
finger, not under it.

### Known limits

- The cut direction is chosen from 24 detents and the slice is always an
  eighth of the cake; placements are the eight ring positions plus the
  centre. Cross-sections are solved for whatever combination results, but the
  combinations themselves are a finite set.
- Berries that straddle a cut are truncated with clipping planes and closed
  with a solved cap, not with a real boolean, so a berry lying almost exactly
  in the plane of the cut can show a very thin sliver of a face.
- The turntable settles into its detent on release rather than spinning
  freely; there is no free-wheeling throw.
- Audio is synthesised, so it starts only after the first touch (browser
  autoplay policy).

## Rendering notes

- WebGL 2 is the baseline; everything the game needs runs on that path.
- Device pixel ratio is capped and adjusted at runtime to hold the frame budget.
- Textures are generated procedurally at load, in steps, behind the loading bar.
- Clipping planes (not real-time booleans) truncate the berries that straddle a
  cut; cap meshes generated from the same shape definition close those faces.

See `ATTRIBUTIONS.md` for licences.
