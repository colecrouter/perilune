# Raw USB camera compatibility review

Independent review approved after resolving two findings: both YUYV and NV12
require even height for the H.264 yuv420p output, and media acceptance must exercise
production quality definitions rather than a custom encoder. The shared definition
builder now serves both CameraCompanion.prepare and the synthetic media probe.

The final review found no actionable correctness, security, lifecycle or deployment
issues. It inspected other-format/remux preservation, input escaping, single-capture
sharing, diagnostics, resource limits and documentation claims. The reviewer did
not rerun final tests or media probes; those are parent release gates.

Focused camera suites passed 43 tests. Initial pinned-companion decoded-color,
sharing, idle shutdown and unavailable-input recovery probes passed both YUYV and
NV12. Final production-profile probe results and full validation are recorded in
the PR. No host camera, private media or physical printer operations were used.
Raw driver, cable, Safari and low-power acceptance remain separate device checks.
