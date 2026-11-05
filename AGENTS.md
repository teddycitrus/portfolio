# Agent notes

- Dev server: `npm run dev` (port 5173). On Windows, killing the shell can leave the Vite node process alive and holding the port; find it with `netstat -ano | grep 5173` and `taskkill //PID <pid> //F`, otherwise you keep getting stale CSS.
- Typecheck: `npx tsc --noEmit -p tsconfig.json`. Build: `npm run build`.
- Content lives only in `src/data/content.json`; do not hardcode copy in components.
- Shared contracts: `src/state/useAppStore.ts` (modes and actions), `src/state/runtime.ts` (per-frame mutable state, never React state), `src/state/timing.ts` (transition timeline shared by the camera controller and the DOM veil).
- In dev the store is exposed as `window.__app`.
- Visual checks: `.shots/` (gitignored) holds a headless Chrome harness. `node .shots/shot.mjs <desktop|mobile> <scenario>` writes `.shots/out/<device>-<scenario>.jpg`; run one scenario per invocation, since software WebGL is slow. `node .shots/probe.mjs "<js>"` evaluates in the page.
- `public/og.jpg` is a 1200x630 capture of the overworld (`node .shots/og.mjs`); regenerate it when the scene or HUD changes.
