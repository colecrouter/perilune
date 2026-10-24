# Configuration language assistance

Available since **0.1.0-alpha.1**. This guide describes **0.1.0-alpha.2**.

Raw configuration editing now adds Klipper-aware assistance to the existing
CodeMirror editor. It never evaluates templates, runs G-code, writes configuration
or restarts firmware. Existing review, backup and application safeguards remain
responsible for saving and applying configuration.

## Using the editor

- Type a setting, section, include path, template name or macro command to see
  suggestions. Use **Suggestions** or Ctrl Space to request them explicitly.
  Setting descriptions come from the bundled Klipper reference, not an inferred
  validation schema. Custom settings and commands are not errors merely because
  they are absent from that reference.
- Use **Find definition at cursor**, F12 or Ctrl/Command Enter on a literal macro
  command or an include. A unique macro definition in loaded drafts opens at its
  source line. Exact includes resolve relative to their source file within the
  known configuration file list. Ambiguous macro definitions and wildcard includes
  explain their uncertainty rather than choosing a target.
- **Problems in this file** lists supported checks with line numbers and clickable
  locations. Structural configuration and template delimiter/block errors have
  specific messages. Recovery errors from the broader Jinja grammar are advisory
  warnings because its supported syntax is not identical to the firmware compiler.
- Previously checked, unchanged loaded drafts can also expose problems while
  editing another file. Selecting one opens its file and source line. Changing
  the corresponding draft invalidates those cached results.
- Undo/redo survives switching files and switching between explained settings and
  raw source. Guided edits form their own undo step. Explicit discard or a clean
  saved-source refresh starts a new history. Histories remain in this browser
  workspace only; reloading or signing out does not persist them.

## Implementation and limits

A source-preserving outer scanner identifies sections, options and indented
multiline values. It masks configuration comments while retaining UTF-16 offsets,
including CRLF and BOM handling. The protected SAVE_CONFIG suffix is excluded.
Repeated sections and unknown modules/options are not rejected as syntax errors.

Template parsing adapts the MIT-licensed CodeMirror Jinja grammar to Klipper's
single-brace expressions. Nested dictionaries, strings, filters, whitespace
control, raw blocks and multiline control flow have synthetic fixtures. See
[src/lib/editor/jinja/README.md](../src/lib/editor/jinja/README.md) for upstream
provenance, differences and the reproducible generation command.

The analysis core is independent of CodeMirror and could support an LSP adapter
later. The current editor uses direct language integration rather than introducing
a server protocol. Templates are parsed individually so an incomplete macro does
not contaminate following sections. No Python runtime or template evaluator is
shipped to the browser.

Assistance indexes at most 32 loaded drafts and 2 MiB of source; the current file
has priority. It does not automatically fetch the private workspace. A known
include path is not proof that its source is loaded or its macros active. Include
order, wildcard expansion, dynamic calls, firmware/module semantics and physical
safety remain outside this analysis. Existing owner-only configuration routes
remain the sole source-reading boundary.

Diagnostics are debounced and capped at 50 per file. Files over 32 KiB use a browser
worker with one active request and one replaceable pending request. Old results
are checked against the active editor document before publication; disposal
resolves pending callers and terminates the worker. Detailed template decorations
are limited to 32 KiB per body and 64 KiB per document; larger bodies retain lightweight
stream highlighting. Editing and existing save/export flows remain available if
worker analysis fails, with an explicit unavailable status.

Serialized undo state retains at most 32 files and 8 MiB, without DOM references or
callbacks. If the cache cannot retain a file, the workspace explicitly reports
that its undo history was not kept; its draft remains available. Restored states
receive fresh permissions, callbacks, reference data and assistance context.
Completion closes when dependency drafts/reference data or edit permissions
change, and definition/problem navigation checks source freshness.

## Verification

Fixtures cover structural recovery, original source ranges, comments, indentation,
CRLF, generated suffixes, Jinja edge cases, unknown modules and ambiguity. Browser
tests cover independent per-file histories, guided edits, explicit history reset,
completion, read-only transitions, diagnostics and CRLF problem navigation.
Worker tests cover bounded replacement, failure and disposal. Production browser
QA uses synthetic simulator configuration only, including large sources and
mobile layouts. Required validation is `pnpm validate` plus CI Docker checks.

Primary references:

- [CodeMirror language packages](https://codemirror.net/examples/lang-package/)
- [CodeMirror lint integration](https://codemirror.net/examples/lint/)
- [Klipper command templates](https://www.klipper 3d.org/Command_Templates.html)
- [Klipper template environment](https://github.com/Klipper 3d/klipper/blob/master/klippy/extras/gcode_macro.py)
- [Klipper configuration reader](https://github.com/Klipper 3d/klipper/blob/master/klippy/configfile.py)
