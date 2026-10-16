# Daily-use deployment

Run one production Node process per installation/database. Build an immutable image from reviewed source, preserve the previous image for rollback, and keep private environment files and data outside the checkout. The default Compose service publishes only loopback and persists data in a volume. `deploy/compose.host.yaml` is an optional Linux host-network variant for a local reverse proxy: copy it to an installation directory beside `private.env`, `data/`, and `backups/`, owned by the image's node user (UID 1000), then set an immutable `PERILUNE_IMAGE` tag. Its application listener remains loopback-only.

Set the stable HTTPS `PERILUNE_ORIGIN` before enrollment or passkeys. Set private backend Moonraker/camera URLs and only the live feature flags you intend to enable. Do not expose Moonraker or go2rtc directly to the internet. Keep Mainsail available through a separate route during initial acceptance. Cloudflare Access is optional; a second interactive login layer can prevent native slicer uploads unless separately configured.

## HTTPS proxy

Terminate TLS at the existing trusted edge. Pass Host, use HTTP/1.1 upstream, disable proxy buffering and caching, allow at least 21 MiB request bodies, and use a long read timeout for live queries and camera streams. For nginx, the application location needs:

```nginx
location / {
    proxy_pass http://127.0.0.1:4182;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
    client_max_body_size 21m;
}
```

Perilune derives authorization origins from its configured origin, rather than trusting client forwarding headers. Behind a proxy, authentication rate limits currently share that proxy's socket address. Test HTTPS login, media and a live stream through the actual public route; localhost health alone does not verify edge behavior.

## Backups and restore

While the app runs, use `node scripts/backup.mjs /private/backups/new-directory` with the same database/secret environment as the server. In Docker, run it with `docker exec` into the application container and a mounted backup directory. Each destination must be new. The helper uses SQLite's online backup API, checks integrity, and writes private permissions. It captures WAL-committed data without copying live database sidecars.

The snapshot includes the generated adjacent auth-secret when that is authoritative. If `PERILUNE_AUTH_SECRET` is configured, the manifest records `external`; preserve that exact deployment secret separately. A stale adjacent file is not substituted. VAPID keys, accounts, actions and recovery snapshots are inside SQLite. Camera source credentials and backend connection settings remain in your private deployment environment/configuration and need their own protected backup.

Schedule daily backups with a systemd timer or your existing scheduler, keep a retention window, and copy backups off the host. A backup on the same disk only protects against application mistakes. Do not tar a running SQLite file as the only backup.

To restore: stop Perilune, preserve the current installation, copy the snapshot database and its authoritative secret into an empty data directory, restore private environment settings, set ownership/permissions, and start exactly one process. Never overlay an old database while its WAL/SHM files are active. First verify an isolated restore in simulator mode: login with the restored account, inspect persisted history/recovery and keys, and confirm no printer connection is configured. Do not run a restored copy against the real printer alongside the primary instance.

For application rollback, keep the image and database snapshot together. An older image may not understand a newer database schema. Restore testing, public routing and physical-device installation remain explicit acceptance tasks rather than consequences of a successful image build.
