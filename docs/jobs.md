# Jobs

Open **Jobs** to upload and inspect a sliced text `.gcode` file. Uploading never
starts a print. Choose a file, review its reported material and estimates, then
use **Review & start simulation** once the simulator is ready. Missing metadata
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
controls. File navigation and pagination retain the normal navigation reset.
Column visibility is an enhanced, per-tab preference.

Queries run on the server against the bounded process-owned catalog, before
returning only 10, 25 or 50 rows. SQLite still stores the files; this milestone
changes neither storage limits nor overwrite rules. Moonraker metadata loads on
inspection. Material filtering and material/estimate sorting are disabled until
metadata has been inspected for every mirrored file, so incomplete metadata never
silently excludes files. Filename, size and date queries remain available.

Five-second refreshes preserve search drafts, column choices and open dialogs.
A removed file shows a friendly unavailable state; reconnects retain cached data.

## Sending from OrcaSlicer

1. In Jobs, expand **Send files from your slicer** and create an upload-only key.
2. Copy the key before hiding it. It is shown only once; revoke unused keys here.
3. In the slicer's printer connection settings, select **Klipper / Moonraker**.
4. Set the host to the Perilune app's HTTPS address and paste the upload key into
   the API key field. Loopback HTTP works for local development.
5. Export text G-code and choose **Upload only**. Review the job in Perilune.

These settings implement the Moonraker connection/upload contract, verified with
protocol requests matching Orca's client. Actual Orca desktop/device testing is
still outstanding. An additional proxy login layer may need its own native-client
access configuration. With `PERILUNE_LIVE_CONTROLS=true`, live uploads go directly to Moonraker and are read back for SHA-256 verification. Live deletion requires an idle printer and a freshly matching file identity.

Upload keys do not grant browser login, file browsing, commands or automatic
printing. They expire in 90 days, and account deletion, role changes or recovery
invalidate them. Native clients use `X-Api-Key`; there is no token-in-URL API.

The upload endpoint accepts a multipart `file`, optional `root=gcodes`, and
`print=false`. Its successful response follows Moonraker's bare upload object:
`item.path`, `print_started=false`, `print_queued=false`, and `action=create_file`.
Subfolders and requests to start printing are rejected. Browser uploads use the
same bounded storage flow with their existing authenticated session.

References: [Moonraker file API](https://moonraker.readthedocs.io/en/latest/external_api/file_manager/),
[OrcaSlicer Moonraker client](https://github.com/OrcaSlicer/OrcaSlicer/blob/main/src/slic3r/Utils/Moonraker.cpp).

## Live file changes

Live uploads and deletion require the basic live-controls opt-in and an idle, ready printer with no pending action or recovery. Uploads remain limited to 20 MiB of UTF-8 text G-code. Perilune adds a SHA-256 fingerprint to the uploaded filename, so different content uses a separate destination rather than replacing the original. Repeating an identical upload verifies existing bytes without sending another upload. A persistent mutation journal prevents replay after uncertain dispatch or restart; if an uncertain upload is absent, use a deliberately new filename after inspecting the library. Uploaded files remain on Moonraker's G-code filesystem, not in Perilune's SQLite database.

Deletion checks the displayed file identity again before sending one DELETE. A lost reply is never automatically retried. Refresh the library to inspect the result. Keep other printer clients idle during file changes: Moonraker offers no atomic conditional create/delete, so an external writer can still change a path between checking and dispatch. Perilune serializes its own file mutations against ordinary command admission; emergency shutdown remains independent.

If Orca uploads successfully and then reports a start-permission error, the file is already in Jobs. Choose Upload only in the send dialog and start the file from Perilune. Upload keys deliberately cannot authorize a separate `/printer/print/start` request; a valid key receives an actionable403 rather than a browser sign-in prompt.
