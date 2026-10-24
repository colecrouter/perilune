# Basic printer actions

> Release status: alpha.2 changes are **unreleased until** the matching
> `v0.1.0-alpha.2` release is published. Use the alpha.1 guides for alpha.1 installs.

Available since **0.1.0-alpha.1**. This guide describes **0.1.0-alpha.2**.

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

Live physical execution is available behind `PERILUNE_LIVE_CONTROLS=true`; it is
read-only by default. Motion, heaters and print actions use process-owned
coordination, execution-time checks and unknown-outcome recovery. Enable and
accept those actions only with the printer owner; see [live controls](live-controls.md).

Failure notices (added in **0.1.0-alpha.2**): failed receipts remain in Activity as history.
Successful mesh save, discard, or verified reconciliation resolves earlier failure
alerts belonging to that same mesh workflow. A different workflow's failures
remain visible. Only failures belonging to the signed-in account appear as alerts.

Closing an alert acknowledges its displayed receipts on the server for that
account, across reloads, tabs and devices. The alert remains visible if the
acknowledgement fails. The server omits resolved or acknowledged alerts from the
initial page; there is no browser-storage dismissal after rendering. New failures
still appear. Acknowledgement never clears a workflow lock or changes printer
state.
