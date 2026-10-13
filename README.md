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

Open http://localhost:5173. By default this is **simulator mode**: no physical printer is
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
proxy. Camera playback and physical printer controls are not implemented yet.

## Connect a real printer (read-only)

Set a direct Moonraker WebSocket endpoint on the **backend**:

```sh
PERILUNE_MOONRAKER_URL=ws://printer.local:7125/websocket pnpm dev
```

The URL stays on the server. Use `wss://` where TLS is available. If Moonraker
requires authentication, set `PERILUNE_MOONRAKER_API_KEY` separately. Do not put
credentials or query parameters in the URL. For production, pass these variables
to the Node process; Compose reads them from your shell or local `.env` file.
Plain `pnpm dev` and `pnpm start` read process environment variables, not `.env`.

Live mode discovers available objects and displays job state and temperatures.
Missing readings appear as unknown. Perilune and Moonraker reconnect independently;
last telemetry and editable drafts remain visible. Klipper startup, shutdown, and
unavailable states are separate from the Moonraker connection. Controls are disabled
and the backend rejects all actions in live mode, including simulator commands.
No physical commands are sent. Remove the URL to return to simulator mode.

The backend connects directly to Moonraker; existing browser-facing Cloudflare
Access protection does not authenticate this connection. Keep the app behind your
existing authenticated proxy until built-in login ships.

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
