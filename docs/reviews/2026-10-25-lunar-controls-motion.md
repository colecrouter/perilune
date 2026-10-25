# Approved lunar controls and motion review

Owner accepted the preview direction, requested switches for appropriate on/off
settings and a subtle page-entry effect, and corrected the orbit occlusion. The
production graphic now masks the orbit beneath the full moon disk. The crowded
fixed-height dialog was confined to the standalone prototype and was corrected
there; no fixed dialog height is introduced in the application.

Independent `perilune-lunar-motion-review-1` approved with no actionable findings.
It verified native switch labels, Space/form/disabled behavior and focus indication,
reduced-motion/document-entry handling, no navigation/exit delay, retained drafts
and telemetry, and SVG masking. It independently passed 11 focused headless tests,
all 143 readiness scans on an isolated port/database, and whitespace checks.

The parent additionally exercised the actual Serif headings switch in native
collaborative preview, checked accessible switch state and stable width, and
inspected desktop/mobile layout. Minor final contrast styling strengthens the
switch's off-track border and thumb outline; behavior is unchanged.

Production build and focused/readiness checks passed. Full pnpm validate and
exact-head Docker/native lifecycle CI remain merge gates, recorded in the PR.
No physical commands or production accesses occurred. Manual assistive technology
and real-device acceptance remain separate. The implementation adds no dependency
and preserves the existing settings-save behavior and explicit safety checkboxes.
