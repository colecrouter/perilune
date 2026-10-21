# Frontend remote functions

Application reads use server-awaited SvelteKit remote queries; mutations use
validated remote commands and explicitly refresh affected views. Initial private
application data does not load from `onMount`. Browser capability and subscription
checks still run in the browser because the server cannot inspect browser APIs.

## Implemented scope

- Account access summaries, invitations, revocations, recovery verification and
  test mail use Account queries/commands.
- Integrations and pairing approval await slicer/paired-browser summaries during
  SSR. Key creation returns its secret only from the explicit command.
- Public enrollment, invitation inspection and recovery use bounded commands.
  Fragment tokens remain browser-only and are never query/SSR inputs.
- Browser pairing uses commands, including cookie-writing redemption. Public
  entry points retain rate limiting, origin checks and fixed session expiry.
  Late pairing poll responses cannot redirect a disposed component.
- Notifications use a query for the public subscription key and commands for
  subscription status/settings/test delivery. Looking up this device's existing
  subscription necessarily follows the browser's PushManager lookup.
- Display preferences use commands. Document links wait for queued saves;
  configuration's explicit client links preserve drafts and custom confirmation
  handlers retain control. Failed saves remain retryable; unloading with unsaved
  preferences receives the browser's standard warning.
- Configuration source/backup reads, saves, application/recovery/pending review
  and snapshot exports use owner-only queries/commands backed by the existing
  process-scoped services. Initial recovery and requested pending review await
  server results; later refreshes retain UI drafts and confirmation state.
- Camera setup uses queries/commands; captures return binary data from a command.
- The bundled Klipper reference uses a remote `prerender` function.
- Jobs removal uses a command; existing server-rendered library/inspection and
  process-owned printer queries remain in place.

The request hook bounds remote wire bodies before parsing. Application schemas
and service validators enforce payload limits and role/account/session boundaries.
Configuration IDs, expiry, bounded queuing and unknown-outcome semantics stay in
services. One-time credentials and invitation links never enter query results.

Superseded internal Account/access/pairing/preferences/configuration/camera setup
routes and Jobs key/list/inspect/remove adapters were deleted. Tests exercise the
production remote protocol and assert removed internal endpoints return 404.

## Intentional transport boundaries

The only handwritten frontend `fetch` calls left are:

1. Fragmented MP4 camera playback, consumed incrementally by MediaSource with
   bounded buffering and cancellation.
2. Private push-notification image retrieval in the service worker, whose lifetime
   is independent of a page and its remote-query context.

URL-addressable camera streams, snapshot-only images, setup-preview images, job
thumbnails and notification images retain media endpoints for native browser
consumers. Snapshot downloads themselves use the capture command. Upload progress
retains XMLHttpRequest and its bounded upload endpoint. Better Auth's SDK retains
its authentication protocol. Public slicer endpoints retain their external
contracts. These routes are active transports, not compatibility copies of migrated
application operations.

The audit at `80ccd34` counted 21 frontend fetch sites (18 API helpers, two camera
media calls and one static reference request), plus the worker image fetch. All
application/static/snapshot-download sites are migrated; one frontend video fetch
and the independent worker fetch remain.
