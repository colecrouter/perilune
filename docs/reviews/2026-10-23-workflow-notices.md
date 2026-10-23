# Composable workflow notices and mesh entry review

Independent review approved the final implementation with no remaining actionable
findings. The initial review found replacement buttons accepting profile names
that calibration could not save. Shared calibration-target validation now gates
Replace, its fixed-target preparation entry and the new-calibration target list.
Unsupported names receive an explanation; inspection and supported activation are
unaffected. Regression coverage includes long live names and invalid simulator
names, destination evidence capture and reset acknowledgments on reopening.

The final reviewer independently passed 23 focused tests across five files and
`pnpm check` with no errors or warnings. Existing emergency/recovery precedence,
role restrictions and private-message filtering remain in the domain/safety flow.
The notice shell accepts named title, content and actions snippets; backend state
remains data-only. Progress uses reported mesh samples, simulator movement counts,
and phase text where physical progress is unavailable.

Production simulator and loopback live mesh smokes passed. Headless rendered QA
checked desktop and 320px, fixed-target Replace, fresh New calibration intent,
progress retained through navigation to Account, no duplicate local mesh progress,
no page errors and no horizontal overflow. Native T3 preview snapshots twice failed
with `Preview automation snapshot timed out after 15000ms.` Repository Playwright
provided the headless fallback. No real printer commands were issued.

Full `pnpm validate` and Docker CI are release gates, with the local full run in
progress when this review record was written.
