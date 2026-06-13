# Repository Guidelines

## Project Structure & Module Organization
`server.js` is the Node.js entry point and owns HTTP routing, auth, sessions, and persistence. Static client code lives in `public/`, with source files such as `public/app.js`, `public/admin.js`, and their built outputs (`*.min.js`, `*.min.css`). Tests are under `tests/`, and deployment helpers live in `scripts/`. Runtime data is written to `data/` and should not be committed.

## Build, Test, and Development Commands
Use `npm ci` for a clean install. `npm run build` regenerates minified assets and the build manifest. `npm test` runs the Node test suite in `tests/e2e.test.js`. `npm run lint` performs syntax checks on the main JS files. `npm start` verifies the build artifacts and starts the server.

## Coding Style & Naming Conventions
Use CommonJS modules, semicolons, and ASCII-only edits unless existing files already require Unicode. Keep logic explicit and prefer small helper functions over deep nesting. Follow existing naming patterns: `camelCase` for functions and variables, `PascalCase` only when introducing new component-like abstractions, and `kebab-case` for script filenames.

## Testing Guidelines
The repository uses Node’s built-in test runner. Add or update tests in `tests/e2e.test.js` when behavior changes, especially for authentication, admin actions, and persistence. Name tests as short behavioral statements, for example `admin login accepts plain password configuration`. Run `npm test` after server or API changes and `npm run build` after touching client assets.

## Commit & Pull Request Guidelines
Recent commits use short, imperative messages with a scope or outcome, such as `fix: stabilize auth flows and unify admin UI` or concise Chinese summaries. Keep commits focused and avoid mixing unrelated edits. Pull requests should describe the behavior change, list verification commands run, and include screenshots for visible UI updates.

## Security & Configuration Tips
Do not commit secrets, runtime data, or generated admin credentials. Environment-specific values belong in `/etc/default/secure-chat` on VPS deployments. If you change auth or deployment behavior, update `README.md` and the Debian scripts together so local and production flows stay aligned.
