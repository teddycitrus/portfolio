# John Mannully, portfolio

An interactive portfolio rendered in Three.js. You look through a telescope at five planets (About, Projects, Awards, Skills, Contact), dive into one, and walk its surface to read the monuments standing on it. Everything is also available as a plain, readable page through "Read as page".

Built with Vite, React 18, TypeScript, React Three Fiber, drei, postprocessing, zustand and Tailwind.

## Controls

| Where | Desktop | Touch |
| --- | --- | --- |
| Orbit | Move the mouse to look, drag to pan, click a planet or press 1 to 5 | Drag to look, tap a planet |
| Surface | The cursor locks on landing: move the mouse to look, WASD or arrows to walk, Shift to run, click the monument under the crosshair. Esc frees the cursor, a click on the scene locks it again | Joystick to walk, drag to look, tap a monument |
| Anywhere | R opens the reader, Q or Esc goes back | Back and Read buttons |

## Architecture

The app is one WebGL canvas plus a DOM layer on top. A single zustand store holds the scene mode and selections; per-frame data (pointer, drag, keys, projected screen positions) lives in plain mutable objects so the render loop never triggers React renders.

```mermaid
flowchart LR
  subgraph Input
    bridge["useInputBridge<br/><sub>pointer lock, drag, keys, shortcuts</sub>"]
  end
  subgraph State
    store[("useAppStore<br/><sub>mode, planet, beacon, reader</sub>")]
    runtime[("runtime.ts<br/><sub>per-frame mutable state</sub>")]
  end
  subgraph Canvas["R3F canvas"]
    overworld["OverworldScene<br/><sub>planets, stars, telescope camera</sub>"]
    surface["PlanetSurfaceScene<br/><sub>sky, terrain, beacons, walk camera</sub>"]
    transition["TransitionController<br/><sub>dive and launch camera</sub>"]
    fx["Effects<br/><sub>bloom, ACES, vignette</sub>"]
  end
  subgraph DOM["DOM UI"]
    hud["OverworldHud, PlanetHud, TourBar<br/><sub>labels, dock, chips</sub>"]
    panel["BeaconPanel<br/><sub>content for focused beacon</sub>"]
    reader["Reader<br/><sub>full page fallback</sub>"]
    veil["TransitionVeil"]
  end
  content[("content.json")]

  bridge -->|"look, keys"| runtime
  bridge -->|"shortcuts"| store
  store --> overworld & surface & transition & hud & panel & reader & veil
  overworld -->|"planetScreen"| runtime
  surface -->|"beaconScreen, focus"| runtime & store
  runtime -->|"rAF markers"| hud
  content --> overworld & surface & hud & panel & reader
  hud -->|"travelTo, glideToBeacon"| store
  transition -->|"arriveAtPlanet / arriveAtOverworld"| store
```

Scene modes always move in this order:

1. `overworld`: telescope view, where the site opens. Hovering a planet (in 3D or in the dock) highlights it; clicking calls `travelTo`.
2. `transitioning-in`: the camera dives toward the drifting planet. The veil fades to the destination sky colour from 1200 ms and the mode switches at 1600 ms, always under full cover.
3. `planet`: the camera settles from above onto the spawn point and the veil lifts. On desktop the cursor is locked for mouse look (released whenever the reader or the tour needs it). Walking near or looking at a monument focuses it and opens its panel.
4. `transitioning-out`: the camera launches upward, the veil covers at 900 ms and the mode returns to `overworld` at 1500 ms. Planet-to-planet travel is chained: the launch is cut at 900 ms and the next landing happens 450 ms later, all under the veil.

```mermaid
sequenceDiagram
  actor V as Visitor
  participant H as OverworldHud
  participant S as useAppStore
  participant T as TransitionController
  participant W as TransitionVeil
  participant P as PlanetSurfaceScene
  participant B as BeaconPanel
  V->>H: click "Projects" (or press 2)
  H->>S: travelTo("projects")
  S-->>T: mode = transitioning-in
  T->>T: dive camera toward planet
  S-->>W: fade to planet colour
  T->>S: arriveAtPlanet() at 1600 ms
  S-->>P: mount surface, camera settles
  W-->>V: veil lifts
  V->>P: click a monument
  P->>S: glideToBeacon, setFocusedBeacon
  S-->>B: render project content
  Note over V,B: Project details shown beside the monument, camera framed to keep it visible
```

Guarantees and limits:

- Content lives only in `src/data/content.json`. The 3D monuments, the HUD chips, the panel and the reader are all generated from it.
- Planet and beacon layout is computed, not authored: planets are fitted to the viewport (a horizontal arc on landscape, a zig-zag on portrait) and beacons sit on a 94 degree arc in front of the spawn point.
- Without WebGL (or if the context is lost or the 3D tree throws), the canvas is never mounted and the reader becomes the whole site.
- The URL hash mirrors the view (`#/projects/proj-iris`, `#/read/awards`), so any planet, monument or reader section can be linked, and the browser Back button moves between planets.
- The render loop pauses while the reader is open.
- `prefers-reduced-motion` replaces camera flights with a short crossfade and removes head bob.
- Each surface matches its planet from orbit: basalt and lava rifts on Awards, an island in shallow water on Skills, a mesa above a cloud deck on Projects. Walking is clamped to 30 units, or to the island or mesa edge.
- Post-processing renders in linear HDR with ACES tone mapping; only values above 1.0 bloom (sun, lava, glints, focused seams). Touch devices drop multisampling and film grain.

## Getting started

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # type-checks and builds to dist/
npm run preview  # serves the production build
```

To change what the site says, edit `src/data/content.json`. Each planet lists its beacons; a beacon's `kind` (`profile`, `project`, `award`, `skills`, `link`) decides how it is drawn and how its content is rendered.
