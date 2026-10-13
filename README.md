# Perilune

A reliable, thoughtfully designed control interface for Klipper printers.

Perilune is in early development. It places persistent Moonraker connectivity,
shared printer state, action tracking, and authenticated camera access behind a
self-hosted backend. The browser presents clear progress and reconnecting states
without throwing away inputs.

## Run locally

Requires Node.js 24.13+ and pnpm 12.11.2. Vite+ is installed locally.

```sh
pnpm install
pnpm dev
```

Open http://localhost:5173. This is **simulator mode only**: no physical printer is
connected or controlled. Pause, stop, temperature changes, and disconnects affect
shared demo state. The header toggle compares serif and sans-serif headings.

For a production build:

```sh
pnpm build
pnpm start
```

Open http://localhost:3000. Set `PERILUNE_ORIGIN` to the browser-visible origin when
using a reverse proxy. Settings are read at runtime; rebuilding is unnecessary.

For Docker:

```sh
docker compose up --build
```

Compose binds to localhost:3000 and persists the SQLite database in a volume.
Built-in login is a later milestone; keep remote previews behind an authenticated
proxy. Camera playback and real printer integration are not implemented yet.

## Verify

```sh
pnpm exec playwright install chromium
pnpm validate
```

CI runs formatting, linting, Svelte/TypeScript and Effect diagnostics, domain and
headless Vitest browser tests, a production build, and a two-client production
smoke test. Screenshots are uploaded as CI artifacts. SQLite records action
history; unfinished records are never replayed after restart.

See [architecture](docs/architecture.md), [visual direction](docs/design/README.md),
and [milestones](https://github.com/colecrouter/perilune/milestones).

## Direction

- SvelteKit 3, Effect 4 and Effect language tooling, Vite+.
- Node.js initially; Docker Compose installation.
- SQLite persistence with Effect SQL.
- Live remote queries backed by process-owned services.
- Mobile-friendly controls, guided calibration, and explained printer configuration.
- Built-in authentication, slicer compatibility, notifications, and camera gateway
  integration follow as explicit milestones.

Licensed under GPL-3.0-only. See [LICENSE](LICENSE).
