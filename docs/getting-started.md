# Install, connect, and update Perilune

## If you already have a panel address

Open the existing Perilune address and sign in. You do not need a second local
installation to use it from another computer, phone, or slicer. Ask the person
hosting that installation to update its server. Reloading a browser only updates
the browser, not the server.

Use **Account → Integrations** for slicer credentials and paired browsers. Open
**Help** in the panel for printing, filament changes, phone setup, and notifications.

## New installation with Docker Compose

Run the backend on a computer/server that can reach the printer’s Moonraker API.
The printer itself does not need another installation. Keep Mainsail available
while testing. Install Git and a running Docker engine with Compose first.

```sh
git clone https://github.com/colecrouter/perilune.git
cd perilune
cp .env.example .env
docker compose up -d --build
docker compose exec perilune node scripts/auth.mjs setup
```

Open <http://localhost:3000/setup> on that computer and enter the one-time token,
your name, email, and a password of at least 12 characters. Email is a login
identifier; no email service is required. The token expires after 30 minutes.

The default is a shared simulator. Nothing is connected to a physical printer.
The Compose volume stores accounts, history, and a private signing-secret file.
Keep the volume when updating; `docker compose down -v` deletes it.

## Connect Moonraker read-only

Edit the private `.env` file created above:

```dotenv
PERILUNE_MOONRAKER_URL=ws://printer-host:7125/websocket
# Only when required by Moonraker:
# PERILUNE_MOONRAKER_API_KEY=your-private-key
```

Replace `printer-host` with an address reachable from the backend. Port 7125 is
Moonraker’s usual direct port; your installation may use another port or a private
proxy. Use `wss://` for a TLS endpoint. A public Mainsail page protected by another
login is not automatically a usable backend Moonraker connection. The URL must
not contain passwords, query parameters, or a browser login token.

Apply the settings:

```sh
docker compose up -d
```

Open the panel and confirm it shows live state rather than simulator state, a
connected/ready printer, and plausible temperatures. Live workflows stay read-only
until their individual options are enabled. Coordinate an attended, idle-printer
check before enabling [physical controls](live-controls.md), [mesh probing](calibration.md),
or [configuration writes](configuration.md).

For cameras, configure a backend-reachable go2rtc API base and registered stream
as described in the [README camera guide](../README.md#camera-gateway).

## Access from phones and slicers

The default Compose port binds to the server’s loopback address. For access from
other devices, configure a stable HTTPS address and a reverse proxy following the
[deployment guide](deployment.md). Set `PERILUNE_ORIGIN` to exactly that browser-visible
origin before account/passkey setup. Non-loopback plain HTTP origins are rejected.
Do not publish Moonraker or camera services directly to the internet.

In a compatible slicer, select **Klipper / Moonraker**, use the Perilune HTTPS
address, and paste a key from **Account → Integrations**. Choose Upload files access
unless you intend to allow starting prints. Device-tab login is separate: choose
**Sign in with another browser**, enter its code at `/pair` in your normal signed-in
browser, and approve. See [Jobs and slicers](jobs.md).

## Updating

These commands apply to the standard checkout/Compose installation above. A custom
image deployment should use its existing release procedure instead of creating a
second instance.

1. Save drafts. Choose an idle time for the service restart.
2. Make a consistent database and signing-secret backup into a new directory:

   ```sh
   docker compose exec perilune node scripts/backup.mjs /app/data/backup-before-update-YYYYMMDD-HHMM
   ```

   Replace the suffix with a unique date/time. Copy the backup off the host as well;
   the local data volume alone does not protect against disk loss. Preserve the private
   `.env` separately. If using an external `PERILUNE_AUTH_SECRET`, preserve that exact
   secret too. See [backups and restore](deployment.md#backups-and-restore).

3. Update and recreate the service, retaining its volume and settings:

   ```sh
   git pull --ff-only
   docker compose up -d --build
   docker compose ps
   ```

4. Wait for the service to become healthy, then open your normal panel address.
   Existing accounts remain. Do not run setup again. Save edits before choosing
   **Reload to update**; **Later** leaves them intact.

Keep the previous image and pre-update backup for rollback. Older code may not
understand a migrated database; restore its matching snapshot rather than starting
old code against new data.

## Run directly with Node

Requires Node 24.13+ and pnpm 12.11.2. From the checkout:

```sh
pnpm install
pnpm build
PERILUNE_ORIGIN=http://localhost:3000 pnpm start
```

In another terminal in the same directory, run `node scripts/auth.mjs setup`, then
open <http://localhost:3000/setup>. Use the same database and origin environment for
both commands if you override them. Run exactly one process per database.

Node and `pnpm dev` read exported process environment variables, not `.env` files.
For a read-only local development connection, stop any existing process using the
same database first, then run:

```sh
PERILUNE_ORIGIN=http://localhost:4181 \
PERILUNE_MOONRAKER_URL=ws://printer-host:7125/websocket \
pnpm dev
```

Open <http://localhost:4181>. This is a development process, not an always-on service.
For a direct-Node update, stop the service, back up the database and its authoritative
secret, pull the source, run `pnpm install` and `pnpm build`, then restart with the
same private environment. Use your process manager for an always-on deployment.
