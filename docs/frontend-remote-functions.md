# Frontend remote functions

The migration convention is to load application data through server-awaited SvelteKit remote queries; mutations
use validated remote commands and explicitly refresh affected views. Browser-only
capability checks (passkeys, notification permission, installation) still happen
in the browser. Neither initial queries nor refreshed summaries contain one-time
slicer keys or invitation links; those are returned only by explicit commands.

## Account and integrations

- `getAccess`: recovery status, owner account/invitation summaries.
- `getIntegrations`: the signed-in user's slicer key summaries, paired browser
  summaries and installation origin. Viewers receive no slicer keys.
- Invitation creation/revocation, account revocation, recovery verification mail
  and test mail use commands with server-side role checks.
- Slicer key creation/revocation, integration disconnect and paired-browser
  revocation use validated commands. Key creation returns its secret once.
- Integrations and pairing approval await initial summaries during SSR. Mounting
  only enables interactions; it does not initiate their data loading.
- Views retain field drafts through explicit query refreshes and show mutation
  pending/error states. Commands keep existing service authorization, account
  scoping and request/session-abort handling.

Compatibility REST endpoints remain available and tested. Pairing redemption still
uses its existing cookie-writing endpoint, including its fixed-expiry/race
protection. Public enrollment/recovery, notification/browser integration, camera
setup mutations, configuration operations and Jobs operations are subsequent
migration slices tracked in #128.

## Transport boundaries

The migration does not replace camera video/snapshot transfers, static reference
asset loading, service-worker push-image fetches, upload progress transport or the
authentication SDK with JSON remote functions. Each has transport/browser-lifetime
requirements separate from ordinary application data. Public slicer-compatible
endpoints likewise remain explicit protocol adapters.

The initial audit at `80ccd34` found 21 frontend fetch call sites in 16 files:
18 application API helpers, two camera media calls and one static reference fetch.
A helper can serve several endpoint operations; this is not an endpoint count.
The account/integrations slice removes four call sites: the integrations helper,
pairing's key-list fetch and both Account action helpers. Remaining helpers are
tracked rather than removed merely to reduce a numerical count.
