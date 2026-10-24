# Install and connect Perilune

Available since **0.1.0-alpha.1**. Perilune is an early alpha; keep your existing
printer interface available during evaluation. Already have a panel address?
Open it and sign in. You do not need another installation.

## Requirements

Use a 64-bit Linux x86-64 or ARM64 host with [Docker Engine and Compose](https://docs.docker.com/engine/install/).
Docker Desktop can run the simulator on a development computer. USB device mapping
requires a Linux host. The backend must reach Moonraker; Perilune does not replace
Klipper or Moonraker. A 32-bit Raspberry Pi OS installation is not supported.

## Install a published release

Download a specific release from [GitHub Releases](https://github.com/colecrouter/perilune/releases).
The install archive includes Compose, private-setting examples, camera overrides
and a copy of the documentation. No Git checkout, Node installation or local
application build is required.

```sh
perilune_release=v0.1.0-alpha.2
curl -fLO "https://github.com/colecrouter/perilune/releases/download/$perilune_release/perilune-$perilune_release-install.tar.gz"
curl -fLO "https://github.com/colecrouter/perilune/releases/download/$perilune_release/release.json"
curl -fLO "https://github.com/colecrouter/perilune/releases/download/$perilune_release/SHA256SUMS"
sha256sum --check SHA256SUMS
# macOS: shasum -a 256 --check SHA256SUMS
tar -xzf "perilune-$perilune_release-install.tar.gz"
cd perilune
cp .env.example .env
chmod 600 .env
docker compose pull
docker compose up -d --wait
docker compose exec perilune node scripts/auth.mjs setup
```

Open <http://localhost:3000/setup> on that host. Enter the token, your name, email,
and a password of at least 12 characters. The token expires after 30 minutes.
Email is a login identifier; SMTP is optional. The first visitor cannot claim a
server without its token. Setup closes once the owner account exists. A failed/interrupted signup consumes
its token. For an account-free installation, stop the app, run
`docker compose run --rm perilune node scripts/auth.mjs setup-reset --server-stopped`,
then generate a new setup token and restart. Do not reset an installation that
already contains accounts.

The default is a shared simulator with no physical printer connection. The image
is pinned by digest in `.env`; updates are explicit. Accounts and history live in
the `perilune-data` volume; backups use `perilune-backups`. Never run
`docker compose down -v` on an installation you want to keep. Preserve `.env` and
any external secrets separately, and copy backups off the host.

The sidebar and `/health` report the running version. `release.json` records the
source commit, image digest and supported architectures.

## Connect Moonraker read-only

Edit `.env` with an address reachable **from the Perilune backend**:

```dotenv
PERILUNE_MOONRAKER_URL=ws://printer-host:7125/websocket
# Only if Moonraker requires it:
# PERILUNE_MOONRAKER_API_KEY=your-private-key
```

Use your actual host and port. A browser-facing Mainsail URL behind another login
is not necessarily a usable Moonraker API endpoint. Use `wss://` for TLS; do not
put credentials or browser-login tokens in the URL.

At an idle printer, recreate the app:

```sh
docker compose up -d --wait
```

Confirm **live** mode, ready state and plausible temperatures. Physical workflows
remain read-only until their [individual options](live-controls.md) are enabled.
Coordinate attended acceptance before motion, heating, probing or configuration
writes. Unknown outcomes require review and are never automatically replayed.

## Add a camera

For the managed camera service, add this line to `.env`, then recreate services:

```dotenv
COMPOSE_FILE=compose.yaml:compose.camera.yaml
```

```sh
docker compose up -d --wait
```

Open **Camera settings**, choose an imported printer camera, a network endpoint,
or a local USB camera, then test and save. The companion API stays private.
[Camera setup](camera-setup.md) covers Crowsnest, USB mapping, conversion and
recovery after a device reconnect. On Linux, local USB additionally uses
`compose.camera-usb.yaml` and an explicit stable device path. Keep `COMPOSE_FILE`
and the device selection in `.env` so future commands use the same services.

## Phones, internet access and slicers

The published port binds to loopback. For other devices, set up a stable HTTPS
address using the [proxy guide](deployment.md#https-proxy), then set
`PERILUNE_ORIGIN` to exactly that browser-visible origin. Do this before enrolling
passkeys. Non-loopback HTTP origins are rejected. Do not expose Moonraker or
go2rtc publicly. For installation over SSH, a localhost tunnel can provide the
initial local browser access until HTTPS is configured.

Owners invite users in **Account**. Viewers can watch; operators can use enabled
printer controls; owners also manage access. Passkeys need HTTPS or localhost.
For owner recovery, stop the app and follow [account recovery](account-email.md).

In OrcaSlicer or another compatible slicer, select **Klipper / Moonraker**, use the
Perilune HTTPS address, and paste a scoped key from **Account → Integrations**.
Prefer upload-only access unless starting prints is intended. Device-tab login
uses **Sign in with another browser** and approval from an already signed-in
browser. See [Jobs and slicers](jobs.md).

## Next steps

- [Upgrade and rollback](upgrading.md)
- [Configuration reference](configuration-options.md)
- [Features and everyday workflows](README.md)
- [Development/source installations](development.md)
