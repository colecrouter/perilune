# Layout conventions and command recall review

Independent reviewer: `review_beta_ux`. Result: approved with no actionable findings.

The review covered shared page framing, desktop movement controls, Activity tabs,
and console command recall. It checked draft preservation, exact multiline recall,
explicit submission, keyboard access, hidden tab panels, safety controls outside
filters, responsive sizing, and unchanged physical command validation.

Rendered checks used a synthetic simulator fixture in the collaborative browser.
All 12 primary pages had identical heading coordinates at each of 390, 1100, and
1440 pixels, with no document overflow. Desktop movement actions appear in a
stacked right column; smaller layouts retain their sequential order.

Console browser tests cover pointer and keyboard recall, multiline scripts,
inert response text, and no submission until Send. The live actions smoke test
covers Activity tab keyboard navigation and completed-command filtering.
