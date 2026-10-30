#!/bin/sh
set -eu
umask 077
BACKUP_DIR="${BACKUP_DIR:-./backups}"
mkdir -p "$BACKUP_DIR"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
failure() { printf '%s\n' 'BACKUP FAILED: inspect local monitoring and disk space' >&2; exit 1; }
trap failure HUP INT TERM
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$BACKUP_DIR/$stamp.dump" || failure
docker compose exec -T backend tar czf - -C /app/data media private > "$BACKUP_DIR/$stamp-media.tar.gz" || failure
sha256sum "$BACKUP_DIR/$stamp.dump" "$BACKUP_DIR/$stamp-media.tar.gz" > "$BACKUP_DIR/$stamp.sha256" || failure
find "$BACKUP_DIR" -maxdepth 1 -type f -name '*.dump' -mtime +14 -delete
find "$BACKUP_DIR" -maxdepth 1 -type f -name '*-media.tar.gz' -mtime +14 -delete
find "$BACKUP_DIR" -maxdepth 1 -type f -name '*.sha256' -mtime +14 -delete
printf 'Backup complete: %s\n' "$stamp"
