# Actionable print recovery

The incident exposed separate uncertain Resume attempts, each subsequently
reviewed, followed by a successful Start. Receipt messages alone do not establish
why the original Resume could not be confirmed. This work does not change
filament-change behavior or replay a physical command.

A dedicated recovery destination now presents the remaining emergency, ordinary
uncertain-action, safety-outcome and browser-submission corrections together.
Jobs and notices lead to this destination instead of a diagnostic receipt page.

Independent review found direct-link, modal naming, owner gating, safety-only
preparation, initial journal readiness and pending-operation completion gaps.
These were fixed. Final independent code inspection approved the current diff
with no remaining actionable findings. Reviewers issued no printer commands.

Focused verification: 24 safety service tests and 19 recovery/print notice browser
tests passed before the final pending-operation regression was added. Full
validation and CI results are recorded in the pull request.
