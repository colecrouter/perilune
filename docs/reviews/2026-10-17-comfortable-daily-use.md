# Comfortable daily use review

Independent review covered planned manual-intervention inspection, live-file reads,
console submission/scrolling, emergency and recovery confirmations, navigation,
compact Jobs/history, documentation, and deployment assumptions.

Resolved findings:

- Unavailable live inspection no longer stays cached forever. Later requests retry
  after a 30-second cooldown while reusing ordinary metadata.
- Attempt timestamps are pruned independently of metadata, including aborted-first
  inspections whose files are subsequently removed.
- Cancellation tests exposed an unhandled rejected reader cancellation; the abort
  callback now consumes that rejection while closing/releasing the reader.
- Command-prefix inspection handles malformed parenthesized comments linearly and
  bounds retained locations instead of expanding macros or retaining arbitrary text.

The dialog audit also verified success closure across all primary-action dialogs; safety confirmation now closes after accepted submission and retains execution feedback in shared activity.

Focused domain/browser and production Jobs/console/live-action checks passed.
Headless visual QA exercised a 320px start dialog, Help anchor navigation, compact
Jobs, and direct console submission without overflow or page errors. The T3 preview
snapshot path timed out twice; the repository’s headless Playwright workflow supplied
the rendered evidence. The final independent review reported no remaining actionable findings. Full validation and Docker CI remain merge requirements.

No real printer movement, heating, firmware writes, or print-start commands were
issued by these tests. Deposited-print and actual iOS/Android installation/delivery
acceptance remain in #52/#35 and docs/daily-use.md for the owner’s milestone review.
