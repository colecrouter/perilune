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
proxy. Physical printer controls are not implemented yet.

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

## Camera gateway

Perilune can use an existing go2rtc instance without exposing camera addresses to
browsers. Set its backend-reachable HTTP API base:

```sh
PERILUNE_MOONRAKER_URL=ws://printer.local:7125/websocket \
PERILUNE_CAMERA_BASE_URL=http://go2rtc.local:1984/ pnpm dev
```

The backend discovers the first enabled Moonraker webcam with a registered go2rtc
`src` name. It refreshes camera settings on change notifications and periodic
checks. Alternatively set `PERILUNE_CAMERA_SOURCE=printer_camera` to select a
registered stream explicitly. Dynamic RTSP URLs and FFmpeg directives are rejected;
configure those sources in go2rtc. Remove the base URL to disable media.

Use a browser-compatible H.264 stream. Perilune selects video only and proxies
fragmented MP4 and JPEG snapshots under fixed same-origin URLs. MediaSource-capable
browsers receive a continuous MP4 stream with a small live buffer; browsers without
MediaSource use native HLS when supported.
No transcoding is added by Perilune. go2rtc handles the existing camera connection,
remuxing, and snapshot generation. Unsupported snapshots fail independently of video.

Playback pauses when the tab is hidden or when you choose **Pause view**. Connection
failures retry with backoff. **Capture image** downloads a fresh source JPEG; it is
not saved on the server or transformed by display rotation/flips. Camera settings
changes invalidate old media sessions and refresh the player. Media responses use
`no-store`, and clients receive no upstream addresses or stream names.

Pass these variables to the Node process or through Compose's `.env`/shell settings.
The go2rtc address must be reachable from inside the container; container localhost
refers to the container itself. Keep Perilune behind an authenticated proxy until
built-in login ships. Native HLS fallback has more buffering latency; WebRTC and
additional codecs are future work.

## Verify

```sh
pnpm exec playwright install chromium
pnpm validate
```

CI runs formatting, linting, Svelte/TypeScript and Effect diagnostics, domain and
headless Vitest browser tests, a production build, and a two-client production
smoke test, plus live-protocol and encoded-camera production smoke tests. Screenshots are uploaded as CI artifacts. SQLite records action
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
