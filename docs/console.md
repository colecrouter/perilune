# Macros and console

Open **Console** for macro discovery, shortcuts, command history and printer
responses. Operator or owner access is required: output may include private
filenames, diagnostics or values printed by your own macros. Viewers retain the
ordinary dashboard but cannot read or submit console activity.

## Simulator

The console runs diagnostic examples only: `M105`, `M114`, `HELP`,
`PERILUNE_STATUS`, `CHECK_FILAMENT` and `SIMULATE_FAILURE`. The last command
intentionally demonstrates an error. No console example moves or heats anything;
unsupported commands fail clearly instead of pretending to execute. These
read-only examples can run during a simulated print, but calibration/configuration
ownership, pending printer controls, disconnects and storage problems block them.

Type up to eight lines/2,048 characters and choose **Review command…**. Inspect the
exact text, then **Run in simulator**. Macro buttons open the same review without
overwriting another command you are composing. Pin shortcuts with the star;
shortcuts are per account and shared across that account's devices. Search names
and descriptions, show internal macros when needed, and filter log errors or
submitted commands. **Follow latest** controls whether output scrolls automatically.

Receipts show queued, sending, completed, failed or unknown. Execution belongs to
the backend and continues through navigation. Inputs remain intact through incoming
state updates and reconnects. If submission acknowledgement is lost, **Check receipt**
looks up its existing ID without sending again. **Stop tracking…** only stops local
tracking; it does not cancel or retry the command. Check history before a deliberate
new submission. Unknown results are never automatically replayed.

## Live printers

Perilune discovers loaded macro names and help descriptions through its existing
Moonraker connection. Optional help failures do not interrupt printer telemetry.
No macro bodies or guessed parameters are loaded. Missing descriptions link back
to macro/configuration documentation. Existing G-code responses are collected even
when all browser tabs are closed; they may originate from another printer client.
They are not attributed to an unverified Perilune request.

**Live console and macro execution are disabled on the server**, including when
live bed-mesh or configuration features are enabled. There is no console enable
flag yet. Generic physical commands need coordinated testing, a shared printer
reservation policy and acknowledgement reconciliation before this can change.
Emergency-stop G-code cannot enter this queue; a future immediate emergency-stop
operation must use the dedicated Moonraker endpoint.

## Retention

The visible shared log contains the latest 100 command receipts and 200 live
responses. Receipts persist in the private SQLite database, retained for up to seven
days/2,000 records with periodic cleanup. Live responses are bounded in process
memory and clear on backend restart. Reconnects retain the current process log.
Queued/sending commands become unknown on restart and are never resumed. A maximum
of 20 submissions may be pending; queued commands expire after 30 seconds. Shortcuts
are limited to 24 per account. Exporting or durable external log collection is not
implemented in this milestone.
