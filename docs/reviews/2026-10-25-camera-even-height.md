# Even-height camera scaling review

Unreleased correction: scaled camera profiles explicitly request proportional even
heights (`height=-2`). Width-only scaling could produce an odd height rejected by
H.264, while Original and a different scaled quality continued working.

Independent review approved with no actionable findings. It inspected both fixed
widths, pinned production companion templates, decoded synthetic media assertions,
encoder teardown, cleanup, and unreleased documentation. The review was static;
execution and full validation remain parent verification.

Focused companion suite: 13 tests passed. Synthetic media acceptance uses a
1280×718 source through the production definitions and checks decoded RGB frames
at 640×360 and 320×180, followed by idle teardown. No private media is captured.
