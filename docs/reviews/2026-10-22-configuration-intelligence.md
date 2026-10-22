# Configuration intelligence review

Independent design review approved the bounded, loaded-draft scope, with explicit
history ownership, scanner boundaries, conservative diagnostics, source freshness,
index uncertainty, memory bounds and reproducible parser generation requirements.

The first independent implementation review found two actionable issues:

- CRLF drafts compared normalized analysis text with original source in Problems
  guards. Rendering and navigation now compare normalized source consistently.
- Equals signs inside filtered capture blocks were mistaken for assignments.
  Capture recognition now distinguishes the capture form, and the adapted grammar
  accepts filtered captures.

Both findings have regression fixtures. The final independent implementation
review approved with no actionable findings and independently reran 21 analysis,
worker-client and assistance tests. It verified bounded worker disposal/queuing,
stale-result guards, cross-file Problems navigation, history resets and
conservative diagnostics. It did not verify full validation, production QA or
Docker CI. A final compatibility fixture also covers plus whitespace control.

Maintainer validation passed 660 tests across 94 files, type checks, lint and
formatting. The final targeted run passed 27 tests across analysis, worker,
completion and browser integration. Parser regeneration produced identical
committed artifacts. Production build succeeded.

Headless production browser QA used only synthetic simulator configuration.
Desktop and 390px mobile checks covered diagnostics, clickable source locations,
file switching with retained drafts and undo, cross-file Problems navigation,
exact include navigation and macro navigation. No browser errors or horizontal
mobile overflow were observed. A 238,027-character macro source took approximately
23 ms of synchronous editor work; debounced worker diagnostics completed in about
817 ms total. These are local measurements, not hardware-independent guarantees.

The native preview snapshot step twice returned
`Preview automation snapshot timed out after 15000ms.`; repository headless
Playwright was used after reporting that limitation. No private configuration was
captured, and no printer command or configuration write was performed.

CI follow-up: the actions smoke timed out awaiting the viewer login page after
registration. Its HTTP200 assertion did not distinguish invitation inspection
from enrollment or verify the remote result. The fixture now matches the enroll
operation, captures and asserts the real response before allowing the immediate
hard navigation, and blocks service workers as the other interception-based
contexts do. No application behavior was changed.
