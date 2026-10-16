# Staged Resume review

A live sliced file requested M600 filament changes. Its first RESUME purges and intentionally remains paused; a second explicit RESUME continues printing. Perilune incorrectly treated that acknowledged paused outcome as unknown and locked subsequent controls.

The fix recognizes acknowledged, same-run, idle paused completion with an explicit message. It does not infer success from missing acknowledgement, movement in progress, unknown identity or a different run/file. An independent reviewer requested rejecting missing run IDs before dispatch and allowing a bounded longer observation period for purge motion; both are implemented.

Paused recovery is a separate explicit owner attestation. It fences the current reviewed view and original durable Resume filename, preserves the unknown receipt and sends no physical command. Process-local old run IDs are not claimed as durable proof. Full validation and final independent review results are recorded in the PR.
