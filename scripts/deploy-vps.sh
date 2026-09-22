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
# The scheduler's unit files travel with the release so provision-cron.sh has
# something to install. Shipping them does not schedule anything -- enabling the
# timer stays a deliberate root action, like the migration above.
ssh "$VPS_USER@$VPS_HOST" 'install -d -m 755 /srv/ajspay/schedule'
scp scripts/ajspay-cron.service scripts/ajspay-cron.timer scripts/provision-cron.sh \
  "$VPS_USER@$VPS_HOST:/srv/ajspay/schedule/"
# The Python backend ships outside the document root: it is proxied to, never
# served as files. Its deploy assets travel with it so provisioning reads one
# copy rather than a second that can drift.
rm -rf .deploy/pyapi && cp -R pyapi .deploy/pyapi
rm -rf .deploy/pyapi/.venv .deploy/pyapi/tests/__pycache__ .deploy/pyapi/app/__pycache__
mkdir -p .deploy/pyapi/deploy
cp scripts/ajspay-pyapi.service scripts/pyapi-proxy.conf scripts/ajspay-apply-proxy .deploy/pyapi/deploy/
ssh "$VPS_USER@$VPS_HOST" 'install -d -m 755 /srv/ajspay/pyapi'
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

# Schema first, and only after the dump above: the new code expects the new
# tables, so a swap without them would answer 500 on anything that touches one.
# Running before the swap means a failed migration leaves the site on the
# release it is already serving, untouched.
if [[ -f /etc/ajspay/migrate.cnf ]]; then
  if [[ -f /srv/ajspay/migrate.sql ]]; then
    echo 'Applying migrate.sql'
    mariadb --defaults-file=/etc/ajspay/migrate.cnf ajspay < /srv/ajspay/migrate.sql
    echo 'Schema is current'
  fi
else
  echo 'ERROR: /etc/ajspay/migrate.cnf is missing, so the schema cannot be brought up to date.' >&2
  echo '       Deploying anyway would ship code that expects tables the database does not have.' >&2
  echo '       Run scripts/grant-migrate.sh as root on the VPS once, then deploy again.' >&2
  exit 1
fi

# The release carries the Python service's code but cannot install its
# dependencies: the venv is root-owned and provisioning is a deliberate root
# action. A release that adds one would restart the service into a failure the
# swap below swallows as a warning, while the proxy map is applied regardless --
# taking every already-ported route down with it. The smoke check would not
# notice, because everything it tests is served by PHP. So check here, before
# anything is swapped, and leave the site on the release it is already serving.
if systemctl list-unit-files ajspay-pyapi.service >/dev/null 2>&1 &&
   systemctl is-enabled --quiet ajspay-pyapi 2>/dev/null; then
  if ! (cd /srv/ajspay/pyapi && /srv/ajspay/pyapi-venv/bin/python -c 'import app.main') 2>/dev/null; then
    echo 'ERROR: the Python service cannot load this release with the venv it has.' >&2
    echo '       Its dependencies have changed. As root on the VPS, run:' >&2
    echo '         /srv/ajspay/pyapi-venv/bin/pip install -r /srv/ajspay/pyapi/requirements.txt' >&2
    echo '       then deploy again. Nothing has been changed.' >&2
    exit 1
  fi
fi

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
  # The proxy map in the repository is the record of which routes have moved;
  # applying it here keeps the running configuration equal to it.
  sudo -n /usr/local/sbin/ajspay-apply-proxy ||
    echo 'WARNING: could not apply the proxy map; routes are unchanged' >&2
fi
# A failed smoke check restores the prior release without touching the database.
# Everything below is a different backend from the one above it: version.txt is
# a static file, /api/auth/me is PHP, and /api/public/features is proxied to the
# Python service. Checking only the first two would call a deploy successful
# while every ported route answered 502.
if ! curl -fsS --retry 3 --retry-delay 2 https://ajspay.co.in/version.txt | grep -qx "$revision" ||
   [[ "$(curl -sS -o /dev/null -w '%{http_code}' https://ajspay.co.in/api/auth/me)" != 401 ]] ||
   [[ "$(curl -sS -o /dev/null -w '%{http_code}' https://ajspay.co.in/api/public/features)" != 200 ]]; then
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
