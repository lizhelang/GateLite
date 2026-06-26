# GateLite Backup And Restore

GateLite stores durable runtime data in files and mounted directories:

- `GATELITE_STATE_FILE`
- rollback snapshots next to the state file
- `GATELITE_DYNAMIC_FILE`
- `GATELITE_CERT_DIR`

## Backup

Run:

```bash
npm run backup
```

By default this writes `output/backups/gatelite-backup-<timestamp>.tar.gz`.
Override the destination:

```bash
npm run backup -- --out-dir /safe/backups/gatelite
```

The archive includes a `manifest.json` with the original paths and archived
contents.

Certificate backups include files currently present under `GATELITE_CERT_DIR`.
If an admin later deletes a GateLite-managed certificate and chooses file
cleanup, those PEM files are removed from the live certificate directory but
remain recoverable from backups taken before the cleanup.

## Restore

Restore is intentionally explicit because it overwrites runtime files:

```bash
npm run restore -- /safe/backups/gatelite-backup-2026-06-26T00-00-00-000Z.tar.gz --force
```

Use `--replace` to remove existing rollback and certificate directories before
copying the backup content:

```bash
npm run restore -- /safe/backups/gatelite-backup.tar.gz --force --replace
```

After restore, restart the GateLite container or process so it reloads state and
rewrites the Traefik dynamic file.

## Release Rule

Take a backup before every production deployment. If a deployment changes route
or certificate behavior, verify restore on a non-production copy before calling
the release safe.
