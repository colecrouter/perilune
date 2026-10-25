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
allowlisted media sessions, and in-flight request controllers. CameraSetupService
owns the single persisted source through owner test/preview/save. Moonraker webcam
entries are explicit import candidates; discovery changes never replace a saved
selection. Disconnect clears the selection and invalidates media sessions. The
private companion base is configured with `PERILUNE_CAMERA_COMPANION_URL`; the old
environment-selected relay path and automatic fallback have been removed.

The gateway proxies continuous H.264-only fMP4 to MediaSource browsers, and requests
go2rtc HLS/fMP4 for native-HLS fallback. It rewrites playlist and init/segment references
to fixed Perilune endpoints with opaque session tokens. Upstream origins, headers,
redirects, errors, and source identifiers remain private. Routes accept only known
resources and parameter shapes. Requests are bounded by deadlines, response sizes,
session count, and concurrency; caller abort, Effect interruption, source changes,
and runtime disposal cancel upstream work. All media responses are `no-store`.

Compatible H.264 passes through the companion's remuxer; audio is excluded.
The companion starts bounded on-demand conversion when required by the saved profile. Continuous HTTP response bodies retain upstream controllers until
cancelled or ended, respect backpressure, cap individual chunks, and use startup
and renewable read-inactivity deadlines. MediaSource playback appends bytes
sequentially and prunes old buffers, keeping playback near the live edge. Native
HLS is a fallback where MediaSource is unavailable.
The player rebuilds on descriptor generation changes, retries failures with backoff,
and releases resources when hidden or explicitly paused. Rotation/flips affect video
display, with swapped portrait dimensions for quarter turns and untransformed UI
controls. Source JPEG downloads use a separate bounded endpoint and can fail without
interrupting video. No captures are persisted.

Native HLS buffering latency remains a tradeoff. WebRTC, multiple cameras and notification capture retention remain future work.
The optional managed companion described below adds direct protocol ingestion
and compatible H.264 conversion. The synthetic production fixture verifies H.264 decode, two
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

## Current milestones

Persistent Moonraker integration, authenticated camera routing, local accounts,
Jobs and slicer pairing, reviewed command/configuration workflows, opt-in live
calibration, installability and notification delivery are implemented. Live
capabilities remain explicitly enabled by deployment; physical operations and
acceptance are coordinated with the owner. Internet exposure requires HTTPS and
a configured origin.

Beta UX readiness refines the implemented workflows: explicit mobile navigation,
reachable motion and console controls, local action outcomes, searchable settings
and prominent draft review, consistent calibration results, direct account
sections and contextual entry/notification guidance. See
[beta-ux-readiness.md](beta-ux-readiness.md) for the accepted scope and verification
criteria. The backend command and authentication contracts remain unchanged.

Camera compatibility and quality now includes an optional packaged companion,
owner test/preview/save, private persisted settings, restart reconciliation,
HTTP/RTSP adapters, JPEG-only images and device-local quality selection. See
[camera setup](camera-setup.md) and the evidence/acceptance matrix in
[camera-compatibility.md](camera-compatibility.md).

Outstanding work includes coordinated camera hardware/platform acceptance,
configurable overview layouts, race-safe rolling
sessions, and optional email recovery. These are tracked separately from the beta
UX milestone; current issue status is authoritative for individual follow-ups.

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
credentials, revocable fixed 90-day sessions, and cookie caching disabled. Its schema
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

Operators can issue upload-only or explicitly print-enabled slicer keys from Account → Integrations. Keys are hashed at rest,
have no expiration by default (optional 90-day or one-year expiry in the UI), are individually revocable, and are bound to an active
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

`/configuration` and its remote queries/commands are owner-only surfaces. Operators/viewers
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

`getKlipperReference` is a public static catalogue containing upstream docs
only. Its SvelteKit remote `prerender` function fetches a fixed commit at build
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
when enabled, owner-only configuration application commands admit one reviewed
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
Cold-start historical state is not announced. Reconnects reset the transition
baseline, deliberately skipping ambiguous transitions. Optional Moonraker history
identities retain verified ownership across a restart, but do not replay offline
events. Delivery is best effort, with persisted claims before dispatch and
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

Emergency recovery records the owner’s hazard confirmation atomically with an
explicit firmware restart submission, followed by fresh ready/idle/all-heaters-off
verification. There is no separate save-review step. If firmware was restarted
elsewhere, the verification form records the confirmation without sending a restart. Ordinary controls remain locked until verification succeeds. Epoch/token checks prevent a concurrent newer emergency
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

### Staged resume and paused recovery

A printer's RESUME macro may purge filament and intentionally remain paused until a second explicit Resume. Acknowledged dispatch followed by fresh ready, motion-idle, non-calibrating telemetry for the same non-null run ID and filename completes the command with an explicit still-paused message. This does not claim the print resumed and never sends a second Resume. Resume rejects missing run identity before dispatch, verifies identity for normal printing success too, and allows up to two minutes of post-ack motion observation for a long purge. Busy motion, changed identity and lost acknowledgements still retain unknown-outcome recovery.

An owner can explicitly attest that an unknown Resume relates to the same paused print and clear its lock without stopping that print. This exception requires the original durable resume filename, fresh ready/idle paused telemetry, the owner-reviewed current filename/run ID and active owner authorization. Other unknown commands cannot use it. Old run IDs are process-local and cannot prove continuity after reconnect/restart; the UI makes that limitation an explicit owner inspection decision instead of silently treating a filename match as proof. The old receipt remains unknown and no command is replayed. Closing the dialog or changing job/recovery identity resets the attestation.

Completed or reviewed safety receipts remain available in collapsed Recent safety actions history. Queued/sending actions, unreviewed unknown outcomes and the emergency interlock remain prominent. Paused recovery attestation is disabled until fresh connected/ready/idle telemetry is available, and resets when dialog or reviewed print identity changes.

### Everyday overview and attention states

The overview now puts the current job before the camera, with state-specific
copy and controls. Paused jobs link to printer messages and explain that macros
may require a purge and a second explicit Resume; Perilune does not infer a
specific pause cause from `paused` alone. Finished jobs become a last-job summary
without an active progress bar. Printing again opens the filtered library for
review rather than replaying a command or starting a file automatically.

Print controls explain role, connection, Klipper, storage, safety, pending-action,
and calibration/configuration restrictions. Their forms retain the existing
server-rendered fallback and job identity fencing; execution checks remain in
the process-owned worker. The overview's temperature history defaults to all
reported sensors on one shared time axis, with individual sensor focus and
keyboard/touch inspection retained. Missing samples remain gaps.

Global emergency controls use a compact utility strip. Pending and unresolved
safety outcomes and the emergency interlock remain prominent. Routine terminal
receipts are available on `/safety/history`, server-rendered for operators with
live updates and links to their full receipts. This is presentation work; no
physical command, permission, retry, or acknowledgement policy was relaxed.

Planned filament changes are now inspected from file contents and surfaced in
file/start reviews. Remaining overview work includes customizable layouts if the
default proves insufficient and owner acceptance during an actual print.

The everyday-overview follow-up shares the job card with the Jobs workspace,
including its control-readiness reasons and finished-job summary. Enhanced job,
overview heater/cooldown, and safety-dialog forms follow live receipts rather
than leaving a submission permanently labelled queued. Queue/execution prevents
implicit duplicate submission as well as disabling buttons. Routine completed
feedback is quiet; failures and uncertain outcomes remain actionable, and durable
receipts remain available on the explicit Activity page. Receipt
state survives eviction from bounded recent-action lists. Repeated telemetry
snapshots do not extend the success timer. Connection diagnostics are collapsed
by default, without hiding the reconnect banners or changing initial SSR
connection behavior. Simulator activity no longer invents unrecorded events.

### Emergency recovery without an external Klipper client

Migration 017 adds a durable hazard review and one-shot firmware-restart receipt
reference to each printer's emergency latch. Owners confirm physical inspection
in the restart form; the confirmation and restart reservation persist atomically.
A new emergency immediately invalidates the previous review, even while its new
latch is still being persisted.

The explicitly submitted owner-only restart uses Moonraker's
`POST /printer/firmware_restart` endpoint. The process-owned safety worker fences
it against the current emergency token, authorization, transport generation and
30-second dispatch expiry. It confirms shutdown/error immediately before
sending, persists admission before dispatch, and sends once. Restart observation
is bounded to 60 seconds plus individual transport request bounds. Navigation
and request abort do not own this worker. Restarted workers turn pending
receipts unknown, preserve review/restart state, and never replay them.

Ordinary controls remain locked until a fresh query observes a ready, idle
printer and zero targets for every reported heater. An acknowledged restart also
requires a later transport generation before automatic verification. Owners can
explicitly run read-only readiness verification after a lost acknowledgement or
an external restart. Verification reviews only that cycle's uncertain restart;
hazard review covers only its emergency receipt. Unrelated uncertain safety and
ordinary-action reservations are preserved. Individual safety-outcome review
also now targets one selected unknown receipt rather than clearing all unknown
outcomes together.

The recovery panel and restart confirmation support enhanced and native forms,
retain progress across reconnect/navigation, and explain offline/pending states.
Protocol/headless tests cover the complete flow; physical emergency/restart
acceptance remains a coordinated owner check on the daily-use checklist (#52).
Moonraker endpoint reference: https://moonraker.readthedocs.io/en/latest/external_api/printer/

## Browser pairing and integration management

Account → Integrations provides Moonraker-compatible slicer setup, named account-owned
upload or upload-and-print keys, creation/last-use dates, optional expiration, and
individual revocation. New secrets start masked with explicit Copy/Reveal controls;
only creation returns the full key. Existing keys retain their original expiration.
Upload credentials never authorize interactive browser access.

Login offers general browser pairing at `/pair/start`. The requesting browser holds
a random 256-bit redemption secret in memory; the database stores its hash and a
separate 40-bit human code. A signed-in browser enters that code at `/pair`, inspects
the requester-supplied name, and explicitly approves or denies account access.
Requests expire after five minutes, are bounded globally, and have separate bounded
polling/action rate budgets per address. Requests enforce the configured origin,
finite body size and read time. Approval captures the current recovery epoch;
redemption claims the grant before asynchronous session creation and never reopens
an ambiguous grant. Cancellation invalidates pending and in-flight grants and can
revoke an already-created session while the grant remains available.

Paired browsers use ordinary Better Auth sessions and persistent HttpOnly,
SameSite=Lax cookies (Secure on HTTPS), with a fixed 90-day lifetime. Identity reads never renew or clear browser authentication cookies, and sign-out invalidates its captured session without emitting a cookie deletion that could clear a newer login. Paired sessions are independently listed/revoked, terminate live
session leases on revocation, and respect account removal/recovery. During approval,
a browser can optionally be linked to an existing active slicer key. Revoking only
a key or browser leaves the other credential intact; Disconnect integration revokes
the key, linked browsers, and pending linked grants together.

Headless production auth smoke covers two-browser approval, shared-address polling,
a complete persistent Chromium context close/relaunch, fixed expiry through ordinary requests and delayed-response ordering for new logins/pairing, cancellation, origin enforcement, and revocation. Unit tests
cover expiry, denial, one-time redemption, recovery epochs, ownership, and cancellation
racing session creation. Owner acceptance of actual Orca/WebKit cookie retention across a complete macOS
application quit/relaunch is recorded in #93; no slicer-specific
API injection or passkey support is required by this flow.

## Comfortable daily use

Job inspection statically counts recognizable M600 filament changes and PAUSE/M0/M1/M25
pauses in bounded UTF-8 files up to 20 MiB, retaining at most twelve command locations.
The scanner only reads an executable line prefix, handles parenthesized comments
linearly, never expands macros, and distinguishes unknown inspection from a known
zero. Live inspection fetches through the private bounded/abortable Moonraker file
client, caches complete results by file identity, and retries unavailable results
after 30 seconds while retaining ordinary metadata. Removed identities prune both
metadata and attempt timestamps. Aborted readers close without unhandled cancellation
rejections. Both enhanced and no-JavaScript start reviews show the summary; execution-time
printer/file validation is unchanged. Counts are informational and do not certify safety.

The console submits a validated command or macro on one explicit action. Its process
worker, idempotent IDs, pending guard, and unknown-acknowledgement reconciliation remain
unchanged. Log following keys off actual output/receipt changes rather than ordinary
snapshot revisions, pauses when scrolling up or opening a repeated-response group,
and offers a sticky collapse action within expanded content.

Emergency shutdown has a direct enhanced/progressive form instead of a blocking dialog.
It still requires the validated explicit POST, current authorization, idempotent receipt,
and independent safety worker. Recovery stop/cooldown/probe-abort confirmations use
one submit action without a redundant checkbox. Hazard reviews and firmware restart
retain explicit inspection acknowledgement. Shared dialog sizing/actions fit short
and narrow viewports. Successful safety submissions close their dialog, matching other
primary-action dialogs; ongoing execution and outcomes stay visible in shared safety activity. No real printer action is part of automated verification.

Jobs defaults to ten compact rows, truncates long filenames in the list (full names
remain in detail/accessibility text), and initially shows five recent runs with an
explicit expansion. Desktop selection and same-surface pagination retain scroll;
mobile detail navigation intentionally resets. Existing GET forms already use Kit’s
client navigation, and stateful POSTs use action enhancement. Help now links setup,
manual interventions, pairing, phone installation, notifications, updates and backups.
It distinguishes server deployment from a browser reload. Device notification settings
show permission/registration status and describe test acceptance without claiming OS
delivery; notification-setting reads use a bounded finite body reader.

The implementation is reviewable independently of owner hardware acceptance. A completed
deposited print, actual iOS/Android installation/background delivery, and an off-host
backup destination remain owner checks in issues #52/#35 and docs/daily-use.md.

## Validation and CI execution

`pnpm validate` retains formatting, lint, type checks, unit/browser tests, backup
checks, a production build and every production smoke suite. The smoke inventory
is centralized in `scripts/smoke-suite.mjs`; validation rejects a new, missing or
duplicated suite until it is assigned to exactly one group. Local execution remains
serial. CI uses separate runners for the four groups, sharing one production-build
artifact, while checks and the real Docker build/smoke run independently. A final
`validate` gate requires every dependency to succeed, including the container.
Pull requests and main pushes run CI; feature pushes no longer duplicate PR runs.
No physical commands are retried to hide test failures.

## Clearer action feedback and configuration navigation

Routine enhanced-action feedback shows admission/execution while pending, hides
completed proof, and keeps failures and unknown outcomes actionable. The current
job retains the meaningful staged-Resume message when Klipper deliberately stays
paused. Recent failed execution surfaces a dismissible global notice even if its
original dialog closed on admission. Per-tab dismissals survive navigation and
reset when account identity changes; receipt status and printer locks are not changed.

`/activity` lists ordinary and safety actions and hosts full emergency/unknown-action
recovery. The global utility strip retains urgent controls and concise links to
required review rather than repeating historical receipts and recovery forms on
every page. `/safety/history` redirects to its safety section. Physical dispatch,
acknowledgement, hazard review and no-replay policies are unchanged.

The configuration browser groups folders and Klipper-named saved revisions, provides
path search with bounded scrolling, and exposes source shortcuts for macros in the
current draft. Recognized revisions require an existing base file and open read-only.
Mode defaults are file-specific; unsupported files start in raw source, and explicit
choices remain with that file. Raw bytes, per-file drafts, save reviews, conflicts,
include precedence and protected generated values retain their existing guarantees.

## Guided PID heater tuning

`/calibration/pid` adds owner-only, default-off live PID tuning for the primary
nozzle and bed. It reuses the process-owned live action worker, shared admission
and emergency interlock, durable reservations, expiry, idempotency, dispatch-time
validation and unknown-outcome recovery. Migration 019 persists a target-scoped
PID checkpoint; interrupted or restarted work is never replayed. Native command
capability checks reject overridden PID/cooldown commands. A long-running RPC is
followed by fresh pending-gain, idle-state and targets-off verification.

Staged gains offer inline Save and Discard dialogs rather than navigating to the
configuration editor. Each loads every pending setting for owner review and requires
explicit confirmation. Read-only review works without enabling configuration writes.
Saving remains gated by the configuration application opt-in; discard is gated by
live controls and never uploads a file or sends SAVE_CONFIG. Both use the process-owned
configuration worker, durable operation record, source/pending fingerprints, shared
admission and safety interlocks, expiry and unknown-outcome handling. Discard verifies
fresh startup, heaters off, pending settings cleared and unchanged saved bytes; it
never enables a file revert. Closing the dialog leaves staged values untouched.
Synthetic simulator gains are labelled examples and cannot
be applied to hardware. The separate `PERILUNE_LIVE_PID` opt-in stays false until
owner-coordinated heater acceptance. See [PID calibration](pid-calibration.md) for
implemented behavior and the outstanding physical acceptance checklist.

## Account-owned display defaults

Migration 020 stores bounded display preferences per account. An authenticated,
same-origin partial-update API merges fields atomically so independent tabs do
not replace unrelated choices. The root server layout seeds request-owned client
context; account changes abort and fence delayed preference responses. Optimistic
choices survive save failures with explicit retry. Optional preference reads do
not prevent printer state rendering when unavailable.

Typography moves to Account and applies across workspaces. Console display flags,
file columns/default page size and temperature-history window persist. Transient
input/selection/calibration state and automatic console follow pauses do not;
notification permissions/subscriptions retain their device lifetime. See
[personal preferences](preferences.md) for ownership and synchronization limits.

## Authentication response ordering

The owner selected fixed 90-day sign-in after a deterministic browser fixture
reproduced an old renewal response overwriting a new password-login or pairing
cookie. Better Auth renewal is disabled globally. Ordinary identity resolution
returns no cookie headers; auth session reads, error cleanup and sign-out filter
session-related cookie writes. Successful explicit password/passkey authentication
and approved pairing still issue a new persistent cookie. Sign-out invalidates
its captured session in the database; leaving an invalid cookie in the browser
cannot authenticate and avoids deleting a newer login through a delayed response.
Independent sessions remain valid until individually revoked, expired or removed
by account recovery. Existing sessions retain their currently stored expiry.

Rolling session support is a separate future enhancement (#101), requiring a
reviewed selection/proof protocol and no fallback to older identities. No browser
locks or application-only “latest session” checks are claimed to retract already
issued HTTP responses.

## Account-scoped print notices

Migration 021 records the initiating Perilune account alongside a verified start's
completed receipt in one transaction. Simulator, browser and native slicer starts
use the same account identity; lost acknowledgements and failed starts do not
claim ownership. Attribution retains the latest 5,000 starts independently of
receipt pruning. Filenames and Moonraker's proxy-user field never establish an
account owner.

When Moonraker advertises its history component, bounded optional read-only queries
provide a hashed backend/job-id/start-time identity. A verified start attaches it
only when history changed from a successfully read pre-dispatch cursor. Stale
rows cannot attach to a different run in the same connection. After reconnect or
process restart, the latest matching `status: in_progress` history row is trusted
as Moonraker's authoritative active-job identity. The API offers no atomic join
between object telemetry and history; a faulty or indefinitely stale upstream
record across that boundary cannot be independently disambiguated. Reconnects can
resolve an already verified durable claim; missing, conflicting or unavailable
history leaves restarted jobs unattributed. A history read failure does not fail
or replay a physical command. There is no inference from a matching filename and
no history catch-up notification.

The default device policy is notices for that account's prints. Separate opt-ins
include anyone's prints (including external/unattributed jobs) and shared printer
errors without an owned active print. Existing device records normalize both
opt-ins to false. Per-kind toggles and quiet hours still apply. Printer errors
during an active job follow its attribution; idle errors require the shared-error
opt-in. A deliberate test remains specific to the requesting device.

Audience and event are queued together. Only currently authorized eligible devices
can cause a camera capture; delivery rereads each device's current preferences,
account and epoch before claiming/sending. Images remain account/epoch-bound and
expire after five minutes. Account-only policy intentionally skips notices for
jobs started outside Perilune unless their owner can be established from an
already verified durable identity. Actual OS delivery and image presentation
remain owner/device acceptance work.

## Camera source setup refinement

Camera settings use an SSR-awaited owner remote query for finite local config and
source summaries, with explicit refresh after mutation. No configuration request
runs from a mount hook. Live printer subscriptions retain their existing lifecycle.
The current source is identified by its name and connection provider through the
same authenticated playback gateway.

An on-demand owner remote query discovers Linux/V4L2 capture profiles from the
private companion. Discovery has a single process-scoped slot, bounded response
size and deadline, request/session cancellation, and re-enumeration before testing.
Only opaque profile IDs reach the selection API; endpoints are validated against
fixed video-node, format, size and frame-rate rules. The optional USB Compose
override maps one explicitly selected device without privileged mode. The pinned
producer supports MJPEG, H.264, HEVC, YUYV and NV12; other offered formats are omitted.
Default offered profiles are selectable; custom capture dimensions/rates, physical
USB/unplug/replug and CSI driver provisioning remain acceptance/future work.

## Explaining printer control locks

Unavailable controls must identify the blocking condition and provide a useful
review destination. `printerLockNotices` derives fixed public explanations from
the existing shared snapshot; it never alters admission or clears a workflow.
Normal calibration/progress and waiting review states use status language.
Uncertain bed-mesh ownership, unclassified calibration and degraded storage need
attention. Completed/staged results that do not hold controls are not presented
as locks.

The shared safety region displays persistent workflow guidance on every page,
while existing emergency, uncertain-action and owner configuration recovery
notices retain priority. Temperature and console explanations identify the same
workflow and its review page. Role checks suppress owner/operator-only recovery
links for other accounts and explain whom to contact. Console guidance is only
attached when it matches the current admission reason; reconnect and higher
priority safety states retain their own explanations. No new polling or mount-time
configuration fetch was added, and incoming notices preserve local drafts.

Future controls should follow this convention (issue #117). A notice links to the
existing recovery flow; it is never a dismiss button for an active interlock.

## Guided filament changes: printer-macro workflow

Issue #84 remains in progress. `/filament`, linked from printer controls and the
current job, uses an SSR-awaited operator/owner query for private capability
discovery and an owner-only command to save per-printer setup. Loaded macro
objects establish presence independently of optional G-code help. Detection does
not certify compatibility, and raw macro bodies remain backend-only. Review is
bound to exact selected commands and a canonical complete-configuration digest.
SQLite revision comparison prevents stale edits; a live action reservation or
active filament session prevents setup replacement.

The macro path runs through the process-scoped LiveActionService worker and its
existing bounded admission, durable UUID receipts/reservation, account checks,
expiry, generation fencing, emergency interlock and unknown-outcome recovery.
Begin sends only the selected macro plus M400. Adoption of an already paused
print sends no macro and does not infer an M600 event from a pause. Verification
requires consistent print status and `pause_resume.is_paused`, a matching filename
and non-null run ID, and stationary motion for paused steps. Resume may verify
active printing motion, or acknowledge a staged macro that intentionally remains
paused; another Resume always requires a new attended confirmation.

Sessions persist owner, step, print identity, generation, reviewed setup and
expiry. Incoming state does not replace browser drafts. Another account cannot
resume a session; an owner can explicitly inspect and take over a stationary
paused print. Heater targets remain explicit; cooled targets or lost homing
prevent Resume. No automatic reheat, homing, parking, unloading or return move is
added. The original idle extrusion calibration is not used for paused prints.

Restart, reconnect, revoked authority or expired continuity retain reviewable
state without replay. Failed interruption checkpoints retry storage only, while
physical actions remain disabled. Settings, calibration, configuration, console,
normal Resume and new-print admission honor filament ownership. Stop and the
independent emergency path remain available. The shared safety region links to
guidance and CurrentJob replaces ordinary Resume with Continue filament change.

An owner may explicitly end ownership metadata even when the printer is offline.
Under the admission gate this requires exact session/step, no pending worker or
checkpoint, healthy storage and authorized confirmation; receipt and finished
state commit atomically. It does not verify position or stop/resume the printer,
and never clears independent safety, storage or unknown-action recovery locks.
Operators can end their own guidance through fresh, stationary-state validation.

Automated acceptance uses synthetic Moonraker services and a headless protocol
fixture, including staged Resume, navigation/reload, unknown acknowledgements,
revocation, checkpoint failures, restart, ownership, stale setup and mobile layout.
No physical printer acceptance has been performed for this workflow.

The assisted and notification increment is described below. Attended owner
acceptance remains outstanding for #84. Process-local run IDs change on
reconnect; recovery explicitly adopts fresh identity rather than matching by
filename. No managed M600 is silently installed or substituted.

## Guided filament changes: assisted steps and paused-print notices

The assisted method is owner-reviewed and opt-in. It uses the same durable guided
session, worker, admission and uncertain-outcome policies as the macro method.
Begin requests PAUSE, then verifies a stationary same-job pause before offering
any handling step. It never installs or substitutes M600. For planned slicer
changes without M600, configure PAUSE and explicitly adopt the paused print.
A pause alone does not identify a filament-change or runout event.

Initial support is single-extruder Cartesian/CoreXY. Configuration discovery
rejects multiple tools, extra carriages, unsupported motion transforms and
native movement/state command overrides. Review covers parking mode, coordinates,
Z lift, per-step unload/load/purge distances, extrusion speed and resume command.
Each extrusion is at most 50 mm and 90 seconds and must fit the printer's own
configured distance/velocity limits. Longer paths need separately attended steps.
No automatic reheat, repeated extrusion or automatic return move is provided.

Printer parking requires explicit inspection and sends no additional park move.
Generated parking requires native PAUSE and no active/unverified bed mesh, checks
parser and physical XYZ travel/headroom, lifts Z before XY and saves/restores
G-code state without MOVE. Unsupported transforms use printer macros instead.
Extrusion requires unchanged verified parking, homed axes, the expected active
extruder and fresh can_extrude with an enabled target. Native M220/M221 normalize
speed/flow inside the saved state. Fresh parser E displacement verifies commanded
extrusion; it cannot prove that filament physically fed through the extruder.
Native RESUME owns the saved pause return. Custom PAUSE/RESUME behavior requires
owner review, including any existing retraction, parking or staged resume.

Unknown movement is never retried. Recovery invalidates parking, warns that an
earlier relative lift may already have occurred, and requires new inspection.
Position drift invalidates guidance. A deliberately requested new park starts
from the current position. Server live-filament opt-in gates assisted park/feed.

Paused-print push notices default off, including existing device registrations.
An observed printing-to-paused transition with the same known run identity emits
one event per pause occurrence. Startup/reconnect establishes a baseline instead
of inferring a pause. Existing job attribution, all-prints opt-in, authorization,
quiet hours, expiring private snapshots and durable delivery claims apply. Text
reports a pause without guessing its cause.

Research references: Klipper [G-code state implementation](https://github.com/Klipper3d/klipper/blob/master/klippy/extras/gcode_move.py),
[extruder limits](https://github.com/Klipper3d/klipper/blob/master/klippy/kinematics/extruder.py),
[pause/resume implementation](https://github.com/Klipper3d/klipper/blob/master/klippy/extras/pause_resume.py),
and [state-saving guidance](https://www.klipper3d.org/Command_Templates.html#save-restore-state-for-g-code-moves).
These establish native modal/scale semantics; custom macro behavior is not inferred.

Remaining for #84: attended physical owner acceptance of the configured printer
macro or assisted plan and pause notifications. All automated movement acceptance
uses isolated synthetic printers.

## Account entry, optional email and verified recovery

Issue #87 adds a shared entry frame for login, setup, invitation, address
verification and forgotten-password flows. Password/passkey entry and browser
pairing remain available without SMTP. Entry forms remain disabled before
hydration; token fragments are removed from the address bar and entry responses
use no-referrer. Opening a link does not consume it; verification and reset require
explicit submission. New fragment navigation and late responses cannot replace a
newer recovery token. Used, expired, revoked and recipient-bound invitations have
specific guidance. Private Account access/settings are SSR-awaited remote queries;
refreshes preserve input drafts and no longer begin with a mount-time fetch.

SMTP is optional server configuration with owner test-mail controls and redacted
status. Existing email addresses remain unverified until the signed-in user
requests an address-bound, expiring verification link and confirms it. Enrollment
and possession of an arbitrary copyable invitation do not verify the typed email.
Email invitations bind enrollment to a chosen recipient; copyable bearer invitations
remain supported. Revocation state persists for review.

Ordinary email reset uses a hashed single-use token bound to the current email,
security epoch and browser login version. Password hashing precedes a synchronous
transaction that consumes the token, checks eligibility, writes the new hash,
increments loginVersion and invalidates browser sessions, pairing grants and other
recovery links. An active non-null password is required, so this cannot bypass
emergency owner recovery. Both epochs fence delayed password/passkey sign-in and
pairing creation, and are checked again on every session use. Ordinary reset
preserves passkeys, slicer keys and push registration epochs. Existing offline
emergency recovery retains its stronger credential revocation policy.

Recovery requests give generic responses, apply persistent global/IP/address
bounds, and leave account credentials unchanged until a valid token is submitted.
Only verified accounts are eligible; SMTP and missing-account response paths do
not expose availability. Requests and reset endpoints are same-origin and bounded.
The existing fixed 90-day browser-session policy remains unchanged.

Email issuance and outbox insertion commit atomically. Payloads are AES-GCM sealed
using an installation-secret-derived key; raw recovery tokens are not persisted.
The process-scoped Effect mail worker owns one send at a time. It revalidates
account/token/invitation state before claiming SMTP dispatch, uses owned net/TLS
sockets with a 20-second absolute deadline and closes them on scoped shutdown.
An interrupted/ambiguous send becomes unknown and is never automatically retried;
only a failed status checkpoint retries storage. Terminal ciphertext is erased,
queued messages expire after five minutes and history is pruned after seven days.
SMTP acceptance is explicitly distinguished from inbox delivery.

See [account email setup](account-email.md). Synthetic tests exercise concurrent
reset redemption, delayed login/pairing, emergency recovery interactions, stale
addresses/tokens, outbox capacity/restart, SMTP trickle/deadline/shutdown and full
headless email verification/reset/invitation flows. Live SMTP delivery remains a
host configuration and acceptance step; no real email provider is enabled by default.

### Document navigation

Ordinary application links inherit `data-sveltekit-reload` from the root layout
and use browser document navigation. Account sections are normal links to
`/account?section=notifications`, `integrations`, or `preferences`; `/account`
selects Access & people. The server selects the section before rendering, including
when JavaScript is disabled. Unknown section values fall back to Access & people.
Previous fragment-based internal links have been updated; fragments cannot select
server-rendered sections because browsers do not send them to the server.
Configuration file links explicitly retain client navigation so switching files
preserves unsaved multi-file drafts. Imperative navigation after uploads and the in-memory calibration proposal handoff
remains explicit, as do fragment-token handling and interactive menus/actions.

Application reads and mutations use typed remote functions; #128 is complete.
See [the remote-function inventory](frontend-remote-functions.md) for implemented
operations and intentional transport boundaries.

### Owner-assisted password reset

Issue #123 adds owner-issued ten-minute, single-use password reset links for
operator/viewer accounts without requiring SMTP or a verified email address.
Issuance requires explicit recipient confirmation and a genuine password/passkey
session created within ten minutes; paired sessions do not qualify. Persistent
issuance throttles and active/history bounds prevent unbounded storage. Raw tokens
are returned only by the creation command and held in dialog state; queries expose
nonsecret history and revocation IDs. Only a token digest is persisted.

Redemption atomically revalidates issuer role/credential epochs and target role,
email and credential epochs, consumes the token, advances loginVersion and revokes
browser sessions/pairing grants. Passkeys and integration epochs remain unchanged;
unverified email remains unverified. Issuance/revocation/redemption and known failed
redemptions are audited without raw secrets. Existing host recovery remains the
path for owners and keeps its stronger revocation policy. Migration 006 is shared
by application startup and the host auth CLI.

### Shared starfield

The navigation rail and account-entry screens share a decorative CSS starfield.
Five fixed-size radial-gradient tiles provide static depth and sparse opacity-only
twinkling, independent of page height. It stays inside each midnight surface,
behind controls, without scripts, image downloads or canvas rendering. Reduced
motion disables the twinkling and account-entry orbit. Printer data surfaces
retain the established warm neutrals and teal. This implements issue #72 using
the owner-provided starfield reference.

### Configuration language intelligence

Issue #33 adds browser-local raw-source assistance: a source-preserving Klipper
configuration scanner, an adapted MIT Jinja grammar for single-brace expressions,
conservative structural errors and advisory parser warnings, Problems navigation,
reference-backed completion, and unambiguous macro/include navigation through
loaded drafts. It does not evaluate templates or change application safeguards.
The source/index core is independent of CodeMirror; direct integration is used
instead of requiring a language-server protocol or Python runtime.

The current file plus bounded loaded drafts provide workspace context; no private
workspace prefetch is introduced. Large-file diagnostics run in a disposable,
bounded browser worker and stale results cannot replace current diagnostics.
Session-local serialized editor history survives file and guided/raw switches
with fresh callbacks and permissions, explicit reset semantics and memory-limit
feedback. See [configuration intelligence](configuration-intelligence.md) for
usage, parser provenance, generation, limits and verification boundaries.

### Account-owned Overview layouts

Issue #79 adds Balanced, Camera focus and Compact starting layouts. A keyboard-
and touch-accessible Customize dialog stages panel order/visibility, with explicit
Save, Cancel and reset. The existing authenticated preference remote command
persists a validated, bounded layout per account; old or malformed stored layouts
fall back to Balanced. There is no new frontend fetch or schema migration.

Current job/actions, connection/recovery notices and compact readings for every
heater remain outside optional panels. The logical panel order is also the DOM
and mobile order; phones use one column without a separate layout. Hidden or
reordered temperature controls stay mounted, retaining unsent heater targets.
The mandatory readings can temporarily reveal those controls without altering the
saved layout. Hidden camera panels unmount to release playback. No layout action
submits a printer command.

Explicit layout saves use a serialized, non-optimistic preference commit. Failed
commits neither publish an attempted layout nor leave a queued retry that Cancel
could accidentally save later. Ordinary preference writes wait behind confirmed
commits and preserve subsequent local patches. Account changes invalidate results.
Saved changes appear on other devices on their next document load, rather than
rearranging a dashboard during use.

Issue #66 replaces the combined history's sensor dropdown with compact labelled
rows showing actual/target readings or explicit unavailability. Row buttons focus
a sensor, All sensors restores combined history, and accessible names include
readings. Additional heater controls remain read-only. Existing keyboard sample
inspection, time-window preferences, reconnect history and plotting gaps remain.

### Bed mesh inspection colors and reference

Issue #75 gives adjacent reported sample connections height colors using the
same symmetric scale as the top-down map, point fills and shared legend. A segment
uses the mean of its two endpoint heights, with a theme-aware contrast boost
where CSS color mixing is supported; older browsers retain the base color. Coordinates and exact sample values
are unchanged. This remains a wireframe of measured samples, not a reconstruction
of Klipper's interpolated compensation surface. The selected sample has a stronger
outline in the isometric view.

The compact legend marks zero and the selected height. In comparisons, zero means
no difference between the selected and reference mesh; otherwise it is the mesh's
reported reference, not necessarily its lowest point. Zero stays centered even for
one-sided or flat meshes. Rotation/tilt sliders, amplification, reset and numeric
sample inspection are retained; extended control and interpretation help lives
in a disclosure. This work does not initiate probing or change printer state.

Dense mesh connections are batched into at most 33 SVG paths above 512 edges.
Every measured endpoint and edge is retained; only connection colors are grouped
into 33 height bands. This avoids thousands of reactive SVG line elements while
preserving the existing full sample grid. Small meshes retain individual colors.

### Bed mesh saving and profile management

The usual-mesh path calibrates directly into Klipper's `default` profile, retaining
that identifier for existing print-start compatibility. A saved row’s Replace action retains that fixed target, including Usual mesh.
Acceptance replaces it without a naming or copy option. New calibration instead
uses a private temporary profile, then Save as requires a unique new name and
preserves every existing saved profile. Repeated replacement does not create a
new permanent run profile. The legacy temporary-profile path remains available to
operators, who cannot perform the new owner configuration-persistence flow.

The process-owned mesh queue journals the reservation, selected target, previous
active mesh, candidate, and intended new name. Legacy staged-copy evidence remains recoverable. Private configuration evidence
is retained separately in a bounded SQLite table, never included in dashboard
snapshots. Replacement requires no existing pending settings and a durably saved
previous active mesh. Saving verifies the owned pending manifest and source
fingerprints, calls SAVE_CONFIG once, and verifies saved bytes and a Klipper ready
notification. A websocket reconnection alone does not establish a restart.
Discard checks the same evidence, restarts without saving, and restores previous
compensation under a separate bounded continuation deadline. Unrelated pending
changes block either operation. Unknown outcomes retain evidence and expose a
read-only reconciliation action; physical commands are never automatically replayed.

The Saved meshes list separates inspection from activation. Load/clear are idle
queued actions with stale-target protection. Deletion requires an owner, an unused
mesh, reviewed external start-code references, and a verified save/restart. Known
literal macro references and profiles defined in editable configuration block
deletion. Runtime selection does not configure print startup. The UI explicitly
marks startup behavior as unverified and links to the configuration editor;
dynamic macros and slicer start G-code are not inferred or rewritten.

Release validation passed for #137. Attended physical acceptance remains separate;
development uses synthetic fixtures only.

Klipper cannot persist removal of its final autosave section using SAVE_CONFIG.
That deletion case uses the journaled exact main source without the removed
suffix, one multipart upload, verified readback and owned pending removal, followed
by one RESTART. Included files and the editable source remain unchanged. A lost
upload acknowledgement is reconciled through reads before the next stage;
unverified bytes prevent restart. The same stored bytes and loaded-removal evidence
are required for later reconciliation.
Fallback eligibility inspects all raw generated sections, including overridden
ones omitted from the effective source index. Unreviewable mixed sections are
refused before staging removal; an effective-value comparison cannot authorize
dropping unrelated raw configuration.

### Composable workflow notices

The global workflow region uses a shared `WorkflowNotice` shell with named title,
content and action snippets. Domain lock detection, attention priority and role
rules remain data-only; workflow presentation is supplied by Svelte components.
Mesh notices show backend-reported sample counts across navigation. Extrusion
simulator counts are measured by its synthetic workflow; live filament movement
and PID use phase text rather than estimated percentages. Manual steps, review,
and unavailable telemetry remain explicit. Emergency and uncertain action recovery
continue to take priority. This shell can accommodate future print actions without
placing UI fragments in backend snapshots.

Bed mesh preparation opens from the Saved meshes action row. New calibration
has no replacement selector; the result review offers Save as with a unique name.
A saved row's Replace action opens preparation with an explicit fixed target.
Each opening resets physical acknowledgments and captures the selected target's
expected mesh evidence. The page retains result review, visualization and recovery
controls, while measured probing progress lives in the global workflow notice.

New-profile persistence accepts only a candidate matching the reviewed measurements
and its evidence-owned temporary section’s null tombstone. Baseline absence is
verified against loaded configuration, effective definitions and raw source headers,
including included files. Name intent is journaled before staging, temporary runtime
removal is verified, and one SAVE_CONFIG persists only the named result. Exact
source readback and loaded-profile verification also prove the internal section is
absent. Unrelated pending entries block both save and discard. Evidence-backed new
discard permits owned entries to be absent after an interrupted cleanup; it still
requires unchanged baseline sources. Discard intent survives restart, and read-only
reconciliation retains the compensation-restoration obligation. A fresh explicit
restoration can complete without repeating an already verified restart.

### Shared active print status

The shared workflow region presents reported print progress, filename, remaining
estimate and pause state on every page. It reuses the existing print action forms
and explicit heater-choice Stop confirmation. Overview and Jobs keep their detailed
job summaries without a second control group. Filament guidance replaces ordinary
Resume, while emergency/recovery retains precedence. No start command or automatic
print retry is introduced. Overview reuses its dashboard live query; other pages
reuse the printer live query, preserving one relevant stream per route.

Enhanced print submissions journal their UUID and pending state in browser storage
before dispatch, scoped to the authenticated account and installation origin.
Separate keys avoid cross-tab write loss. Navigation, reload and missing receipts
do not release that uncertainty. Terminal receipts or explicit owner-reviewed
outcomes resolve it; schema 026 records recovery-review metadata, including the
previous fixed owner-review history message. Storage failure blocks enhanced print
submission rather than forgetting an ID. No command payloads, credentials or
private media are stored in this journal.

An explicit Check receipt command verifies ownership and account identity, returning
an existing receipt unchanged. For an absent UUID it atomically records a failed
closed-ID row. Every admission path must commit that unique action row before
physical work, so a later original submission is refused rather than executed.
This operation never dispatches or replays a printer command. Unknown accepted
physical outcomes still require the existing owner recovery review. Native forms
retain their server-rendered confirmation and receipt redirect fallback.

Local USB MJPEG profiles feed shared H.264 conversion through the managed
companion’s loopback HTTP MJPEG endpoint. Native V4L2 JPEG tracks cannot
use the implicit RTSP hop. H.264/HEVC and network sources retain their existing
transport. Raw-only USB conversion remains unverified; the pinned companion’s Y4M
path does not safely normalize packed/semiplanar pixel layouts. This assumes the supplied companion configuration’s internal API port
1984, independent of host port mappings. Physical acceptance is tracked in #147.

Authentication uses the pinned Better Auth SQLite dialect with `BEGIN IMMEDIATE`
for its transactions. Before taking that lock, authentication asynchronously
reserves the same Effect SQL connection used by the process services. This queues
background SQL without blocking the event loop. Enrollment claim/audit statements
use that reservation too, releasing it before entering the auth adapter mutex.
Reserving the writer before reads avoids a stale WAL read
snapshot when the process-scoped printer services write through their separate
connection. Transactions retain commit/rollback semantics; enrollment is never
replayed and a claimed invitation is never reopened after an ambiguous failure.

## Versioned distribution (0.1.0-alpha.1)

Tagged releases rerun CI and native Linux amd64/arm64 image/lifecycle checks before
publishing a multi-platform GHCR manifest. Package version and tag must agree and
the source must belong to main. Exact image digests, commit metadata, OCI labels,
install bundles and checksums make the install path independent of a source build.
Release assets are staged in a draft before publication; mismatched version tags
are never overwritten. The standard bundle binds only loopback, defaults to the
simulator, and explicitly names its data/backup volumes. Existing custom/source
installs retain their own volume identity and are not silently migrated.

The restore helper only accepts a fresh target with no database, secret or WAL/SHM
files, checks backup integrity/secret mode, and uses exclusive copies. Rollback uses
the old image with its matching backup in a fresh volume, preserving upgraded data
for diagnosis. Lifecycle CI exercises account persistence and a durable marker
through install, upgrade and rollback. No physical printer commands are involved.

Versioned install/upgrade guides and the docs index cover this distribution pass.
The release-tag Wiki snapshot, illustrated core-workflow guides and explicit alpha
acceptance ledger complete the distribution documentation pass in #149. Release
automation is tracked in #150. Registry visibility is separately verified
through anonymous access before publishing an installable release.

Interrupted mesh recovery (0.1.0-alpha.2; unreleased until tag publication): candidate-less interrupted runs can use
read-only persistence reconciliation to prove restoration of the pre-run saved
and loaded baseline with no pending settings. Explicit Discard then journals the
activation obligation and restores previous compensation without restarting.
Reconciliation retains unresolved recovery until that compensation is verified.
Emergency recovery may independently close after automatic readiness checks.

Failure notices (0.1.0-alpha.2; unreleased until tag publication) are an account-scoped server projection of receipt
history. Completed mesh finish/cancel/reconciliation receipts resolve preceding
failed attempts with the same probe ID; receipt statuses remain unchanged.
SQLite acknowledgement records suppress manually acknowledged receipt IDs before
SSR and live snapshots are serialized. A typed remote command acknowledges only
currently visible owned failures, then wakes subscribers. No sessionStorage or
hydration dismissal is used, and no acknowledgement changes printer recovery.

Live Z control stability (unreleased): the adjustment region has fixed structure
above its movement buttons across routine pending/telemetry/mode changes. Session
acknowledgements and routine receipt statuses are not rendered there; failures
remain below. Current coordinate uses large tabular numerals next to the controls.
Preparation reuses the existing guarded Home All command. A locally initiated
start focuses/scrolls once only after its matching session is observed active;
there is no automatic homing, command replay or observer navigation.

Workshop dialog completion (unreleased): pending settings review has a bounded,
scrolling body with a same-size loading skeleton and separated submit/recovery
sections. The shared Z/PID dialog tracks the explicitly submitted application UUID
and closes/navigates only for that operation's matching verified-ready outcome.
Save additionally requires verified writes; discard requires verified discard
mode. Historical ready cards are hidden from a fresh review while global readiness
gating remains authoritative. Errors/unknown outcomes retain the dialog.

Layout stability pass (unreleased, #159): shared fixed-size scrolling feedback and
workflow frames absorb routine status changes without moving controls. Basic
forms suppress routine progress/success receipt paragraphs, preserving failures,
unknown outcomes and receipt links. Heater labels/hints and numeric readings stay
stable; console/PID readiness and extrusion errors follow their controls.
ReviewSkeleton is shared with the existing reserved pending-settings body.
An owner-only development gallery provides synthetic state switches; production
builds reject its route. See docs/layout-stability.md for scope and test cases.

Browser transport feedback (unreleased): server snapshots remain the presentation
source while live queries attach/reconnect. Browser stream availability gates
commands separately from printer readiness; it no longer creates reconnect
notices or marks otherwise valid retained mesh data stale. Backend faults,
unknown command receipts and camera playback retain their own feedback.

Raw USB camera conversion (unreleased): validated YUYV/NV12 profiles use one
on-demand FFmpeg V4L2 capture with the explicit native input format and H.264
output. Other quality producers consume that named encoded stream; they never
open the device independently. Alignment and pixel-throughput bounds reject
unsupported raw profiles. Local test failures give bounded, credential-free
capture/mapping guidance. A pinned-companion synthetic raw probe checks decoded
colors, shared mixed-quality capture, idle teardown and unavailable-input recovery.
Actual raw drivers, Safari/native HLS and low-power throughput remain coordinated
hardware/platform acceptance; no claim of universal camera compatibility is made.

Preferences persistence pilot (unreleased): pinned Drizzle 1.0.0-rc.5 uses the
Effect-native SQLite adapter over the existing process client. Typed table
metadata mirrors migration 020; existing Effect migrations, JSON text format,
atomic JSON merge, runtime parsing and service SqlError contracts are preserved.
No additional connection, query caching or ORM migration runner is introduced.
Authentication retains its current dialect and shared writer reservation.
See [persistence.md](persistence.md) for the approved boundary, acceptance and
remaining migration scope; issue #90 remains open for the other stores.

Filament settings persistence (unreleased, #164/#165): native Drizzle queries use
that same process client and preserve migration 023's JSON/revision format.
Revision-zero inserts refuse existing rows; updates require the matching SQL
revision and increment it atomically. The existing transaction and explicit
reservation/session lock query retain workflow ownership checks. No printer
commands, schema changes or authentication changes are introduced. The remaining
store inventory in persistence.md defines later reviewed batches; a complete ORM
conversion is not a beta prerequisite.

Beta core readiness (unreleased, #166): a pinned development-only axe engine adds
an isolated production smoke across default core routes, light/dark responsive
sizes, enlarged text and public entry/recovery. Keyboard checks exercise skip,
modal wrapping and menu navigation/focus return. The audit fixed light secondary
text, sensor reading and dark destination/teal contrast without changing control
lifecycle or reconnect presentation. Existing state-specific component/smoke tests
remain the evidence for drafts, permission gates and failed/unknown recovery;
manual assistive-technology and device acceptance are not replaced by automation.
