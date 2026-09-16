#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
: "${VPS_HOST:?}" "${VPS_USER:?}"
revision=$(git rev-parse HEAD)
[[ "$revision" =~ ^[0-9a-f]{40}$ ]]
scp .deploy/release.tar.gz "$VPS_USER@$VPS_HOST:/srv/ajspay/incoming/$revision.tar.gz"
scp scripts/backup-db.sh "$VPS_USER@$VPS_HOST:/srv/ajspay/backup-db.sh"
ssh "$VPS_USER@$VPS_HOST" bash -s -- "$revision" <<'REMOTE'
set -euo pipefail
revision=$1
[[ "$revision" =~ ^[0-9a-f]{40}$ ]]
cd /srv/ajspay
exec 9>deploy.lock
flock -w 120 9
release="/srv/ajspay/releases/$revision"
if [[ ! -d "$release" ]]; then
  mkdir "$release"
  tar -xzf "incoming/$revision.tar.gz" -C "$release" --no-same-owner
  # Belt and braces against an archive built with a restrictive mode:
  # directories must be traversable and files readable by Apache.
  chmod -R a+rX "$release"
  ln -s /etc/ajspay/config.local.php "$release/config.local.php"
fi
test -f "$release/index.html"
test -f "$release/api.php"
test "$(cat "$release/version.txt")" = "$revision"

# Back up the database before the swap, so any rollback has a matching dump to
# restore from. A failed backup stops the deploy rather than shipping blind.
chmod +x /srv/ajspay/backup-db.sh
/srv/ajspay/backup-db.sh

previous=$(readlink current || true)
ln -s "$release" current.next
mv -Tf current.next current
# A failed smoke check restores the prior release without touching the database.
if ! curl -fsS --retry 3 --retry-delay 2 https://ajspay.co.in/version.txt | grep -qx "$revision" ||
   [[ "$(curl -sS -o /dev/null -w '%{http_code}' https://ajspay.co.in/api/auth/me)" != 401 ]]; then
  if [[ -n "$previous" ]]; then
    ln -s "$previous" current.rollback
    mv -Tf current.rollback current
  fi
  echo 'Deployment smoke check failed' >&2
  exit 1
fi
rm "incoming/$revision.tar.gz"

# Keep the five most recent releases so a rollback target always exists; the
# live one is never a candidate for deletion.
live=$(readlink -f current)
ls -1dt /srv/ajspay/releases/* | tail -n +6 | while read -r old; do
  [[ "$(readlink -f "$old")" == "$live" ]] || rm -rf "$old"
done
echo "Deployed $revision"
REMOTE
