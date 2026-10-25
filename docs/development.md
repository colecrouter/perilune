# Development and source installations

Requires Node.js 24.13+ and pnpm 12.11.2. Use the local Vite+ commands through pnpm.

```sh
git clone https://github.com/colecrouter/perilune.git
cd perilune
pnpm install
pnpm dev
```

Open <http://localhost:4181>. The default is a simulator; no printer is controlled.
In another terminal in the checkout, run `node scripts/auth.mjs setup` to generate
an owner enrollment token. Development reads exported process environment, not
Compose’s `.env` file. Never share its database with an existing production app.

```sh
pnpm build
PERILUNE_ORIGIN=http://localhost:3000 pnpm start
```

For a source-built container, use `cp .env.example .env` and
`docker compose up -d --build`. This retains the source Compose volume convention;
it does not switch to the published install bundle’s volumes. Stop the server,
back up data and secrets, fetch the intended tag, run `pnpm install --frozen-lockfile`
and build before restarting. A custom deployment should preserve its existing
paths, private environment and rollback procedure.

[Contribution guidelines](../CONTRIBUTING.md) describe validation, independent
review, docs, privacy and attended printer testing. [Architecture](architecture.md)
records implemented behavior and outstanding milestones.

## Layout state fixtures

The owner-only `/dev/layout-states` page on `pnpm dev` exercises synthetic loading,
pending, success, error and reconnect states. It sends no physical/configuration
commands and is unavailable in production. See [layout conventions](layout-stability.md)
for the shared components and desktop/phone measurement checks.

The preferences ORM pilot uses the existing Effect SQLite client and migrator.
See [persistence.md](persistence.md) before adding another migrated store; native
transaction context and authentication reservations are part of its contract.

### Push sender patch (unreleased)

`web-push-browser@1.4.2` is pinned and patched through pnpm, including production
installs. The patch adds HTTPS/mailto VAPID subject passthrough, AbortSignal and
manual redirects, and fixes the 4096-byte AES128GCM record-size field to network byte
order. Remove individual hunks only after an upstream release contains equivalent
behavior and the transport regressions pass. No Node package internals are imported
through unsupported export paths. The adapter keeps the existing raw VAPID private
scalar rather than adopting the library's PKCS8 serialization.

Run `pnpm exec vp test run src/lib/server/push-transport.test.ts
src/lib/server/notification-service.test.ts` for protocol/ownership coverage. The
wire decoder uses Node crypto independently of the replacement's encryption code;
see [RFC 8188](https://www.rfc-editor.org/rfc/rfc8188.html) and
[RFC 8291](https://www.rfc-editor.org/rfc/rfc8291.html). Use synthetic subscriptions
only in automation; real-device notification acceptance remains separate.
