#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
: "${VPS_HOST:?}" "${VPS_USER:?}"
revision=$(git rev-parse HEAD)
[[ "$revision" =~ ^[0-9a-f]{40}$ ]]
scp .deploy/release.tar.gz "$VPS_USER@$VPS_HOST:/srv/ajspay/incoming/$revision.tar.gz"
scp scripts/backup-db.sh "$VPS_USER@$VPS_HOST:/srv/ajspay/backup-db.sh"
# The release package deliberately carries no .sql files — they have no business
# inside a web root — so the migration is delivered beside it instead, ready to
# run by hand. Applying it is never automatic: a schema change lands when
# someone decides it should, not as a side effect of shipping a frontend.
scp hostinger/migrate.sql "$VPS_USER@$VPS_HOST:/srv/ajspay/migrate.sql"
# The Python backend ships outside the document root: it is proxied to, never
# served as files. Its deploy assets travel with it so provisioning reads one
# copy rather than a second that can drift.
rm -rf .deploy/pyapi && cp -R pyapi .deploy/pyapi
rm -rf .deploy/pyapi/.venv .deploy/pyapi/tests/__pycache__ .deploy/pyapi/app/__pycache__
mkdir -p .deploy/pyapi/deploy
cp scripts/ajspay-pyapi.service scripts/pyapi-proxy.conf .deploy/pyapi/deploy/
scp -r .deploy/pyapi/. "$VPS_USER@$VPS_HOST:/srv/ajspay/pyapi/"
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
# The swapped-in PHP is only actually running once OPcache lets go of the
# previous release's bytecode, so this must happen before the smoke check. A
# reload that is not permitted is worth shouting about, but aborting here would
# strand the deploy between the swap and its own rollback, so it only warns.
sudo -n /usr/bin/systemctl reload php8.5-fpm ||
  echo 'WARNING: could not reload php-fpm; PHP changes in this release are not live yet' >&2
# Restart the Python service only if it is installed; the port is incremental,
# so a box that has not been provisioned for it must deploy exactly as before.
if systemctl list-unit-files ajspay-pyapi.service >/dev/null 2>&1 &&
   systemctl is-enabled --quiet ajspay-pyapi 2>/dev/null; then
  sudo -n /usr/bin/systemctl restart ajspay-pyapi ||
    echo 'WARNING: could not restart the Python service; it is serving the previous code' >&2
fi
# A failed smoke check restores the prior release without touching the database.
if ! curl -fsS --retry 3 --retry-delay 2 https://ajspay.co.in/version.txt | grep -qx "$revision" ||
   [[ "$(curl -sS -o /dev/null -w '%{http_code}' https://ajspay.co.in/api/auth/me)" != 401 ]]; then
  if [[ -n "$previous" ]]; then
    ln -s "$previous" current.rollback
    mv -Tf current.rollback current
    sudo -n /usr/bin/systemctl reload php8.5-fpm || true
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
