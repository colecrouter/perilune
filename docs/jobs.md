# Jobs

Open **Jobs** to upload and inspect a sliced text `.gcode` file. Uploading through Jobs never
starts a print. Choose a file, review its reported material and estimates, then
use the explicit start action once the printer or simulator is ready. Missing metadata
is shown as “Not reported”; no compatibility or collision guarantee is inferred
from the file. Stop offers independent nozzle and bed cooldown choices.

Uploads are limited to 20 MiB each, 100 files and 200 MiB in the local library.
If an upload times out, refresh the library or retry the same file. Identical
retries are safe. Rename a changed file before uploading; overwriting is not
supported. A file in an active/pending print cannot be removed. Library contents
and observed history persist in the configured database.

## Browsing the library

Desktop uses a TanStack table with optional columns for material, estimated time,
size and upload date. Header and pagination links, filename links, and the search
GET form work with JavaScript disabled. Filters, order, page and page size live in
the URL, so views can be bookmarked and browser history works. File details retain
the library query; mobile opens details directly with a back-to-library link.
Sorting, page-size choices and filter forms preserve scroll and focus on surviving
controls. Desktop file selection and pagination preserve the current scroll position. Mobile file navigation resets to the detail view.
Column visibility is an enhanced, per-tab preference.

Queries run on the server against the bounded process-owned catalog, before
returning only 10 (the default), 25 or 50 rows. Recent print history initially shows five entries with an explicit option to expand retained history. SQLite still stores the files; this milestone
changes neither storage limits nor overwrite rules. Moonraker metadata loads on
inspection. Material filtering and material/estimate sorting are disabled until
metadata has been inspected for every mirrored file, so incomplete metadata never
silently excludes files. Filename, size and date queries remain available.

Five-second refreshes preserve search drafts, column choices and open dialogs.
A removed file shows a friendly unavailable state; reconnects retain cached data.

## Sending from OrcaSlicer

1. Open **Account → Integrations** and create a named key. Choose **Upload files** or **Upload and start prints**.
2. Use **Copy key** or explicitly **Reveal key**. Full keys are returned only at creation; revoke and replace a lost key.
3. In the slicer's printer connection settings, select **Klipper / Moonraker**.
4. Set the host to the Perilune app's HTTPS address and paste the key into
   the API key field. Loopback HTTP works for local development.
5. Export text G-code. Choose **Upload and print** with a print-enabled key, or **Upload only** to review and start the job in Perilune.

These settings implement the Moonraker connection/upload contract, verified with
protocol requests matching Orca's client. Owner acceptance on macOS with OrcaSlicer approximately 2.4.2 confirmed Device-tab pairing, persistence after a full quit/relaunch, and remote session revocation. An additional proxy login layer may need its own native-client
access configuration. With `PERILUNE_LIVE_CONTROLS=true`, live uploads go directly to Moonraker and are read back for SHA-256 verification. Live deletion requires an idle printer and a freshly matching file identity.

Keys do not grant browser login, file browsing, arbitrary console commands or configuration access. Upload-only keys cannot start a print; existing keys retain that permission. New keys default to no expiration, with optional expiry. Existing keys retain their original expiry; account deletion, role changes or recovery invalidate them. Native clients use `X-Api-Key`; there is no token-in-URL API.

The upload endpoint accepts a multipart `file`, optional `root=gcodes`, and `print=false` or `print=true`. Print-enabled keys may request a combined upload/start or POST `{ "filename": "<returned item.path>" }` to `/printer/print/start`. Upload responses include both the bare Moonraker fields and a `result` wrapper for older Orca versions. Always use the returned path: live uploads receive a content fingerprint in their name. Subfolders are not supported. Browser uploads remain upload-only.

Print starts use the same process-owned worker, execution-time readiness checks and recovery as the Jobs page. Success is returned only after the start action completes; it does not mean the whole print has finished. Combined requests then report `print_started=true` and `print_queued=false`. If a start fails after upload, the file remains in Jobs. Inspect the action there before retrying an uncertain start.

Native slicers provide no submission identifier. Repeated starts for the same key/file coalesce for two minutes, including across restart; pending or unknown receipts are never replayed. To deliberately restart the same file sooner after stopping it, use the Jobs page. A request rejected before admission can be retried immediately after fixing readiness. HTTP disconnects do not cancel an admitted physical action.

References: [Moonraker file API](https://moonraker.readthedocs.io/en/latest/external_api/file_manager/),
[OrcaSlicer Moonraker client](https://github.com/OrcaSlicer/OrcaSlicer/blob/main/src/slic3r/Utils/Moonraker.cpp).

## Live file changes

Live uploads and deletion require the basic live-controls opt-in and an idle, ready printer with no pending action or recovery. Uploads remain limited to 20 MiB of UTF-8 text G-code. Perilune adds a SHA-256 fingerprint to the uploaded filename, so different content uses a separate destination rather than replacing the original. Repeating an identical upload verifies existing bytes without sending another upload. A persistent mutation journal prevents replay after uncertain dispatch or restart; if an uncertain upload is absent, use a deliberately new filename after inspecting the library. Uploaded files remain on Moonraker's G-code filesystem, not in Perilune's SQLite database.

Deletion checks the displayed file identity again before sending one DELETE. A lost reply is never automatically retried. Refresh the library to inspect the result. Keep other printer clients idle during file changes: Moonraker offers no atomic conditional create/delete, so an external writer can still change a path between checking and dispatch. Perilune serializes its own file mutations against ordinary command admission; emergency shutdown remains independent.

## Planned manual interventions

File inspection and both enhanced and JavaScript-disabled start reviews show counts
of recognizable M600 filament changes and PAUSE/M0/M1/M25 pauses, with up to twelve
command locations. The static inspection is bounded to 20 MiB of UTF-8 G-code and
never executes or expands macros. “None found” and “Not inspected” are distinct;
unavailable/large files and older stored metadata do not receive a fabricated zero.
Comments and commands embedded in response strings are not counted. Printer macros
can introduce other pauses and determine what each command actually does. This is
an intervention preview, not a safety or compatibility validator. See the in-app
Help page and [daily-use acceptance](daily-use.md).
