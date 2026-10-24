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
