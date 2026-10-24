# Upgrade and roll back

Available since **0.1.0-alpha.1**. These instructions are for the published install
bundle. Existing source-build and custom host-network installations should retain
their current volume names, mounts and deployment procedure; do not accidentally
start a second empty installation. [Source builds](development.md) remain supported.

## Before every update

Choose an idle printer with heaters off and no queued commands, calibration,
unsaved result or unknown action awaiting review. Save browser drafts. Read the
release notes for migrations and compatibility limits. Keep the previous install
bundle, `.env`, image digest and a matching pre-upgrade backup. Do not let an
external updater replace the container during a print.

Make an online, consistent backup into a **new** directory. Replace the example
suffix with a unique date/time:

```sh
docker compose exec -T perilune node scripts/backup.mjs /app/backups/pre-upgrade-20261024-1200
mkdir -p backups
chmod 700 backups
docker compose cp perilune:/app/backups/pre-upgrade-20261024-1200 backups/
chmod -R go-rwx backups/pre-upgrade-20261024-1200
cp -p .env .env.before-upgrade
cp -p compose.yaml compose.before-upgrade.yaml
```

Copy the backup and private environment off the host too. The backup contains the
SQLite database and its generated auth-secret file; an externally configured
`PERILUNE_AUTH_SECRET` must be preserved separately and exactly. See
[backup details](deployment.md#backups-and-restore). Never copy only the live SQLite
file while its WAL is active.

## Upgrade

Download and verify the new release archive, `release.json` and `SHA256SUMS` as in
the install guide, into a separate staging directory. Compare the new Compose and
camera config with your current files before applying local customizations.
For an unmodified standard installation, copy the new bundle’s public files into
the installation directory. The bundle does not contain `.env` or live data.

Update **only** `PERILUNE_IMAGE` in your private `.env` to the new bundle’s exact
image digest from its `.env.example` or `release.json`. Preserve origin, secrets,
live options, `COMPOSE_FILE`, device selection, and volume identity. The version
is also available as `ghcr.io/colecrouter/perilune:VERSION`; digests avoid tag drift.
There is no automatic `latest` update policy.

```sh
docker compose pull
docker compose up -d --wait
docker compose ps
docker compose logs --tail 50 perilune
```

Check `/health`, the sidebar version, sign-in, retained history, live read-only
state and camera. Accounts remain; do not run setup again. A browser reload
updates the frontend, not the server. Keep the old image and backup until review
is complete. If startup fails, inspect logs and follow rollback rather than
repeatedly changing versions against the same database.

## Roll back with the matching backup

Older code may not understand a newer schema. Preserve the upgraded data volume;
restore the **pre-upgrade** backup into a new volume and run the matching previous
image. The restore helper refuses existing databases, secrets and WAL/SHM files.
It checks backup integrity and requires explicit maintenance mode.

Stop the current installation first:

```sh
docker compose stop perilune
```

Use the current image’s restore helper with the previous private environment.
Choose a new volume name that has not been used before:

```sh
PERILUNE_DATA_VOLUME=perilune-data-rollback-20261024 \
  docker compose run --rm --no-deps \
  --volume "$PWD/backups/pre-upgrade-20261024-1200:/restore-backup:ro" \
  --entrypoint node perilune scripts/restore.mjs /restore-backup --server-stopped
```

The current image provides the helper; no server starts in this one-off container.
If the backup uses an external secret, use the original secret for this command.
For a generated-file secret, remove any external secret override. A partial restore
failure leaves evidence in the new volume: use another empty volume after
investigating, rather than deleting or overwriting files automatically.

Restore `.env.before-upgrade` as `.env`, set `PERILUNE_DATA_VOLUME` in it to the
new rollback volume, and restore the previous Compose/camera files. The previous
image must match the backup’s source release. Start exactly one app:

```sh
docker compose up -d --wait
```

Verify login and retained history. Keep the upgraded volume intact for diagnosis;
do not point both instances at the printer. Restoring a backup also rewinds app
history and credentials to its snapshot. Do not automatically replay commands
from the restored history. Reconcile printer-side effects with the physical
printer before enabling controls.
