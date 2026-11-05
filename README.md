# OoglopSite

React single-page site built with Vite, TypeScript and Material UI. AWS infrastructure (CDK) lives in `infra/`.

UI components come from Material UI; the shared theme lives in `src/theme.ts` and is applied in
`src/components/root/App.tsx` with `ThemeProvider` and `CssBaseline`. The planner applies its own
primary (`#fa9549`) and secondary (`#5f668c`) colors from
`src/features/satisfactory_planner/theme.ts`. The planner defaults to dark mode and has a
light/dark toggle in the planner AppBar; the choice is stored in `localStorage` under
`planner-mode`. The current normalized model is auto-saved to IndexedDB and restored when the
planner page is refreshed. The AppBar navigates between the planner and info views and links home;
the info view is conditionally rendered inside the planner, not a separate route.

## Available Scripts

### `npm run dev`

Runs the app in development mode with hot module replacement on [http://localhost:5173](http://localhost:5173).

### `npm test`

Runs the Vitest suite once. Use `npm run test:watch` for watch mode.

### `npm run build`

Type-checks with `tsc` and builds the production bundle to `dist/`.

### `npm run preview`

Serves the production build locally.

### `npm run test:coverage`

Runs the suite with V8 coverage and writes an HTML report to `coverage/`.

### `npm run typecheck`

Runs TypeScript without emitting files.

### `npm run build:game-data`

Regenerates the vendored Satisfactory 1.2 planner dataset from the pinned `Docs/en-US.json`
source. See `src/features/satisfactory_planner/data/README.md` before updating the pin.


## Factory Planner

The home page's Factory Planner tile opens `/planner`. The planner imports a Satisfactory
`.sav`, parses it locally in a Web Worker, and summarizes recipe supply lines, estimated
bottlenecks, power and modeled coverage. Save bytes never leave the browser; there is no backend
and no upload.

- **Routes:** `/` home, `/planner` lazy-loaded planner, unknown paths fall back to home.
- **Local state:** the planner uses feature-local state, not the global Redux store.
- **Checkpoints:** named snapshots live in IndexedDB (`ooglop-planner`), deduplicated by SHA-256.
  They can be exported/imported as JSON and compared as A/B diffs.
- **Unknown content:** modded or unknown production buildings are imported and shown as
  unmodeled. They are excluded from rate math and listed in the coverage card.
- **Limits:** parsing is currently capped at 50 MB. Parse memory is much larger than the file
  (a 5.7 MB public save used roughly 0.8 GB RSS in the spike), so very large saves can still be
  slow or fail. Belt/pipe capacity is not resolved, so physical capacity findings are omitted
  rather than guessed.
- **Fixtures:** `Another-1-2.sav` (139,551 bytes) is the minimal parser fixture. `Release-032.sav`
  (530,536 bytes) is a small real factory with 55 production candidates. Both come from
  `etothepii4/satisfactory-file-parser` commit `9574911`, MIT. The upload screen discovers every
  `fixtures/*.sav` at build time and exposes them in the **Load demo save** dropdown. Provenance and
  save mapping are in `src/features/satisfactory_planner/domain/save-mapping.md`.

### Game data

The planner uses `src/features/satisfactory_planner/data/game-data-1.2.json`, generated from a pinned
Satisfactory 1.2 `Docs/en-US.json`. The dataset, attribution and update steps are documented in
`src/features/satisfactory_planner/data/README.md`. Update it with:

```bash
export PATH="$HOME/.local/bin:$PATH"
npm run build:game-data
```

### Bundle split

`PlannerPage`, React Flow/dagre, the parser worker and the game dataset are split out of the home
chunk. After `npm run build`, confirm that `dist/assets/index-*.js` does not contain the parser or
`game-data-1.2.json` and that `parseSave.worker-*.js` and `PlannerPage-*.js` are separate assets.


### Planner tests and coverage

`npm test` covers normalization (including the committed fixture), rate math, line building,
bottleneck rules, diffing, IndexedDB checkpoints with `fake-indexeddb`, the worker message handler,
the client wrapper, and the planner UI. `npm run test:coverage` reports about 96% statements
overall and about 99% statements on planner domain modules.

Documented coverage exceptions:

- `buildLines.ts` keeps a defensive `UnionFind.find` branch for an id that was never registered;
  the planner always seeds every id, so the branch is unreachable in normal use.
- Two sort comparators in `diffModels.ts` are only exercised when a diff contains multiple
  added/removed entries of the same kind.
- A few UI-only branches (drag-leave flicker, download fallbacks, graph node-cap message) are
  covered manually or by the production build rather than by every RTL path.

## Testing in VS Code

- **Run the site:** `Terminal -> Run Task -> vite: dev`, then open [http://localhost:5173](http://localhost:5173). On Remote-SSH, accept the forwarded port prompt.
- **Debug in the browser:** `Run and Debug -> Vite: Launch Chrome` (starts the dev server automatically; requires Chrome on the machine running the VS Code UI).
- **Watch tests:** `Run and Debug -> Vitest: All`, or `Terminal -> Run Task -> npm: test:watch`.
- **Test Explorer:** install the recommended [Vitest extension](https://marketplace.visualstudio.com/items?itemName=vitest.explorer) to run and debug individual tests from the sidebar.
