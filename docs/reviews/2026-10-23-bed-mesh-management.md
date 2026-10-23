# Bed mesh management

Issue: #137. Independent design review approved a bounded target-at-start approach:
calibrate into the chosen destination, persist only on acceptance, and discard by
restarting without saving. `LOAD` alone cannot roll back pending autosave changes.

The implementation keeps private source evidence in a bounded SQLite journal,
requires a complete idle/cold owner review for replacement, rejects preexisting
or unrelated pending settings, checks saved source fingerprints, and verifies
saved bytes and a Klipper ready notification after restart. Selection remains
separate from inspection. Saved-profile deletion stages a reviewed removal and
persists it with one verified save/restart; known macro references block deletion.

Print-start behavior remains explicitly unverified: existing startup configuration
is preserved, the usual mesh retains Klipper's `default` name, and a guide points
owners to the existing configuration editor. The app does not claim to know which
macro or slicer will start a print or execute dynamic G-code.

Implementation review and release validation are pending. No real printer
calibration, profile mutation, configuration save, restart, or deletion was issued
for this milestone during development.

First implementation review found three P2 issues: the post-restart load reused
its original queue expiry, simulator optional copies replaced the wrong profile,
and intended copies were not journaled before dispatch. All three received code
fixes and targeted regression tests. The focused persistence, live service,
simulator and headless component suites currently pass 37 tests. Full release
validation and follow-up review remain pending.

The discard continuation now starts its own 30-second deadline after restart
verification. Intended copy names are persisted before dispatch, and discard
accepts an owned optional copy only when it is present and exactly matches the
candidate. Simulator acceptance saves the replacement target and distinct copy
separately. Regression coverage includes slow startup, lost copy acknowledgement,
copy present/absent recovery, and duplicate simulator copy rejection.

Final independent implementation review approved the code with no remaining
actionable findings. The loaded-baseline check now applies to both normal discard
completion and unknown reconciliation. Its regression proves that unchanged saved
bytes cannot mask incorrect loaded interpolation parameters, and that failure
issues exactly one restart with no retry. The reviewer independently reran the
persistence suite: 10/10 passed.

Production loopback smoke exercises the real configuration/source-evidence HTTP
path, usual replacement plus explicit named copy, single save, discard/restart,
shared progress, retained other-page drafts, one backend socket, and 320px layout.
Headless Chromium QA checked desktop, 390px and 320px layouts, load, delete,
confirmation, restart retention and overflow with no page errors. Native T3
snapshot automation twice timed out on the same step; repository headless
Playwright provided the fallback. No live printer actions were issued.

The first full `pnpm validate` passed: 692 tests across 99 files, production build,
backup checks and every smoke group. A subsequent compatibility check found
Klipper's SAVE_CONFIG returns without writing when no autosave sections remain.
Final-section deletion now journals the exact before/after main source, uploads
only the source with its entirely removed generated suffix, verifies upload bytes
and unchanged included files/owned pending removal, then requests RESTART once.
The standard deletion path still uses SAVE_CONFIG. Both verify loaded configuration
and retain unknown outcomes without replay. Additional tests and final review cover
the fallback, lost upload acknowledgement, and failed readback preventing restart.

The fallback review caught an overridden-source hazard: resolved definitions can
omit raw generated sections shadowed by editable settings. Eligibility now scans
every section in the original protected suffix, and deletion preflight refuses
unreviewable mixed cases before staging a removal. A regression retains an
unrelated fully overridden generated section and proves no write was dispatched.
The extended production loopback smoke now passes deletion of both a named copy
and the final usual mesh, including real multipart source upload and restart.

The final raw-header follow-up review approved the commented-header guard with no
actionable findings. Hash and semicolon comments use source-review parsing;
unrecognized bracket forms fail closed before removal dispatch. The reviewer
independently passed 24 persistence/source/pending-configuration tests. The
expanded persistence suite passes 15 tests, including both commented unrelated
section regressions; type checks report no errors or warnings.

The second full `pnpm validate` completed successfully: 696 tests across 99 files,
production build, backup checks and every smoke suite. That run started before
the final commented-header regression was added; the final guard was separately
verified by the 15-test persistence suite, clean type checks, and the independent
24-test follow-up review. Docker CI and attended physical acceptance remain
release/review gates.
