# OoglopSite

React single-page site built with Vite and TypeScript. AWS infrastructure (CDK) lives in `infra/`.

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

## Testing in VS Code

- **Run the site:** `Terminal -> Run Task -> vite: dev`, then open [http://localhost:5173](http://localhost:5173). On Remote-SSH, accept the forwarded port prompt.
- **Debug in the browser:** `Run and Debug -> Vite: Launch Chrome` (starts the dev server automatically; requires Chrome on the machine running the VS Code UI).
- **Watch tests:** `Run and Debug -> Vitest: All`, or `Terminal -> Run Task -> npm: test:watch`.
- **Test Explorer:** install the recommended [Vitest extension](https://marketplace.visualstudio.com/items?itemName=vitest.explorer) to run and debug individual tests from the sidebar.
