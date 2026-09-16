#!/usr/bin/env bash
# Dump the production database, then drop dumps older than the retention window.
# Runs on the VPS. Credentials come from /etc/ajspay/backup.cnf (root-installed,
# readable only by the deploy user) so no secret is ever passed on the command line.
set -euo pipefail

backups=/srv/ajspay/backups
retention_days=${BACKUP_RETENTION_DAYS:-14}
stamp=$(date -u +%Y%m%dT%H%M%SZ)
target="$backups/ajspay-$stamp.sql.gz"

install -d -m 700 "$backups"
umask 077
mariadb-dump --defaults-file=/etc/ajspay/backup.cnf \
  --single-transaction --quick --routines --triggers --events \
  ajspay | gzip -9 > "$target.part"

# A dump that failed midway is worse than no dump: only a complete, non-trivial
# gzip stream is promoted to a real backup filename.
gzip -t "$target.part"
[[ $(stat -c %s "$target.part") -gt 10240 ]]
mv -f "$target.part" "$target"

find "$backups" -maxdepth 1 -name 'ajspay-*.sql.gz' -mtime "+$retention_days" -delete
find "$backups" -maxdepth 1 -name '*.part' -mmin +60 -delete
echo "Backup: $target ($(du -h "$target" | cut -f1)), keeping $retention_days days"
