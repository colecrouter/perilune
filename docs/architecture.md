# Architecture and decisions

## Process-owned services

SvelteKit 3 and Vite+ serve a shared dashboard in simulator or live mode (read-only by default). A process-scoped Effect
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

## Persistent Moonraker transport

`PERILUNE_MOONRAKER_URL` selects live mode at process startup. A scoped Effect
MoonrakerService owns one native Node WebSocket and a bounded exponential reconnect
loop. JSON-RPC requests have deadlines; a periodic `server.info` round trip detects
silent connections and distinguishes Moonraker reachability from Klipper readiness.
Identification, server info, object discovery, subscription, and fenced status refresh RPCs are available. A narrow mesh command API is gated by PERILUNE_LIVE_MESH; there is no arbitrary browser RPC/G-code API.

A process-owned bridge consumes transport snapshots into PrinterService. Browser
lifetimes never create printer sockets. Full initial subscription status replaces
cached object state; notifications merge field deltas. Discovery limits subscriptions
to objects actually available. Unavailable heaters and slicer layer information are
null, rather than fictional values. Remaining time is an estimate based on elapsed
print duration and file progress, not a slicer prediction.

Live initialization is immediate with unknown values, so a slow/offline printer does
not block rendering. Reconnects retain last known values with a telemetry timestamp.
Shutdown/startup retain visible readings while indicating that Klipper is unavailable.
Generic live controls remain read-only unless `PERILUNE_LIVE_CONTROLS` is enabled (see shared live-action coordination below). The opt-in cold bed mesh workflow has a separate persistent command lifecycle described below. Simulator connection/reset methods cannot change live state.
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
5. Completed: Jobs file library and upload-only slicer gateway; guided simulator calibration, opt-in live cold bed mesh, and the configuration workspace are implemented; broader live controls/configuration writes remain.
6. Physical-device push/install acceptance and layout preferences.

Built-in authentication protects browser-facing state, actions, and media. Compose
binds only to loopback by default. Internet exposure requires a configured HTTPS origin. Live mode is read-only by default. The explicitly enabled live bed mesh controller
can home, probe, manage mesh profiles, and save configuration through its reviewed
workflow. Other real movement, heating, job commands, and configuration editing
remain disabled. Simulator commands only alter demo state.

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

The Jobs shared layout server load and authenticated library endpoint apply
validated URL queries to the bounded process-owned catalog. Filtering and stable
sorting precede 10/25/50-row pagination; clients receive only that page. This is
server-side catalog querying, not SQL pagination: the existing 100 local / 500
mirrored-file bounds remain. Missing metadata sorts last; incomplete Moonraker
metadata disables material filters and material/estimate sorting until inspection
has populated the whole catalog. Large library storage/SQL indexing remain future
work.

TanStack Svelte Table 9 owns column visibility and manually paginated row markup.
Semantic tables, real header/page/file links and GET forms support SSR/no-JS
browsing. Enhanced navigation keeps the shared layout and desktop inspection pane;
mobile selected routes show details directly. Missing files get an explained
state. Svelte adapters are bundled for dev SSR via noExternal. No additional query
client or held stream is introduced. Primitive URL dependencies prevent ordinary
invalidation from overwriting drafts or dismissing dialogs.
The file selection and search draft survive five-second finite library refreshes.
The existing dashboard query remains the single held stream per tab. Simulator
starts reference a persisted file ID through the existing idempotent action queue;
readiness and file existence are checked again at execution. Browser pause/resume/stop controls bind the reviewed filename and run identity, so an old
stop dialog cannot affect a replacement job, including a new run of the same file.
Pending starts reserve
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

Operators can issue upload-only or explicitly print-enabled slicer keys from Jobs. Keys are hashed at rest,
expire after 90 days, are individually revocable, and are bound to an active
operator/owner and its authentication recovery epoch. They authorize the
Moonraker-compatible `/server/info`, `/server/files/roots` and
`/server/files/upload` subset. Print-enabled keys additionally authorize `/printer/print/start`; unrelated APIs still
require browser sessions. Native slicers omit Origin, so the Node entrypoint fills
it only for the exact upload endpoint with a correctly shaped API-key header.
The route then validates the actual key; foreign Origin is never rewritten and
cookie-only mutations still require same-origin protection. No global CSRF
exception is configured. Binary G-code/3MF, folders,
file overwrite, G-code visualization and live writes remain future increments.

The headless Jobs production smoke verifies uploads, inspection, shared controls,
PNG serving, file-in-use guards, 320px layout, API-key revocation and native-slicer
multipart behavior. Automated Vitest workers are capped at four to keep concurrent
service/browser tests within predictable local and CI resource use.

## Guided simulator calibration

Calibration has a process-owned session in PrinterService, using the same bounded
idempotent action queue. The authenticated RPC binds an actor ID/name/role and an
authorization recheck to queued calibration actions; clients cannot select their
actor. Session ID plus monotonically increasing version prevents stale
adjustments/dialogs from mutating a new step or session. Idempotency is also bound
to the submitting actor for calibration commands. Readiness/ownership are checked
at admission and execution. Other motion, heater changes and print starts are
blocked while active; cooldown remains available. Account owners can explicitly
confirm cancellation of an abandoned operator session.

Preparation requires a ready, idle, homed simulator and heater targets off, plus
an acknowledged checklist. Fine adjustments change a bounded relative candidate
(−2..+2 mm) in 0.005/0.01/0.05/0.1 mm steps. They do not move a nozzle or mutate an
actual Klipper probe offset. First-layer examples are educational diagrams, not
printed or detected results. Review leads to either temporary process application
or a saved simulator default, with separate confirmation for saving/cancelling.

Migration 003 adds server-bound calibration action actor IDs and a single simulator
calibration checkpoint. Each calibration transition and completed action status
commit in one SQLite transaction, followed by uninterruptible state publication.
On ambiguous storage failure, action status becomes unknown, unsaved candidate
state is interrupted, and only status/checkpoint recovery is retried. Recovery
reads the durable saved default, including a write that committed before losing
its acknowledgement; it never reruns the command. The UI instructs the operator
to check the saved default after recovery.

Ten minutes without a step/adjustment interrupts the process-owned session and
releases controls. Browser unmounts and transport reconnects do not own this lease.
Simulator printer disconnects interrupt the session. Backend restart interrupts
unfinished sessions and discards temporary application, restoring only the saved
simulator default. Draft checklist/increment choices persist through state updates;
first-layer selection resets on a new session ID. Dialogs capture the reviewed
session/version instead of following incoming values.

This Z-offset workshop does not emit physical G-code, print a test, or write printer configuration. Live Z-offset commands remain rejected. Probe calibration,
print-time first-layer tuning, thermal/contact validation and supported printer
capabilities require coordinated owner testing before implementation/enabling.
Headless calibration smoke uses synthetic accounts, two owner tabs, operator and
viewer sessions to verify ownership, stale saves, locked motion, shared state,
temporary/saved outcomes and 320px layouts. Domain/service tests cover expiry,
revocation, restart, before/after-commit ambiguity and no replay.

Printer UI actions suppress verified no-ops: already-homed axes disable homing,
matching heater drafts disable Set, and zero targets disable cooldown controls.
These are UI affordances; deliberate backend command capabilities remain intact.
Unknown/disconnected telemetry is not treated as a fulfilled condition. Calibration
printer-state checkboxes derive automatically from fresh shared telemetry; manual
cleanliness/clearance acknowledgements remain user-owned drafts. Stop-dialog heater
choices retain their original intent while already-off options are annotated and
disabled, so concurrent target changes do not silently alter cancellation intent.

## Read-only bed mesh inspection

Calibration includes `/calibration/mesh`, a top-down reported-sample height map,
coordinate selection, numeric table, saved-profile inspection and compatible-grid
comparison. Bed mesh status comes through the existing process-owned Moonraker
subscription and shared dashboard stream. No additional socket, polling worker,
G-code, profile activation, probing or configuration writes are introduced.

Normalization accepts finite rectangular 2..65 by 2..65 sample grids, ordered
from minimum Y/minimum X, with increasing finite bounds. Coordinate magnitudes
are limited to 1,000,000 mm and heights to 1,000 mm. Up to 32 profile entries and
32,768 total samples (including the active grid) are exposed; omitted/invalid
profiles are annotated. Unknown, cleared, malformed and valid flat grids are
distinct. Interpolated matrices and unrelated upstream fields are not published.
Saved profile data is derived from Klipper status, not private config files.

The heat map uses a symmetric zero-centered teal/neutral/lavender scale and an
accessible numeric fallback. It displays reported probed-matrix values, which may
include substituted/extrapolated values on faulty regions or round beds. Range
is descriptive, not a leveling verdict. Comparison computes selected minus
reference only for matching dimensions/bounds; no interpolation or reference
alignment is invented. Measurement time, thermal conditions and probing provenance
are unavailable. Simulator examples are explicitly synthetic. View selections
remain through telemetry changes and reconnect; retained data is marked stale
whenever browser transport or printer readiness is unavailable. Physical probing,
profile management and measured printer validation remain future milestones.

The Calibration navigation button opens a Bits UI menu of workflow links, with
keyboard navigation, focus return and a portaled mobile menu. Bed mesh freshness
also requires a telemetry-ready marker: ready transport alone is insufficient
until the current connection's initial object subscription completes. Prior mesh
data remains visible during this interval. Shutdown/readiness/reconnect transitions
reset the marker; a delayed-subscription regression covers this distinction.

An alternate isometric wireframe uses LayerChart's built-in isometric projection,
height channels, Spline/Circle marks, and transform drag rotation. No custom 3D
renderer or new dependency is introduced. Rotation/tilt sliders and reset provide
alternatives to dragging; scroll zoom is disabled. Height amplification is explicitly
labeled (1/25/100/300×), with true millimetre axes and unchanged numeric samples.
The display floor is the lower Z-domain bound, reserving room for negative heights without changing signed readings. Straight lines connect the reported grid, not an inferred compensation surface.
Only one mesh inspector is visible at a time; top-down remains the default and numeric
inspection/table stay available. There is no animated or continuously running scene.

## Guided simulator bed mesh probing

The Calibration mesh page has a Probe bed preparation dialog, automatic readiness,
idle/homing/heater-target checks and manual cleanliness, area-clearance and synthetic
run acknowledgments. The cold simulator plan is fixed to 25 samples over X/Y
20..200 mm and is validated against travel limits. Heater targets off does not mean
cooled surfaces. Live mode uses the separate opt-in workflow described below.

MeshProbeState lives in PrinterService and owns the shared motion/calibration lease
through probing and review. A process-scoped worker advances one deterministic
synthetic sample per second (not actual probe timing). Browser navigation/reconnect
never owns the worker. Queued begin/finish/cancel commands use the existing bounded,
expiring action lifecycle with admission and execution validation. Begin run IDs
must equal the unique persisted action ID, preventing recycled run identities;
idempotency is bound to the authenticated actor. Only the initiating operator can
keep results; account owners can explicitly cancel abandoned workflows. Progress
is not versioned, so a cancellation isn't invalidated by a newly observed sample,
but dialogs capture the immutable run ID and cannot affect replacement runs.

A candidate is reviewed in its own keyed inspector, with no profile/comparison
selection that could silently substitute an older mesh. The ordinary inspector's
drafts are retained separately while hidden. Temporary use changes only the active
simulator mesh until process restart. Save creates a named new profile, never
activates or overwrites a profile, and supports up to 30 user profiles (40-character
ASCII names). Existing active/saved meshes remain unchanged by cancellation.

Migration 004 stores the simulator mesh checkpoint in SQLite. Begin/finish/cancel
checkpoint and action terminal status commit atomically; progress is transient,
while review/interrupt checkpoints are recorded. A restart interrupts unfinished
runs and temporary application, restores fixture defaults, and retains saved
profiles. Printer loss, revoked operator access or ten-minute expiry interrupts
an unfinished workflow. Storage failure marks unknown outcomes, discards unsaved
results and releases controls; recovery reads committed profiles and never replays
probe/finish commands. Before/after-commit acknowledgement-loss tests cover this.

Domain/service/browser tests cover readiness/ownership/expiry, bounded profiles,
run identity, restart semantics, cancellation and failed storage. A seventh headless
production smoke verifies preparation, progress while navigating away, shared
observers/viewers, true candidate display despite earlier profile selection,
saving and owner cancellation, with 320px preparation. These simulator tests are separate from the live workflow below.

## Live cold bed mesh workflow

PERILUNE_LIVE_MESH=true explicitly enables live mesh actions. Other live controls,
including Z-offset, job start/stop, motion and heater setting, remain read-only.
LiveMeshService uses process-scoped Effect workers, the existing shared printer
snapshot and action history, and migration 005's separate live_mesh_workflow
checkpoint. The default server configuration remains read-only.

The supported initial plan is rectangular bed_mesh with a discrete probe/bltouch,
without homing_override, overrides of the mesh/homing/save commands, faulty regions, circular meshes or extra reference probing.
Only normalized bounds/count/offset/sample count and pending-config state reach the
browser; raw printer configuration remains backend-only. Probe offsets are checked
against nozzle travel. The cold run requires ready fresh telemetry, no active/paused
job or other calibration, heater targets zero, and observed temperatures at most
40°C. The operator reviews physical cleanliness/clearance and actual homing/probing.
Unhomed axes trigger G28; plan, readiness and prior mesh identity are revalidated
before homing and again before probing. Commands from external clients can still
change state after a validation; this is not a lock enforced by Moonraker.

An incomplete/omitted profile list or insufficient bounded sample/profile capacity prevents a new probe, and incomplete fresh profile discovery prevents saving. Existing internal run names are also rejected rather than overwritten.

Admission atomically writes an actor-bound idempotent action and workflow reservation
before dispatch. Queue capacity is one; undispatched actions expire after 30 seconds.
The persistent worker performs physical I/O outside snapshot locks. Probe/home RPCs
have a ten-minute deadline; status requests retain normal short deadlines. Transport
commands fence socket/Klippy generations, and fresh query results replay newer
subscription deltas. Failed/missing acknowledgements never trigger command replay.

Progress estimates completed grid points from probe-response coordinates and the
configured readings per point, ignoring homing responses. Both legacy nozzle-coordinate and current Klipper probe-coordinate response formats are normalized. Completed acknowledgement
plus a fresh unique-profile mesh with matching bounds/dimensions is required for
review. Live probing immediately activates the measured mesh, unlike the simulator.
A unique internal profile prevents overwriting default. Temporary keep removes its
pending profile entry while leaving compensation active; later Klipper restart or
an existing print macro can replace it. Restore verifies the captured previous saved
profile contents (or clears compensation if no prior mesh existed). Normal queued
cancellation cannot interrupt probing and is disabled during physical execution.

Save confirms a new identifier, refuses overwrites/default/internal names, checks
fresh profile conflicts, then saves the named profile, removes the internal profile,
and executes SAVE_CONFIG. This writes ALL pending Klipper configuration and restarts
Klipper. Completion requires a new ready generation, no pending save, and matching
saved profile samples; the save script is never replayed. Existing start macros are
not edited and may still load a different profile. Profile deletion/activation outside
this workflow and a warm-bed probing option remain future work.

Lost connection, unexpected errors, journal failure or backend restart preserve an
uncertain reservation and restoration metadata. This does not claim physical movement
stopped. A fresh idle printer and explicit operator/owner confirmation are needed to
restore/clear the workflow. Journal recovery retries only checkpoint/status writes.
Expired reviews retain the reservation for explicit restoration rather than issuing
physical commands automatically. Tests cover actor ownership, concurrent observers,
late acknowledgements/query responses, generation changes, profile races, SQL faults,
restart/no replay, and headless live/simulator preparation semantics.

An eighth headless production smoke uses a stateful Moonraker fixture to verify
live remote-command wiring, shared progress through navigation, immediate mesh
activation, named profile saving/restart, restoration, one shared socket, config
privacy, and mobile preparation. Authorized hardware testing verified cold probing,
a new saved profile after restart, and restoration of the original default mesh.
A real transport interruption preserved an uncertain reservation without replay.
The subsequent explicit recovery/fresh-run test passed with heater targets off.

## Filament handling and extrusion distance

`/calibration/extrusion` adds slow simulator feed/retract (5/10/25 mm) and a
50 mm at 1 mm/s measurement workflow. E-only readiness does not require homing;
it does require an idle, ready printer, settled nozzle temperature, healthy
storage, no competing workflow, and explicit loaded-filament/clearance checks.
The simulator supports 170–280°C; these are demo bounds, not detected hardware
limits. The baseline rotation distance is explicitly entered, never invented
from demo data or confused with a potentially overridden configured value.

Actor-bound UUID submissions use the existing bounded queue, execution-time
validation, expiry, and unknown-outcome rules. A process-owned worker advances
the feed independently of browser lifetimes. The action receipt acknowledges
starting the workflow; its separate stage/progress records ongoing simulated
movement. The lease remains held through manual measurement and proposal review.
Disconnect, revocation, cooldown, expiry, and restart interrupt unfinished work
without replay. Migration 006 stores simulator checkpoints and atomically
commits command transitions with action statuses. Storage recovery reconciles
committed state and releases unfinished leases without repeating a feed.

Measured travel is initial mark minus remaining distance. The proposal is
`old rotation_distance × measured / 50`, rounded to three decimal places. Invalid
or implausible measurements are rejected; differences over 2 mm prompt a repeat.
Inputs and measurement acknowledgments survive normal telemetry/reconnects;
physical acknowledgments reset between workflows. Manual calculator exports are
invalidated when drafts change. Finished simulator proposals survive restart.

The live page offers the same calculator for an externally performed 50 mm test,
including while disconnected. Live heating/extrusion and configuration writes
are not enabled by this milestone. Exports are explicitly unapplied snippets;
simulator exports carry an additional warning against applying example data to
a real printer. Finish/cancel offers an explicit nozzle cooldown choice. Applying
rotation distance belongs to configuration review, and flow ratio, pressure
advance, temperature/retraction towers remain later print-based tuning work.

## Configuration workspace

`/configuration` and `/api/configuration` are owner-only surfaces. Operators/viewers
receive no filenames, content, backups, or exports. Configuration never enters the
shared dashboard or action history. A process-scoped ConfigurationService owns
bounded saves and SQLite access; finite HTTP reads use request aborts and deadlines.

Raw text is canonical. Narrow known numeric field edits splice original spans;
ambiguous/multiline/unknown settings remain raw-only. Comments, includes, macros,
BOM, delimiters, and untouched line endings survive. The first SAVE_CONFIG marker
and complete generated tail are protected by source comparison. Unexpected text
below the header is diagnosed without silently rewriting it. Hints are advisory,
not a Klipper parser or complete include/runtime validator.

Migration 007 stores simulator files, previous-version backups, and owner-bound
idempotent save receipts. UUID revision comparison, backup insertion, file update,
and receipt commit atomically; ten active/pending saves are allowed. Restoring a
backup stages a draft for a new reviewed revision. Retention is 20 backups per
file and 100 receipts; old replay attempts still fail revision comparison rather
than overwriting newer work. Simulator saves do not change running printer state.

Live mode uses only GETs to the fixed Moonraker config root. Validated relative
paths, encoded segments, file/response limits, redirect refusal, private API-key
headers, and ten-second deadlines bound the reader. Authorization is checked
before and after reads; raw bytes are not persisted server-side in live mode.
The live workspace supports drafts, review and export, with no write/restart.

Per-file browser drafts survive incoming revisions, file switches, failed loads,
and refresh errors. Leaving/reloading prompts; drafts are intentionally not put
in browser storage. Conflicts preserve drafts and show current saved source;
there is no automatic merge/force overwrite. The review preview is bounded and
labels truncation. Full source remains editable/exportable. A production smoke
covers owner gates, source preservation, navigation failure, two-client conflict,
backup restoration, offline drafts, CSRF, 320px layout, and live draft/export
without RPC/file writes or dashboard leaks.

Coordinated live writing, include-aware validation, new files/renames, and guided
application of calibration proposals are follow-up milestones. See
[the configuration guide](configuration.md).

### Prerendered Klipper reference

`/reference/klipper.json` is a public static catalogue containing upstream docs
only. Its SvelteKit `prerender = true` endpoint fetches a fixed commit at build
time with an eight-second timeout, redirect refusal, 512KiB stream bound, and
SHA-256 verification. A byte-identical checked-in snapshot supplies offline builds;
the bundled hash and minimum extraction coverage are checked. Build-time hook
initialization skips printer workers. Production serves the prerendered artifact
without fetching upstream. The route uses revalidation rather than immutable
caching, and no private configuration is part of the catalogue.

The parser preserves option descriptions, examples, source lines and kinematics
variants; it does not infer a validation schema or defaults from commented values.
The editor loads metadata independently so failures preserve existing drafts.
A conservative local inventory checks all option keys and the protected generated
suffix before offering explicit single-line additions. Includes require manual
review acknowledgement; ambiguous sections and context mismatches block additions.
Existing source bytes are spliced, and normal diff/CAS/save/export rules still apply.
Full include resolution, firmware-specific schemas and new-section creation
remain follow-ups. Upstream GPL source, license, revision,
checksum and refresh instructions are bundled under `src/lib/server/reference/`.

### CodeMirror source editing

The raw source component imports CodeMirror only on browser mount. Loading is
read-only, import failure offers a plain-text fallback, and unmount destroys the
view even if loading finishes late. The view is keyed by file identity; parent
per-file drafts remain canonical. Controlled text echoes are ignored to preserve
selection and history. Genuine external source replacements create fresh editor
state/history, preventing stale undo ranges from corrupting replacement content.
Busy operations reconfigure both readOnly and editable facets.

A custom StreamLanguage highlights Klipper sections/options, G-code and template
expressions; official YAML/JSON language packages handle those extensions. The
Perilune light/dark syntax palette uses teal, lavender and warm accents. Search,
selection highlighting, line numbers, history, bracket matching and the Replit
VS Code keymap are enabled. No autoformat, runtime evaluation, config validation,
or completion defaults are introduced. Generated settings remain separately
inspectable and protected by existing source checks. Browser tests cover history
reset, keyboard escape, native languages, lifecycle and BOM/CRLF preservation;
production smoke reads actual exports instead of CodeMirror's virtualized DOM.

Klipper property hover help reuses the public pinned catalogue through a dynamic
CodeMirror compartment; catalogue arrival does not replace editor state/history.
Lookup uses the current draft, matches existing unambiguous section/context, and
ignores values, comments and indented macro bodies. Active keys receive a range
highlight. Prose is inserted as text, never rendered as HTML. Mouse tooltips are
bounded to the viewport; Ctrl/⌘ Shift Space opens a focused, labelled nonmodal
help panel with a keyboard-reachable docs link and Escape return to the editor.
Edits/selection changes dismiss help; YAML/JSON do not receive Klipper tooltips.

## Reviewed live configuration application and recovery

Issue #33 tracks browser Klipper/Jinja/LSP exploration. Current application safety
is separate from language tooling. `PERILUNE_LIVE_CONFIGURATION` defaults false;
when enabled, owner-only `/api/configuration/application` admits one reviewed
single-file operation without a waiting queue. The ordinary live configuration
save API still rejects writes. Coordinated physical printer testing is outstanding;
all automated write/restart tests use a loopback protocol fixture.

Migration 008 persists operation receipts, source snapshots and a hashed printer
connection binding. Snapshot insertion and retention commit transactionally before
dispatch. A process-scoped Effect worker owns execution, authorization/idle/revision
checks, bounded upload, byte verification, restart and observed startup verification.
Admission expires after 30 seconds; the most recent 20 operations are retained.
A shared printer reservation fences Perilune commands/calibration during application
and uncertain outcomes. External tools do not share this reservation, and upstream
file upload offers no atomic CAS; exclusive coordinated use remains required.

Lost acknowledgements and interrupted process state become unknown without replay.
Only positive Klipper lifecycle responses establish a restart transition, never
transport errors. Old ready responses cannot establish fresh startup success.
Final bytes are checked again. Private error prose is retained in the recovery
record, not the shared dashboard state. Reconciliation reads current bytes and
printer state, does not replay commands or claim a previously unobserved restart.
Conflict-checked restore can recover even while Klipper reports an error. Snapshots
remain downloadable if upstream is offline. Successful restores cannot be toggled
back to bad configuration by repeated revert clicks. UI drafts remain untouched
by polling, failures, application and recovery. Server-side parsing/include resolution,
coordinated printer testing and calibration-proposal application remain follow-ups.

## Installability and device notifications

A public, revalidated manifest, opaque 192/512 icons, 180px Apple touch icon,
maskable safe-zone asset and alpha-only monochrome mark preserve the textured
crescent and floating dot. Assets are reproducible with
`node scripts/generate-app-icons.mjs`. OS tinting remains platform-controlled;
native Android adaptive-icon XML and Apple Icon Composer are not PWA APIs.
The print-progress tab favicon remains separate.

Kit builds/registers a minimal service worker. No fetch interception or app/API/media
caching is installed. Updated workers wait for an explicit reload action; other
open tabs are not forced to reload. The global client captures deferred install
prompts before account navigation. Account settings provide browser menu/iOS
Home Screen guidance, opt-in permissions, per-device event preferences, quiet
hours with an IANA timezone, disable and rate-limited test actions.

Migration 009 stores installation VAPID keys, account/epoch-bound subscriptions,
seven-day delivery claims and five-minute private snapshot bytes. Keys live only
in the protected SQLite database; back it up. A process-scoped Effect service
subscribes independently of browsers. Fast transition detection feeds a dropping
16-event queue; delivery uses concurrency four and skips events older than 60
seconds. Snapshots are captured once per event only when opted in. Quiet hours
are checked at event and dispatch time; skipped events are never replayed.

Observed completed/failed jobs and ready-to-error/shutdown Klipper transitions
produce generic text with no filename, upstream errors or private addresses.
Cold-start historical state is not announced. Live telemetry lacks a stable run
identifier: reconnects reset the baseline, deliberately skipping ambiguous
transitions. Delivery is best effort, with persisted claims before dispatch and
no automatic retry after unknown outcome. Browser notification tags suppress
same-event duplicates. This is not a durable alarm or print-history replacement.

Subscriptions require authenticated same-origin requests, strict supported-provider
HTTPS destinations, bounded keys/input and a 200-device installation limit.
Delivery rechecks current account epoch; 404/410 subscriptions are deleted.
Snapshots require the matching signed-in account/epoch and expire after five
minutes (periodic byte deletion). The push provider receives an opaque image
path, never camera bytes. The worker fetches it with same-origin credentials;
expired/signed-out/unsupported cases fall back to text. OS support for notification
images varies. Stale subscriptions expire after 180 days without a settings update.

Tests cover transitions, cold starts, run changes/reconnect ambiguity, quiet hours,
revocation, ownership, image epoch/expiry, provider restrictions, delivery claims,
rate limits and expired endpoints. Production smoke checks public install assets,
active service-worker registration and push handling, absence of cached responses,
and mobile/desktop settings. Legacy polyfill plugins apply only to the client
environment so their fixed worker output cannot overwrite the actual worker.
Actual Home Screen tinting and background push on physical iOS/Android devices
remain manual acceptance checks; automated tests never contact push providers.

## Calibration results into configuration drafts

The extrusion workshop now offers an owner-only handoff to Configuration. A bounded
single in-memory Svelte client record carries source mode, account ID, timestamp
and measurements, never raw configuration. It is not serialized into URLs, SSR,
localStorage or sessionStorage, and clears on account/role change or full reload.
Results expire after 30 minutes and simulator/live sources cannot cross.

`calibrationDraftChange` recomputes the proposal from the original measurements,
requires one unambiguous numeric `[extruder] rotation_distance` matching the measured
baseline, rejects generated overrides and unexpected protected blocks, and splices
only the value. Explicit repeat/source-review acknowledgments precede staging.
The editor checks the full expected draft text synchronously before accepting the
splice; other edits, gear_ratio, comments, BOM/CRLF and generated bytes survive.
Acknowledgments reset on file changes and the staged indicator follows actual draft
content. Normal conflict checks, diff review, export/save and opt-in application
recovery remain authoritative. No backend lifecycle or physical command changed.

Domain/browser tests cover provenance, expiry, source mismatch, ambiguous/multiline
options, baseline changes, byte preservation, acknowledgments, reverts and integrated
draft save. Production smoke carries a manual live result through SPA navigation,
exports reviewed source without writes, checks desktop/320px layout and clears the
handoff on reload. The simulator extrusion smoke stages and saves through the normal
review. Z-offset/mesh continue using their dedicated generated-settings workflows;
include resolution and physical application acceptance remain pending.

## Macros and operator console

`ConsoleService` is a process-scoped Effect service, not a request/browser worker.
Migration 010 persists simulator receipts and per-account macro shortcuts. Admission
is serialized, idempotent by UUID plus actor/script, bounded to 20 pending commands,
and expires after 30 seconds. Execution rechecks authorization, connection generation,
workflow ownership and readiness. Restart marks in-flight records unknown; connection
loss never retries. Storage uncertainty quarantines pending work before recovery.
Console examples are diagnostic-only and never mutate motion/heaters; all live
execution is rejected independently of other live feature flags. A shared physical
reservation/command policy remains required before broad live execution (#10).

The existing Moonraker socket provides bounded macro-name/help discovery and G-code
responses. Help runs after telemetry readiness, is optional, and cannot disconnect
healthy telemetry on timeout. Only loaded macro names and plain descriptions are
retained, not config bodies/parameter guesses. Responses are limited to 200 × 2,048
characters; macros to 200 × 500-character descriptions. This operator-only data stays
in MoonrakerSnapshot, never forwarded by the explicit PrinterSnapshot bridge.
`console.remote.ts` gates every read/write to operators/owners, binds stream lifetime
to request/process/auth lease signals, and closes its iterator on abort. Pins and
receipt lookups are account-bound; shared log reads are intentionally operator-wide.

The UI preserves input through state changes/reconnect, reviews exact commands,
displays explicit receipt lifecycle and reconciles an uncertain submission without
resending. Macro review preserves another typed draft. Shortcuts sync per account;
filters and follow-latest apply locally. Receipts retain up to seven days/2,000 rows,
with only the latest 100 visible; private live responses remain in process memory.
Domain/service/browser tests cover bounds, expiry, idempotence, restart no-replay,
revocation/throwing auth checks, source text safety and draft preservation. A headless
production smoke checks shared receipts, pin sync, reconnect inputs, viewer/CSRF
rejection, private live responses, one socket, no write RPC and desktop/320px layout.
See [the console guide](console.md). Physical execution remains coordinated/pending.

### Progressive basic actions and initial status

Authenticated SSR now reads a finite, process-local printer/camera snapshot after
session-version validation. Overview, Controls, Jobs and calibration pages use
that snapshot immediately; client live subscriptions enhance it. Printer-only
pages and the progress favicon subscribe to printer state, not camera updates.
The first browser connection is distinguished from a dropped connection. A
10-second initial connection deadline marks live updates unavailable, without
claiming that the backend lost its printer connection. Once a stream has been
established, its loss disables affected controls while retaining inputs/state.
Temperature history and its chart code no longer block Overview controls.

Basic heater, cooldown, home, pause and resume submissions use enhanced HTML
forms, with visible pending/results and no navigation on enhanced success.
Start/stop review links have server-rendered review forms before JavaScript;
existing hydrated dialogs and interactive motion/calibration commands remain.
Native success redirects to an account-bound receipt with an explicit refresh
link. Receipt refresh is read-only. Both form and command adapters call one
server dispatcher and the existing process-owned queues; ordinary simulator
commands now persist/check the actor for idempotency and execution authorization.
Small form bodies are bounded at 8 KiB with abort/timeout cleanup, independently
of file-transfer permits. Failed/unknown submissions never auto-retry.

This is the progressive-interaction foundation for shared live-action
coordination. It does not enable live motion/heaters/jobs or arbitrary scripts.
A shared physical-operation reservation across all live workflows and coordinated
printer acceptance remain pending under #10; existing live mesh/config flags and
their approval/testing requirements remain unchanged.

Motor disengagement uses a Bits UI modal rather than an expanding inline block.
The dialog explains lost position and the Z/gantry consequence, focuses the safe
cancel action, traps/restores focus, and retains server rejection text. Pending
submission disables duplicate actions and dismissal; acknowledgement closes the
dialog while execution status remains in shared activity. Backend dispatch and
live-execution gates are unchanged.

## Shared live-action coordination

`PERILUNE_LIVE_CONTROLS` enables the basic live motion, primary heater and existing
live-library job controls through `LiveActionService`. The process-owned worker
has one durable pending slot, account/payload idempotence, 30-second admission
expiry, generation fencing, fresh execution checks and observed-state completion.
`printerAdmission` ties a shared admission semaphore to the process-owned printer
instance; mesh, configuration and basic actions use it through durable reservation.

Migration 011 retains ordinary live reservations across restart. Unknown outcomes
keep an explicit owner recovery lock, including after storage/worker defects; no
physical command is automatically replayed. Cancellation verifies the stopped run
before applying independent heater choices. Manual movement preserves G-code state
and uses relative physical deltas with `M400`; configured heater limits are checked.
Basic forms also support live job review/start without JavaScript. See
[live controls](live-controls.md) for scope, acceptance and external-client limits.
Arbitrary console/macros and the live Z-offset/extrusion workflows remain follow-ups.

Camera playback tracks primitive source URLs, configured state and source generation,
so equivalent camera descriptors delivered with frequent printer updates do not
restart the stream. A headless browser regression covers descriptor churn,
orientation-only updates and real source-generation replacement.

## Recovery stop, cooldown and emergency shutdown

`SafetyService` owns separate process-scoped ordinary-safety and emergency lanes.
An owner can deliberately stop the freshly identified current job or turn off all
heaters during basic live-action recovery. Each operation has its own durable
account/payload-bound receipt, expiry and execution checks; it never replaces or
clears the original unknown action/reservation. Stop runs the configured cancel
macro and never restores heater targets. Cooldown alone does not stop a job.
Acknowledgement and observed result are recorded separately; partial results or
lost replies remain unknown and are never replayed, including after restart.

Operator/owner emergency shutdown uses Moonraker's dedicated HTTP endpoint and an
independent admission/worker lane, so it does not wait for ordinary admission,
WebSocket readiness, pending RPC acknowledgements, or workflow locks. Admission
immediately advances a per-printer epoch and latches normal writes. Last-moment
permits fence later basic-command stages, mesh stages, configuration uploads and
restarts; a late cancel acknowledgement cannot restore heat. The latch and safety
receipt are persisted before dispatch. Storage failure dispatches nothing and
keeps the memory interlock; use the physical stop if the server cannot dispatch.
This is a network control, not a substitute for a physical emergency switch.

Safety review needs an authorized owner, fresh ready/idle telemetry and all known
heater targets off. Resolve hazards and restart Klipper externally after emergency
shutdown before reviewing. Epoch/token checks prevent a concurrent newer emergency
from being cleared by an older review. Reviewing safety leaves the original basic
recovery lock intact for its own explicit review. Other Moonraker clients remain
outside Perilune's admission/interlock and may change printer state.

The shared UI exposes explicit confirmation dialogs and SSR safety forms/receipts;
forms enhance without unnecessary navigation and receipt refresh is read-only.
Emergency remains reachable inside the pending motor dialog. Headless production
coverage exercises recovery stop, native cooldown, retained original reservation,
emergency shutdown and enhanced review. Domain/protocol tests cover duplicate and
cross-account IDs, partial/dropped replies, revocation, expiry, generation changes,
restart/no replay, storage failure, emergency during review and delayed-ack fences.
Independent lifecycle review approved after fixing enhanced review redirects.

Owner-authorized physical acceptance used a temporary bounded dwell-only job and
an explicitly seeded recovery reservation, avoiding physical lost-ack injection.
Recovery cooldown and stop were acknowledged and observed; the original reservation
remained, targets ended at zero and the temporary file was removed. Physical
emergency shutdown remains pending until gantry support is coordinated; shutdown
can release the Z motors. Fault and shutdown cases currently use synthetic fixtures.

## Live filament handling and measured extrusion

With the separate default-disabled `PERILUNE_LIVE_FILAMENT=true` opt-in, the basic
live action worker also owns bounded primary-extruder feed/retract and
50 mm measured extrusion. Fresh execution checks require an idle printer, known
commanded E position, the primary active extruder, settled 170–280°C application
range, Klipper's `can_extrude` permission and configured single-move limit.
The generated script saves/restores G-code state, uses relative E, neutralizes
speed/flow overrides for the measurement, runs at 1 mm/s and waits with `M400`.
Completion requires acknowledgement plus the expected commanded E delta; it does
not claim an encoder measured real filament. The operator measures the mark.

Measured sessions and proposals are durable per target, owned by their operator,
and block incompatible workflows while awaiting measurement/review. Restart,
revocation, expiry or connection loss interrupts a session without replay.
Uncertain physical actions retain the existing recovery reservation. Checkpoint
failures degrade storage and retry only persistence without killing the worker.
In-flight movement cannot be cancelled through the ordinary queue; emergency
shutdown remains independently available. Proposals remain unapplied until the
owner reviews configuration. Simulator and read-only manual calculator remain.

## Live Z helper calibration

`PERILUNE_LIVE_Z_CALIBRATION=true` separately opts into Klipper's actual
`PROBE_CALIBRATE` or `Z_ENDSTOP_CALIBRATE` helper. Beginning requires cold heater
targets, homed axes, a bounded nozzle/probe position and no other pending calibration.
Fine adjustments use versioned, observed-height-bound `TESTZ` commands; `M400` and
fresh manual-probe state reconcile completion. Paper-drag confirmation belongs to
the current height and resets after an adjustment. Klipper `ACCEPT` stages a result;
it does not claim the setting has been saved or applied. Explicit save/restart is
handled separately. Pending results resolved elsewhere no longer block fresh tests.

The basic live worker persists operator-owned sessions before physical dispatch,
retains unknown reservations, fences all commands against emergency epochs, and
interrupts sessions on restart/expiry/revocation/helper disappearance without
replaying or silently aborting physical work. An explicit owned `ABORT` remains
available if heater/busy preparation changes. Recovery-time abort has a separate
SafetyService receipt and retains the original unknown action. Browser submission
ambiguity retains the ID and blocks fresh sends until its receipt is observed.
Paper judgement and physical acceptance need an attended printer; protocol and
headless coverage do not substitute for that measurement.

### Live calibration configuration acceptance

Live filament and Z calibration are separately opt-in. Z ACCEPT stages a Klipper pending setting; it does not persist or restart. The owner configuration screen reviews the complete pending manifest, snapshots the actual main file, checks source dependencies and pending values again, then sends SAVE_CONFIG once. Exact predicted bytes and a fresh startup are required for success; acknowledgement loss stays unknown without replay. Verified calibration writes share the same export/revert path as reviewed source edits. Section removals and unsupported source constructs require manual review.

Extrusion proposals resolve the effective source through ordered, sorted includes with bounded traversal, show its file/line and retain a dependency fingerprint for dispatch. Protected generated settings and ambiguous/multiline origins cannot be applied automatically. The resolver is conservative, not a replacement for Klipper semantic validation. External Moonraker clients cannot participate in Perilune's reservation; exact version checks catch observed changes but are not a cross-client atomic lock.

Main discovery validates Klipper's reported path against Moonraker's config root. If Klipper reports a relative path, the administrator must explicitly set PERILUNE_KLIPPER_WORKING_DIRECTORY to **Klipper's process working directory**, not Perilune's. It remains server-only, must be updated after deployment changes and defaults to refusing relative paths.

Physical acceptance: a harmless comment above the generated block was applied to the real printer and reverted through the recovery UI. Both fresh startups were verified and the restored file matched the original bytes exactly. Filament heated PLA to 200°C and commanded one 50 mm feed; a development reload exercised unknown-outcome/no-replay recovery. Owner observed approximately 47.7 mm travel from an approximate mark; no rotation-distance change was applied. Attended Z paper judgement, ACCEPT, complete pending-settings review, SAVE_CONFIG, exact saved-byte verification and fresh startup subsequently passed on the physical printer. The active probe offset matched the reviewed value, pending settings cleared, and both heater targets remained zero. A precise repeated extrusion measurement and additional physical failure injection remain pending.

### Calibration interaction polish

The live paper test defaults to fine tuning. An explicit coarse-approach mode offers 0.5/1 mm steps, displays the exact distance per click and explains when to return to fine tuning. Both modes use the same versioned, fresh-position checked backend command and configured Z travel limits; no timed repeated movement is introduced. A new run returns to fine tuning.

The UI calls the observed position a nozzle Z coordinate rather than a measured bed gap. Completed results retain the paper coordinate, previous setting, proposed setting and signed change through save/restart/navigation. Save records correlate a staged session only when its setting and candidate match the reviewed pending manifest; matching reverts preserve that association. Owner-only recovery polling distinguishes verified startup, pending application, failure/unknown and revert. Clearing pending settings alone never establishes a successful save. The result links to the existing snapshot recovery controls without adding an immediate restart/revert action. Older records without this metadata show missing/unverified details honestly.

### Live library changes

The live-controls opt-in also permits bounded idle-printer G-code upload and deletion. Uploads use content-addressed filenames, never request print/start, and verify full returned bytes. Migration 015 persists mutation tombstones before dispatch; uncertain operations are not replayed across requests or restarts. Matching existing upload bytes can be reconciled read-only. File mutations acquire shared admission before the catalog lock, preventing local starts while checking and changing files; independent emergency shutdown remains available. Request abort closes transfers, and the journal retains uncertainty. Other Moonraker clients do not share this lock; conditional external-writer safety is unavailable from Moonraker's file API.

Physical library acceptance passed against the owner's unloaded, idle printer: browser upload, identical retry without a second write, temporary slicer-key multipart upload, key revocation, start and observed completion of a ten-second dwell-only file, persisted completed history, and removal of both temporary files. Uploads reported print_started=false and print_queued=false. No heating, movement or extrusion was requested. This does not replace an actual deposited-print or desktop Orca application acceptance.

### Reviewed live console

A separate live-console opt-in delegates scripts to LiveActionService; ConsoleService retains account-bound receipts and follows the durable physical action. Shared admission, expiry, authorization, generation/safety fencing and unknown recovery remain authoritative; no second physical worker/queue is introduced. Direct lifecycle commands use dedicated workflows. An appended M400 and fresh idle state establish acknowledged completion, not arbitrary macro effect validation. Physical emergency shutdown and motor disengagement have now passed telemetry-based owner-authorized acceptance, followed by external restart, explicit safety review and zero heater targets.

### Daily-use deployment and recovery acceptance

Production deployment now has a Linux loopback-only host-network Compose example and an online SQLite backup helper included in the image. Backups preserve committed WAL data, verify integrity, and prefer an explicitly configured signing secret over a stale adjacent file. See deployment.md for HTTPS, backup and isolated restore requirements.

A pnpm patch for Kit 3.0.1 handles rejected background live-query reconnect promises in server-update/HMR paths. The reconnect state machine and explicit reconnect callers are unchanged. The headless live-action acceptance navigates immediately after enhanced safety review and into console execution, exposing the previously unhandled interruption.

Physical failed-startup acceptance surfaced stale pre-restart motion telemetry blocking snapshot revert. Revert admission now ignores cached hardware busy/calibration/job flags only after a fresh Klipper error/shutdown response, while retaining safety, application workflow and unknown-action locks. Exact-version verification and fresh dispatch checks remain. A regression models stale printing/busy/probing telemetry.

Physical recovery acceptance subsequently passed without restarting Perilune: deliberately invalid Klipper section, complete startup diagnostic, confirmed snapshot revert, exact original bytes, and fresh ready startup. A separate external-writer check preserved a deliberately changed file by refusing revert dispatch; after explicit conflict resolution, retry restored the original bytes and verified startup. No test sections/comments remain. The printer ended unloaded, unhomed, ready and with both heater targets zero.

Native slicer starts require an explicit upload-and-print key. Migration016 preserves all existing keys as upload-only. The process-scoped SlicerService resolves the exact catalog path and submits through LiveActionService (or the simulator worker); HTTP only waits for its durable receipt. Runtime key checks use the auth database synchronously at dispatch to catch revocation, expiry and account recovery. No separate physical execution path or retry worker exists.

Both legacy separate upload/start and newer multipart print=true are supported. Upload responses expose bare fields plus result.item.path for older Orca clients, preserving Perilune's fingerprinted stored filename. Success requires a completed start receipt. Native requests lack IDs: a persistent per-key/file mapping coalesces starts for two minutes across reconnect/restart, and pending/unknown receipts remain held regardless of age. Confirmed pre-admission rejection releases its mapping. Native requests are bounded to eight concurrent waiters; receipt waiting ends after 20 seconds without cancelling physical execution. Deliberate immediate repeats use Jobs. Storage-root discovery reports write permission when live uploads are enabled.
