# Account entry and verified email recovery review

Independent reviewer: `review_account_recovery`. Approved after resolving the
SMTP lifecycle finding. Inactivity timeouts alone were insufficient; sends now
own their actual sockets, enforce an absolute 20-second deadline and destroy
connections on deadline/shutdown. Delayed getSocket calls cannot reopen a send.
Unknown outcomes are not retried; metadata checkpoint retries perform no SMTP.
The reviewer independently ran ten targeted lifecycle/recovery tests successfully.

Other reviewed contracts include browser/security epoch separation, atomic token
redemption, delayed sign-in/pairing rejection, emergency recovery isolation,
existing unverified addresses, recipient-bound invitations, encrypted outbox,
CLI migrations and auth endpoint access. No remaining blocking findings.

An optional browser race finding was also addressed: responses for an earlier
reset request cannot clear a newer fragment token. Dedicated browser tests cover
that case and the no-SMTP guidance; another regression test holds pairing session
creation across reset.

Native T3 collaborative browser QA used only a temporary SMTP/simulator fixture.
Login and recovery pages rendered their expected titles/content without framework
overlays or relevant console errors. Desktop entry and 390px recovery/account
layouts remained readable without horizontal overflow. The Forgot password link
navigated correctly, and account test-email submission produced queued feedback.
The local SMTP headless suite separately verifies SMTP acceptance/status, explicit
address verification, reset/sign-out/sign-in, emailed invitation enrollment,
used-link guidance, generic responses, same-origin protection and mobile layout.
No live mail provider, private media or physical printer was used.

The final status-history check caught a missing account parameter in the delivery
read. It is fixed, with service isolation coverage and a headless assertion that
waits for the durable SMTP receipt before refreshing and checking the displayed
acceptance state.
