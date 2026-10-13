# Architecture and decisions

## Process-owned services

SvelteKit 3 and Vite+ serve a shared dashboard in simulator or read-only live mode. A process-scoped Effect
ManagedRuntime owns a single PrinterService, its worker, temperature ticker, and
SQLite-backed ActionStore. Browser connections never own these resources.

`query.live` adapts the service's SubscriptionRef changes into a streaming query.
Each client receives a complete snapshot with a monotonic revision. A new stream
receives current state immediately. Per-stream iterators close when the request,
server shutdown, or HMR generation ends. `sveltekit-effect` owns finite request
execution only; its documented lifecycle does not cover streaming iteration.

The Node entrypoint configures private adapter origin headers and overwrites them
for every request. PERILUNE_ORIGIN optionally sets the canonical browser origin
at runtime. Otherwise local HTTP derives the host from the request. Forwarded
headers supplied by clients are not trusted. TLS/HTTP2/HTTP3 belong at the edge.

## Actions

- Commands are validated with Effect Schema and assigned client-generated UUIDs.
- SQLite durably records payload, status, and creation time before acceptance.
- Reusing the same UUID and payload returns the existing action; conflicting reuse fails.
- One worker serializes simulated execution and validates current printer state.
- Disconnected actions remain queued for at most 30 seconds. The queue is bounded to 20.
- Connection generations remember even brief disconnect/reconnect cycles during
  sending and mark their outcome unknown, without replay.
- A restart marks both queued and sending records unknown. Automatic durable queue
  recovery is deliberately not implemented in this first simulator slice.
- Terminal status persistence and state application use one SubscriptionRef
  transition, preventing stale snapshots from overwriting telemetry or connectivity.
- Storage failures settle the affected action as unknown in memory and visibly
  pause admission. Recovery retries status writes only, never command execution.
- Expiry is rechecked immediately before simulated execution.
- A simulated completion is immediate state application. Real Moonraker commands
  will need separate acknowledgement and physical completion semantics.

The simulator begins with a fixed example print. Temperatures approach targets;
print progress is fixed. Reset restores the example and preserves action history.
This application-service demo is separate from the WebSocket protocol fixtures used to test live integration.

## Persistent read-only Moonraker

`PERILUNE_MOONRAKER_URL` selects live mode at process startup. A scoped Effect
MoonrakerService owns one native Node WebSocket and a bounded exponential reconnect
loop. JSON-RPC requests have deadlines; a periodic `server.info` round trip detects
silent connections and distinguishes Moonraker reachability from Klipper readiness.
Only identification, server info, object discovery, and status subscription RPCs
are available. There is no arbitrary RPC or physical command API.

A process-owned bridge consumes transport snapshots into PrinterService. Browser
lifetimes never create printer sockets. Full initial subscription status replaces
cached object state; notifications merge field deltas. Discovery limits subscriptions
to objects actually available. Unavailable heaters and slicer layer information are
null, rather than fictional values. Remaining time is an estimate based on elapsed
print duration and file progress, not a slicer prediction.

Live initialization is immediate with unknown values, so a slow/offline printer does
not block rendering. Reconnects retain last known values with a telemetry timestamp.
Shutdown/startup retain visible readings while indicating that Klipper is unavailable.
All live action admission is rejected before persistence; simulator connection/reset
methods cannot change live state. Physical command policies are a separate milestone.
URLs, API keys, raw server errors, and printer configuration stay out of client state.

## Browser and interface

Safari 16.4+, Chrome 110+, Firefox 115+ are provisional transpilation/polyfill
targets. Actual Safari 16.4 device verification remains outstanding. Capability
checks will govern media, push, and installation. Native browser tests currently
use headless Chromium.

The UI keeps editable drafts independent of incoming printer state. It separates
server transport health from simulated Moonraker connectivity. Pause/stop controls
are disabled when connectivity is insufficient; temperature actions can queue
while the simulated printer is disconnected. Stop offers independent bed/nozzle
cooldown choices. Bits UI supplies the dialog and typography toggle primitives.

## Camera gateway

A process-scoped CameraService maintains the public descriptor, generation,
allowlisted media sessions, and in-flight request controllers. Configure a trusted
HTTP(S) go2rtc base server-side. Select a registered source explicitly, or discover
it from the first enabled Moonraker webcam's `src` query. Dynamic source URLs and
FFmpeg directives are rejected. Discovery runs on backend heartbeat/change
notifications and never exposes raw webcam URLs to the browser.

The gateway proxies continuous H.264-only fMP4 to MediaSource browsers, and requests
go2rtc HLS/fMP4 for native-HLS fallback. It rewrites playlist and init/segment references
to fixed Perilune endpoints with opaque session tokens. Upstream origins, headers,
redirects, errors, and source identifiers remain private. Routes accept only known
resources and parameter shapes. Requests are bounded by deadlines, response sizes,
session count, and concurrency; caller abort, Effect interruption, source changes,
and runtime disposal cancel upstream work. All media responses are `no-store`.

H.264 passes through go2rtc's remuxer; audio is excluded and Perilune starts no
transcoder. Continuous HTTP response bodies retain upstream controllers until
cancelled or ended, respect backpressure, cap individual chunks, and use startup
and renewable read-inactivity deadlines. MediaSource playback appends bytes
sequentially and prunes old buffers, keeping playback near the live edge. Native
HLS is a fallback where MediaSource is unavailable.
The player rebuilds on descriptor generation changes, retries failures with backoff,
and releases resources when hidden or explicitly paused. Rotation/flips affect video
display, with swapped portrait dimensions for quarter turns and untransformed UI
controls. Source JPEG downloads use a separate bounded endpoint and can fail without
interrupting video. No captures are persisted.

Native HLS buffering latency remains a tradeoff. Direct camera protocols, WebRTC, automatic
codec fallback/transcoding, multiple cameras, and notification capture retention
are future work. The synthetic production fixture verifies H.264 decode, two
viewers, source changes, old-session invalidation, snapshots, orientation, narrow
mobile layouts, clean EOF/reconnect, and preserved drafts. Real-camera validation does not commit private
footage. Safari 16.4 device verification remains outstanding.

## Dependencies

The published legacy plugin 0.1.1 handles both Kit 2 and Kit 3 build lifecycles;
no local dependency patch is needed. Its required Kit peer range is
`^2.0.0 || ^3.0.0`. Production smoke tests verify hydration and that the stable
polyfill URL is served without immutable caching.

Oxfmt handles supported files; Prettier with its Svelte plugin handles `.svelte`
files. Tabs are the default. Effect's language service is enabled in TypeScript
and patched during prepare so its diagnostics also appear in checks.

## Next milestones

1. Completed: protocol-level Moonraker simulator and persistent read-only WebSocket adapter.
2. Real command policies, reconciliation, cancellation macro behavior, priority stop.
3. Completed: go2rtc camera gateway and source-change propagation; broader media protocols follow.
4. Built-in authentication and validated external identity.
5. File/slicer workflows, calibration, and explained configuration editing.
6. Installability, configurable push notifications, and layout preferences.

Authentication is not implemented. Compose binds only to loopback by default.
Remote development instances must stay behind existing authentication. No real
printer commands, migrations, configuration writes, heating, or motion are performed
by live mode. Simulator commands only alter demo state.

## Protocol references

- [Moonraker WebSocket JSON-RPC](https://moonraker.readthedocs.io/en/latest/external_api/introduction/)
- [Server state and client identification](https://moonraker.readthedocs.io/en/latest/external_api/server/)
- [Connection authorization](https://moonraker.readthedocs.io/en/latest/external_api/authorization/)

This milestone maps the primary extruder and heated bed. Multiple toolheads,
additional temperature sensors, richer capability controls, and slicer-derived
remaining-time estimates are future work.

Camera references: [go2rtc HLS](https://github.com/AlexxIT/go2rtc/tree/master/internal/hls),
[go2rtc MP4](https://github.com/AlexxIT/go2rtc/tree/master/internal/mp4), and
[Moonraker webcam API](https://moonraker.readthedocs.io/en/latest/external_api/webcams/).

Real-source testing caught Chromium incompatibility with go2rtc's HLS and native
progressive-MP4 playback for the owner's main stream. go2rtc's MediaSource player
worked; feeding the same fMP4 through Perilune's HTTP gateway into MediaSource
then successfully decoded the main video without transcoding. The native HLS
fallback remains unverified on Safari hardware.
