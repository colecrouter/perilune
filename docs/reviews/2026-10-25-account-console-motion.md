# Account and console motion polish

Unreleased: console following animates over 180ms after the initial position;
Account sections fade over 160ms, tab colors transition, and install content has
additional vertical spacing. Reduced motion disables both animations.

Two independent review rounds completed. The first requested interruption coverage
while scrolling was still underway. Those tests exposed residual drift from native
smooth scrolling; a cancellable animation frame loop now stops immediately when
reader input or the Follow latest switch interrupts it. The final review found no
actionable findings and independently reran all 12 console browser tests successfully.
It inspected cleanup, retargeting, reduced motion, URL navigation and draft scope.

Parent production QA passed four Account cases at 1440px and 390px with motion on
and reduced. It verified enhanced navigation, actual animation events, no page
errors or overflow, 20px heading separation and 16px install-button separation.
Install prompts were synthetic; no app installation or notification was requested.
Collaborative preview independently observed an Account section animation while
retaining the document. Full validation and exact-head CI remain release gates.
