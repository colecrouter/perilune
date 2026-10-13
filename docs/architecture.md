# Architecture and decisions

## First development slice

SvelteKit 3 and Vite+ serve a simulator-backed dashboard. A process-scoped Effect
ManagedRuntime owns a single PrinterService, its worker, temperature ticker, and
SQLite connection. Browser connections never own these resources.

`query.live` adapts the service's SubscriptionRef changes into a streaming query.
Each client receives a complete snapshot with a monotonic revision. A new stream
receives current state immediately. Per-stream iterators close when the request,
server shutdown, or HMR generation ends. `sveltekit-effect` owns finite request
execution only; its documented lifecycle does not cover streaming iteration.

The Node entrypoint configures private adapter origin headers and overwrites them
for every request. PERILUNE_ORIGIN optionally sets the canonical browser origin
at runtime. Otherwise local HTTP derives the host from the request. Forwarded
headers supplied by clients are not trusted. TLS/HTTP2/HTTP3 belong at the edge.

## Actions

- Commands are validated with Effect Schema and assigned client-generated UUIDs.
- SQLite durably records payload, status, and creation time before acceptance.
- Reusing the same UUID and payload returns the existing action; conflicting reuse fails.
- One worker serializes simulated execution and validates current printer state.
- Disconnected actions remain queued for at most 30 seconds. The queue is bounded to 20.
- Loss of connection during sending marks the outcome unknown, without replay.
- A restart marks both queued and sending records unknown. Automatic durable queue
  recovery is deliberately not implemented in this first simulator slice.
- A simulated completion is immediate state application. Real Moonraker commands
  will need separate acknowledgement and physical completion semantics.

The simulator begins with a fixed example print. Temperatures approach targets;
print progress is fixed. Reset restores the example and preserves action history.
This is an application-service simulator, not yet a Moonraker JSON-RPC simulator.

## Browser and interface

Safari 16.4+, Chrome 110+, Firefox 115+ are provisional transpilation/polyfill
targets. Actual Safari 16.4 device verification remains outstanding. Capability
checks will govern media, push, and installation. Native browser tests currently
use headless Chromium.

The UI keeps editable drafts independent of incoming printer state. It separates
server transport health from simulated Moonraker connectivity. Pause/stop controls
are disabled when connectivity is insufficient; temperature actions can queue
while the simulated printer is disconnected. Stop offers independent bed/nozzle
cooldown choices. Bits UI supplies the dialog and typography toggle primitives.

The camera is an explicit empty state; no media gateway is shipped yet. Proposed
processing order is passthrough, remux, then shared on-demand native transcoding.

## Dependencies

The legacy plugin 0.1.0 needs a tracked patch for Kit 3's Environment API. It avoids
rewriting during SSR and uses the client environment's resolved output directory.
Upstream PR: https://github.com/colecrouter/vite-plugin-sveltekit-legacy/pull/1
Remove the patch after adopting the fixed release. Production smoke tests verify
hydration and that the stable polyfill URL is served without immutable caching.

Oxfmt handles supported files; Prettier with its Svelte plugin handles `.svelte`
files. Tabs are the default. Effect's language service is enabled in TypeScript
and patched during prepare so its diagnostics also appear in checks.

## Next milestones

1. Protocol-level Moonraker simulator and persistent read-only WebSocket adapter.
2. Real command policies, reconciliation, cancellation macro behavior, priority stop.
3. Camera gateway and source-change propagation.
4. Built-in authentication and validated external identity.
5. File/slicer workflows, calibration, and explained configuration editing.
6. Installability, configurable push notifications, and layout preferences.

Authentication is not implemented. Compose binds only to loopback by default.
Remote development instances must stay behind existing authentication. No real
printer commands, migrations, configuration writes, heating, or motion are performed
by this version.
