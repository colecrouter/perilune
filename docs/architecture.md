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
4. Completed: built-in authentication; external identity remains optional future work.
5. File/slicer workflows, calibration, and explained configuration editing.
6. Installability, configurable push notifications, and layout preferences.

Built-in authentication protects browser-facing state, actions, and media. Compose
binds only to loopback by default. Internet exposure requires a configured HTTPS origin. No real
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

## Local authentication

Better Auth 1.7.7 uses Node SQLite directly, with password and optional passkey
credentials, revocable seven-day sessions, and cookie caching disabled. Its schema
is generated into `src/lib/server/auth/001.sql` and applied once under a versioned
transaction. Auth/enrollment tables share the database file with Effect SQL action
storage. Runtime and CLI migrations recheck their version after acquiring SQLite's
write lock. The private signing secret persists beside SQLite with mode 0600.

Enrollment is server-controlled. A local CLI mints a hashed, expiring setup token;
first enrollment reserves it atomically before asynchronous account creation. Public
Better Auth signup and user creation reject callers without an AsyncLocalStorage
capability. Role fields are server-only. Invitations use the same one-winner claim
with owner-selected roles; raw tokens only appear in the issued link's fragment.
Reservations remain consumed on failure/crash to avoid ambiguous replay. The local
setup-reset command requires stopping an account-free installation first.

Every remote function and camera route checks a current session and required role.
Account mutations revalidate after body parsing. Same-origin checks protect account
POSTs and Better Auth's own origin checks protect auth endpoints. Rate limiting
uses a dedicated header overwritten from the socket by the Node server, and from
Kit's client address by the hook; caller-supplied forwarding headers are ignored.
Behind a proxy, this intentionally shares a rate bucket among that proxy's users.

Continuous camera bodies and live query generators hold separate session leases.
A one-second database sweep catches expiry, account removal, and role changes; local logout/revocation triggers a sweep immediately. Revocation
cancels pending media reads and generators, and leases release on EOF, cancellation,
failed acquisition, or shutdown. Finite operations revalidate session state at
execution. The public health route reveals readiness only.

Recovery requires a stopped server and an explicit `--server-stopped` maintenance
flag. SQLite process ownership rejects a running local server and overlapping
startup/recovery in the supported single process/OS namespace. One process owns
each installation; concurrent hosts/containers sharing a volume are unsupported.
Stopping the server prevents awaited passkey/password mutations overlapping recovery.
The CLI disables the old credential password, deletes sessions and
passkeys, invalidates prior recovery links, and creates a single-use 30-minute
password-reset verification. Password reset also revokes sessions/passkeys. A persisted recovery epoch is
snapshotted before credential verification and attached to new sessions, preventing
an in-flight old-password login from completing after recovery/reset. An auth endpoint allowlist exposes only implemented flows and validates session
epochs before passkey mutations. No
public email-reset sender or open registration is provided. Existing physical
command prohibitions remain enforced independently of account roles.

Headless production tests cover password enrollment/login, roles, CSRF, account
revocation, virtual-authenticator passkey registration/sign-in, and owner recovery.
Domain tests cover signup bypass, role assignment, token races/expiry/replay, and
session lease cancellation. Camera smoke verifies logout closes an already-returned
continuous response. Safari hardware passkey/media checks remain outstanding.

Better Auth’s published peer range still declares Kit 2, despite its Kit 3 integration
documentation. This dependency warning is retained; production Kit 3 password and
passkey flows pass the automated tests. No peer override hides it.

## Motion controls: simulator increment

The Controls page provides an XY travel map with an explicit preview/Move here
step, immediate center and axis-minimum shortcuts, bounded fine jogging, a unified XYZ destination form with a vertical Z preview scale, and top-level homing/motor groups.
Home All establishes all axes in one action. Confirmed motor release invalidates
the selected position and homed state; releasing Z calls out gantry support. Drafts survive telemetry updates; a changed position
invalidates the preview until the operator refreshes it. Near-bed lowering below
5 mm requires a clearance acknowledgement. This threshold is an initial UI policy,
not collision detection.

The shared backend rejects motion while printing, paused, disconnected, unhomed,
calibrating, busy, or missing required telemetry. It checks configured bounds and
all preserved coordinates at admission and again at execution. Pending actions
reserve movement across users; idempotent retries return the original action.
Terminal failures and unknown outcomes remain visible in the controls panel.

Live mode subscribes to toolhead position, travel limits, homed axes, idle timeout,
and manual-probe state, but rejects all movement and homing. The map uses the
[Klipper toolhead coordinate system](https://www.klipper3d.org/Status_Reference.html#toolhead).
Its rectangle represents reported travel extent, not guaranteed reachable bed
geometry or a collision-free path. Kinematic profiles, fixtures, physical command
acknowledgements, and coordinated owner testing are required before live operation.
Temperature history/LayerChart, extrusion, fan controls, and guided calibration
remain subsequent increments.
