# Basic printer actions

Basic controls render with the server-observed printer state. Live browser updates
start separately; a page waiting for its first subscription does not report the
printer as disconnected. If live updates cannot connect within ten seconds, or an
established stream drops, affected controls explain their unavailable state.
Charts, camera playback and temperature history are independent of form submission.

Heater targets, cooldown, Home All, pause and resume have ordinary HTML POST forms.
With JavaScript they submit in place with pending state and a receipt link. Without
JavaScript they redirect to an account-bound receipt; refreshing that receipt
never repeats the action. A static page does not update by itself: reload it to
observe later state. Start/stop links lead to a server-rendered review when
JavaScript is not available; hydrated dialogs retain their existing interaction.

A receipt means that the backend accepted the request, not necessarily that the
printer finished executing it. Inspect queued/sending/completed/failed/unknown
status. A submission whose acknowledgement is lost is not automatically resent;
its form remains locked with a link to check the original request ID. A missing
receipt is not proof that a delayed request cannot arrive.

Authorization and readiness are checked by the backend, including at execution.
Forms carry request IDs and job identity rather than silently substituting the
currently active print. Cancel review explicitly chooses whether each heater
cools down. Inputs edited before hydration or during a pending heater request
are preserved.

Live physical execution of these basic actions is still disabled. This milestone
establishes the shared submission adapter and progressive forms; physical-operation
coordination and printer testing are tracked in #10.

Failure notice dismissal (unreleased): closing a failure notice acknowledges the
currently displayed failures for this browser tab and account, including across
full page navigation and reloads. New failures still appear. Activity retains the
original receipts; dismissal does not clear recovery locks or change printer
state. If browser tab storage is unavailable, dismissal lasts until the document
is replaced.
