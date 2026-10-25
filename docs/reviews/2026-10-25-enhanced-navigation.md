# Restore enhanced navigation

The root reload opt-out from #127 was broader than the intended normal-link
semantics. The correction restores SvelteKit enhancement while keeping URL-driven
SSR sections, explicit receipt refreshes and auth document boundaries. Pending
preference navigation preserves the original URL and inherited reset/history/reload
options. The CSS page-mount fade is 160ms from transparent; no cross-document API,
custom router or navigation delay is introduced.

First reviewer `perilune-enhanced-navigation-review-1` approved the initial diff,
noting option forwarding. The parent added reset/history forwarding and coverage.
Production smoke then exposed a live-query context/proxy retention cycle previously
hidden by document loads. A heap trace identified the global live resource's
creation context retaining the original proxy. Persistent live queries now use a
read-through facade; server services and finite queries are unchanged.

Follow-up reviewer `perilune-enhanced-navigation-review-2` approved with no
correctness findings, checking private-receiver methods, shared-consumer leases,
SSR request scoping and captured navigation options. It independently passed four
navigation tests. The parent additionally passed six focused facade/navigation
checks, the full production smoke with strict stream teardown assertions in both
directions, Jobs smoke, and the 143-state readiness suite with an actual enhanced
link animation check. Native collaborative preview confirmed a Controls click
retained the document and updated URL/title.

Cleanup remains GC-dependent on the framework cache; no explicit new connection
lifecycle is introduced. Full pnpm validate and exact-head Docker/native CI remain
merge gates and are recorded in the PR. No physical commands or production data
were accessed; synthetic fixtures were used throughout.
