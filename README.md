# John Mannully, portfolio

An interactive portfolio rendered in Three.js. You look out of a ship's observation deck at five planets (About, Projects, Awards, Skills, Contact), fly down to one, and walk its surface to read the monuments standing on it. Everything is also available as a plain, readable page through "Read as page".

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
    surface["PlanetSurfaceScene<br/><sub>sky, terrain, monuments, wildlife, walk camera</sub>"]
    screens["BeaconScreens<br/><sub>orbiting panels, in-world content screens</sub>"]
    transition["TransitionController<br/><sub>burn and launch camera</sub>"]
    ship["Cockpit<br/><sub>deck frame, canopy, descent, shake</sub>"]
    fx["Effects<br/><sub>bloom, AgX, contrast, vignette</sub>"]
  end
  subgraph DOM["DOM UI"]
    hud["OverworldHud, PlanetHud, TourBar<br/><sub>labels, dock, chips</sub>"]
    panel["BeaconPanel<br/><sub>bottom sheet on phones</sub>"]
    reader["Reader<br/><sub>full page fallback</sub>"]
    veil["TransitionVeil"]
  end
  content[("content.json")]
  drone["drone.ts<br/><sub>Web Audio chord pad, critter calls</sub>"]

  bridge -->|"look, keys"| runtime
  bridge -->|"shortcuts"| store
  store --> overworld & surface & transition & hud & panel & reader & veil
  overworld -->|"planetScreen"| runtime
  surface -->|"beaconScreen, focus"| runtime & store
  runtime -->|"rAF markers"| hud
  surface --> screens
  surface -->|"critterCall"| drone
  store -->|"focusedBeaconId"| screens
  store -->|"mode, planet key"| drone
  content --> overworld & surface & hud & panel & reader & screens
  hud -->|"travelTo, glideToBeacon"| store
  transition -->|"arriveAtPlanet / arriveAtOverworld"| store
  transition -->|"heat"| runtime
  runtime -->|"flight speed, heat"| ship
  store -->|"mode"| ship
  ship -->|"shipSound"| drone
```

Scene modes always move in this order:

1. `overworld`: the view from the ship's observation deck, where the site opens. The camera turns inside a fixed cockpit (bulkhead, canopy window, dashboard with two live displays), and the planet layout is fitted to 84% of the lens so every planet stays inside the window. Hovering a planet (in 3D or in the dock) highlights it; clicking calls `travelTo`.
2. `transitioning-in`: the ship swings onto the planet in 280 ms and burns toward it on an accelerating curve for 760 ms while the lens widens, light streaks rush past and the cabin shakes harder with speed. From about half way the canopy glows with entry plasma in the planet's accent, the veil fades to the destination sky from 560 ms and the mode switches at 760 ms, always under full cover.
3. `planet`: the ship descends from 15 units up and 9 behind, nose down, decelerating onto the spawn point over 540 ms while the veil clears in 380 ms; the legs take the weight with a damped dip, then the cockpit frame expands past the screen edges in 220 ms. Click to walking takes about 1.5 s. On desktop the cursor is locked for mouse look (released whenever the reader or the tour needs it). Walking near or looking at a monument focuses it. On desktop its orbiting panels fan out into screens once the viewer is within 7.5 units; on phones the bottom sheet opens instead.
4. `transitioning-out`: the camera launches upward, the veil covers at 900 ms and the mode returns to `overworld` at 1500 ms. Planet-to-planet travel is chained: the launch is cut at 900 ms and the next landing happens 450 ms later, all under the veil.

```mermaid
sequenceDiagram
  actor V as Visitor
  participant H as OverworldHud
  participant S as useAppStore
  participant T as TransitionController
  participant W as TransitionVeil
  participant P as PlanetSurfaceScene
  participant B as BeaconScreens
  V->>H: click "Projects" (or press 2)
  H->>S: travelTo("projects")
  S-->>T: mode = transitioning-in
  T->>T: burn toward planet, canopy heats up
  S-->>W: fade to planet sky
  T->>S: arriveAtPlanet() at 760 ms
  S-->>P: mount surface, ship descends and touches down
  W-->>V: veil lifts, cockpit frame clears at about 1.5 s
  V->>P: click a monument
  P->>S: glideToBeacon, setFocusedBeacon
  S-->>B: focusedBeaconId = proj-iris
  B->>B: panels ease out on a bowed path, face the camera, grow into hologram screens
  Note over V,B: One screen per part (title, video, description, highlights, stack) beside the monument
```

Guarantees and limits:

- Content lives only in `src/data/content.json`. The 3D monuments, the HUD chips, the panel and the reader are all generated from it.
- Planet and beacon layout is computed, not authored: planets are fitted to the viewport (a horizontal arc on landscape, a zig-zag on portrait) and beacons sit on a 94 degree arc in front of the spawn point.
- Without WebGL (or if the context is lost or the 3D tree throws), the canvas is never mounted and the reader becomes the whole site.
- The URL hash mirrors the view (`#/projects/proj-iris`, `#/read/awards`), so any planet, monument or reader section can be linked, and the browser Back button moves between planets.
- The render loop pauses while the reader is open.
- `prefers-reduced-motion` replaces camera flights with a short crossfade, removes head bob, shake and light streaks, and shows the cockpit only in orbit.
- The cockpit is drawn in front of everything but never takes a click (its meshes skip raycasting). Its shake and descent are offsets the rig adds after the camera controllers and removes before the next frame, so controllers always see their own pose.
- On a planet the top bar holds only Back to orbit and Read as page. A link monument (Contact) opens its link when clicked while focused; its title screen and button are links too, and with the cursor locked, a click with the crosshair on a screen's link or button presses it.
- Each surface matches its planet from orbit: basalt and lava rifts on Awards, an island in shallow water on Skills, a mesa above a cloud deck on Projects. Walking is clamped to 30 units, or to the island or mesa edge.
- Every planet has one architecture for its monuments (obelisks, art deco towers, classical columns, pagodas, gothic arches), and each monument on a planet takes a different form of it by its index (for example column, twin columns with a beam, tholos and victory column on Awards). Proportions vary from a hash of the id, and the floating crown carries its meaning (award tier, project glyph).
- Beacon screens are real DOM (drei `Html` in transform mode, portalled into `#screen-layer` between the canvas and the HUD), so links, the video and keyboard focus work. They lay out in up to three columns on a plane 3.2 units in front of the camera, on whichever side of the monument has room, and shrink to fit the view. They fold back past 8.5 units. Deployed screens have rounded corners and float, each bobbing and swaying slightly on its own rhythm. Each panel flies on a time-based ease-in-out (1.35 s out, 1 s back, 0.16 s stagger) along a slightly bowed path. Panels are drawn by a hologram shader (`hologram.ts`): distance to the morphing outline drives a noise-eroded, fizzing edge with specks, a rim glow, scanlines, a refresh band and a rare flicker, and each panel seeds its own scan angle and density, dot grid, edge width and tint.
- Wildlife is picked by planet style: gulls on Skills, birds and deer on Contact, hopping aliens and birds on About, glowing drifters on Projects, nothing on Awards. Birds are one instanced mesh with wing flaps in the vertex shader. The animals notice the viewer: walkers inside 13 units come over and follow at about 2.4 units, fanned out on their own sides, face the viewer when stopped, greet a viewer who stands still (deer prance and bob, hoppers spin-hop), skip back when rushed, and lose interest after 60 s or past 24 units. They walk around monuments and each other. Two birds swoop down to circle a viewer who stands still for 3 s and leave when the viewer walks on; drifters within 15 units hover around the viewer. A click on any animal makes it greet. Reduced motion keeps them still.
- The ambient pad is synthesised (detuned saws through a slow lowpass and a generated reverb) in each planet's `key` from content.json. It walks an eight-chord progression with voice-led triads and a bass (I vi IV V I iii ii V in major, i VI iv V i III VII V in minor, harmonic-minor V), so every phrase cadences home; each V holds a suspended fourth and resolves it halfway through, and soft chimes land on chord tones. Chords last 8 s on a planet and 11 s in orbit with a 3.2 s overlap; a new key restarts on I and blends over 4 s. It sits at 0.08 gain in orbit against 0.2 on a planet. The flight has its own sounds (thrust kick, rising rush and entry rumble on the burn, retro hiss and a touchdown thud on landing). Animal calls (chirp, squeak, mew, boop) are short synthesised sweeps levelled by distance, panned around the camera and rate-limited. It starts on the first click or key press; the Sound toggle is stored in `localStorage` and suspends the audio context when off.
- Type is one self-hosted family, Archivo (expanded cut for display, normal for text), with JetBrains Mono only for key caps and handles. No font CDN.
- Post-processing renders in linear HDR with AgX tone mapping and a light contrast lift; only values above 1.0 bloom (sun, lava, glints, focused seams). Touch devices drop multisampling and film grain.

## Getting started

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # type-checks and builds to dist/
npm run preview  # serves the production build
```

To change what the site says, edit `src/data/content.json`. Each planet lists its beacons; a beacon's `kind` (`profile`, `project`, `award`, `skills`, `link`) decides how it is drawn and how its content is rendered.
