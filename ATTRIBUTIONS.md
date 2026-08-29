# Attributions

## Third-party code

| Package | Version | Licence | Use |
| --- | --- | --- | --- |
| [three.js](https://github.com/mrdoob/three.js) | 0.180.0 | MIT | WebGL renderer, scene graph, PBR materials |
| `three/examples/jsm/environments/RoomEnvironment.js` | 0.180.0 | MIT | Procedural room used to bake the image-based lighting probe |
| [Vite](https://vitejs.dev/) | 7.x | MIT | Build tooling (development only) |
| [TypeScript](https://www.typescriptlang.org/) | 5.9.x | Apache-2.0 | Type checking (development only) |

## Art, textures, audio

Every visual and audible asset in this game is generated at runtime by the
project's own code. There are no downloaded, purchased, scanned or
AI-image-generated assets, and therefore nothing here that needs a third-party
licence or a placeholder that has to be swapped before release.

- **Textures** — `src/materials/textures.ts` writes each map into a `<canvas>` at
  load time: sponge crumb and crust, whipped cream (wall, cut face), strawberry
  skin with achene dents, stainless grind and use scuffs, bench, cake board and
  wall tiling. Normal maps are derived from the matching height fields in the
  same file.
- **Geometry** — the cake, the strawberries, the knife, the cake server, the
  palette knife, the piping bag, the slicing guide and the kitchen props are all
  built from parametric definitions in `src/cake/` and `src/scene/`.
- **Strawberry cross-sections** — solved at cut time from the same shape
  function that builds the berry mesh (`src/cake/crossSection.ts`); no painted
  cross-section artwork exists in the project.
- **Sound** — synthesised with the Web Audio API in `src/audio/audio.ts`
  (filtered noise and simple oscillators). No sample files.
- **Fonts** — system font stack only; no webfont is downloaded.

## Network

The game makes no network requests after the initial page load. There is no
analytics SDK, no advertising, no login, no purchase flow and no telemetry.
