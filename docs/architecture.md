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
the initial demo’s print progress is fixed, while explicitly started simulator jobs advance. Reset restores the example and preserves action history.
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
5. Completed: Jobs file library and upload-only slicer gateway; calibration and explained configuration editing remain.
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
step, bounded fine jogging, a unified XYZ destination form with a vertical Z preview scale, and top-level Home All/Disengage motors actions.
Home All establishes all axes in one action. Confirmed motor disengagement invalidates
all positions and homed state; releasing Z calls out gantry support. Drafts survive telemetry updates; a changed position
invalidates the preview until the operator refreshes it. Near-bed lowering below
5 mm requires a clearance acknowledgement. This threshold is an initial UI policy,
not collision detection. Exact destinations use number fields or the interactive
XY/Z previews and a single full-width Move here action. Fine jog distance uses
a keyboard-accessible segmented radio group (0.1, 1, and 10 mm).

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
Temperature history is implemented below. Extrusion, fan controls and guided calibration
remain subsequent increments.

## Temperature monitoring and controls

Overview uses LayerChart for one selected sensor at a time: gradient area beneath the solid actual-temperature line
and a dashed, stepped target, with 5-minute, 15-minute, and 1-hour windows. Current
values remain visible alongside direct hover/tap inspection with a marker on the plot and keyboard
arrow navigation. Time/domain changes use a 350 ms scale transition, disabled
while inspecting and for reduced-motion preferences. The plot initially uses the
available recorded span instead of an empty full-hour window. Null readings
split paths rather than joining across unavailable intervals; dark/light comparison
colours preserve contrast. Heater labels are inferred from actual/target difference
(holding within 2°C; cooling after target zero while above 35°C), not PID telemetry.

A process-scoped Effect worker samples every five seconds independently of browser
subscriptions. Connection/readiness transitions also record immediate samples so
short disconnects leave gaps. The in-memory buffer retains up to an hour and 721
samples, shared across users and page reloads; backend restart resets history.
A finite authenticated query refreshes the UI every five seconds, with one request
in flight and timer cleanup on unmount. Readiness gaps never reuse stale readings.

The dashboard combines printer and camera into one authenticated live query, with
complete recoverable snapshots because Kit can coalesce live-query values. History
is fetched separately rather than resending its whole buffer on every printer tick.
This avoids exhausting HTTP/1's browser connection pool with multiple tabs, media,
and live queries. Session revocation closes the combined query and camera body.

Moonraker discovery supports extra extruders, generic heaters, temperature fans,
and temperature sensors, capped at 30 extras while preserving essential subscribed
objects. Additional sensors/heaters can be charted and inspected read-only. Missing
primary capabilities are hidden after discovery; loading fields retain drafts.

Simulator temperature changes and atomic nozzle/bed cooldown use the shared action
queue, idempotency, and terminal outcomes. Admission and execution check readiness,
telemetry, storage, and configured simulator limits. Drafts remain until matching
target telemetry confirms a submitted change, including after failed/unknown actions.
Live heater commands and hardware-dependent limits remain a later coordinated
command-testing milestone. History is not a persistent print archive or notification
service; durable job records and alerts remain subsequent work.

## Lunar branding

A shared MoonMark uses Cole Crouter's posterized telescope photograph under a
calculated waxing-crescent SVG mask. The rail, account entry and repository assets
share that texture. Authenticated root layout owns one favicon link and observes
the existing deduplicated dashboard query; Controls now also uses that query so
navigation retains one held stream per tab. Initial favicon subscription failure
cannot block page rendering. Whole-percent progress changes render a 64px PNG
with projected illumination proportional to progress; pause/unavailable badges
preserve the last phase. Guest pages and idle jobs use the static crescent.
The brand study, PNG logo and repository social-preview card live in static/brand;
see docs/branding.md for source attribution and usage.

## Jobs and slicer uploads

A process-owned JobService stores a simulator G-code library in SQLite via Effect
SQL. Files are immutable by ID: retries of identical name/content return the same
file, while differing content under an existing name is rejected. The library is
bounded to 100 files / 200 MiB, with text `.gcode` uploads limited to 20 MiB.
Two whole uploads can be in progress; additional uploads fail admission instead
of retaining bodies. Stream reads have byte limits, 60-second deadlines, abort
cleanup and closed readers. Other operations have bounded admission (20) and
request/session/shutdown interruption. PNG thumbnails are size/dimension checked
and served through authenticated same-origin endpoints; SVG/HTML thumbnails are
excluded. Comments provide slicer estimates only, never executable inspection.

The file selection and search draft survive five-second finite library refreshes.
The existing dashboard query remains the single held stream per tab. Simulator
starts reference a persisted file ID through the existing idempotent action queue;
readiness and file existence are checked again at execution. Pending starts reserve
the printer across users, and active/pending files cannot be removed. Explicit
confirmation starts a simulation that advances 1% per second, pauses without
advancing, and completes after 100 ticks. This timing is unrelated to slicer
estimates. Existing pause/stop/cooldown controls and unknown-outcome handling apply.
File commit and catalog publication are a short uninterruptible section after a
final execution-time authorization check: cancellation can leave a saved file,
but cannot leave the shared catalog stale. Retrying the identical file is safe.

The shared observed-session history persists across restarts, retains up to 500
records and shows the newest 50. Restarts and live connection loss interrupt an
unfinished observed session; a reconnect begins a new observation rather than
claiming it is the same physical print. History storage failures are visible and
retried. This is not authoritative Moonraker history import or a print scheduler.

Live mode polls a bounded Moonraker G-code listing every 30 seconds from a
process-owned worker. Startup renders immediately while discovery proceeds.
Inspection fetches sanitized metadata on demand; upstream reads have eight-second
deadlines, size limits, cancelled controllers and no redirects. Up to 500 live
files are presented. Cached files remain visible during failure. Live uploads,
deletes and physical starts remain prohibited. Real-device file-library validation
and physical command testing remain outstanding; protocol fixtures cover this slice.

Operators can issue upload-only slicer keys from Jobs. Keys are hashed at rest,
expire after 90 days, are individually revocable, and are bound to an active
operator/owner and its authentication recovery epoch. They authorize only the
Moonraker-compatible `/server/info`, `/server/files/roots` and
`/server/files/upload` subset. Print requests are rejected; unrelated APIs still
require browser sessions. Native slicers omit Origin, so the Node entrypoint fills
it only for the exact upload endpoint with a correctly shaped API-key header.
The route then validates the actual key; foreign Origin is never rewritten and
cookie-only mutations still require same-origin protection. No global CSRF
exception is configured. Automatic upload-and-print, binary G-code/3MF, folders,
file overwrite, G-code visualization and live writes remain future increments.

The headless Jobs production smoke verifies uploads, inspection, shared controls,
PNG serving, file-in-use guards, 320px layout, API-key revocation and native-slicer
multipart behavior. Automated Vitest workers are capped at four to keep concurrent
service/browser tests within predictable local and CI resource use.
