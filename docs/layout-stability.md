# Stable workflow layouts (unreleased)

Routine state updates should not move the next control an operator is about to
press. A disabled, unchanged button and its busy accessibility state communicate
submission; routine queued/sending receipts and quiet success do not insert new
paragraphs into basic forms. Failed and uncertain receipts remain actionable.

## Shared conventions

- Persistent workflow notices have a fixed frame at desktop and phone widths.
  Details scroll within that frame, with keyboard access; action links stay in
  their own row/column. This does not hide safety or recovery messages.
- Local readiness and configuration feedback use a reserved, visually distinct
  scrolling region. Empty regions contain no live announcement. Long messages
  remain readable without changing the controls' positions.
- Loading review content uses a shared skeleton inside a reserved review body.
  Unknown values are placeholders, never fabricated zeroes.
- Heater target hints reserve their line space and numeric readings use tabular
  numerals. Drafts remain editable across telemetry, pending and reconnect states.
- Console and PID readiness appears after their controls; extrusion recovery and
  failures do not insert paragraphs above the measurement controls.

Entering another workflow step, intentionally expanding help, opening a dialog or
adding a genuinely new safety condition can still change the page composition.
The fixed-frame convention covers updates within an existing state surface, not
an empty permanent banner when no workflow is active. Emergency controls remain
outside the scrolling notice details and are never suppressed as routine feedback.

## Development gallery

Run the source development server, sign in as an owner and open
`/dev/layout-states`. Select Ready, Loading, Pending, Success, Error or Reconnect.
The gallery uses synthetic local controls and sends no printer/configuration
requests. It is unavailable in production builds. This provides a small visual
fixture surface without introducing Storybook or another application framework.

Headless tests switch the same states at 1440, 390 and 320 CSS pixels, measuring
control positions in document coordinates, checking for horizontal overflow and
verifying retained drafts. Real scrolling is not counted as a layout shift.
Review the rendered cases as well as numeric tests: a stable bounding box alone
cannot prove that text is readable or that recovery is understandable.
