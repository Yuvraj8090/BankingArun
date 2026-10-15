#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
: "${VPS_HOST:?}" "${VPS_USER:?}"
revision=$(git rev-parse HEAD)
[[ "$revision" =~ ^[0-9a-f]{40}$ ]]
scp .deploy/release.tar.gz "$VPS_USER@$VPS_HOST:/srv/ajspay/incoming/$revision.tar.gz"
scp scripts/backup-db.sh "$VPS_USER@$VPS_HOST:/srv/ajspay/backup-db.sh"
# The release package deliberately carries no .sql files — they have no business
# inside a web root — so the migration is delivered beside it instead. The
# remote deployment applies it after the backup and before the release swap.
scp hostinger/migrate.sql "$VPS_USER@$VPS_HOST:/srv/ajspay/migrate.sql"
# The scheduler's unit files travel with the release so provision-cron.sh has
# something to install. Shipping them does not schedule anything -- enabling the
# timer stays a deliberate root action.
#
# They land beside migrate.sql rather than in a directory of their own: the
# deploy account can write files into /srv/ajspay but cannot create directories
# there, and the mkdir that seemed harmless killed the deploy before the release
# was even unpacked.
scp scripts/ajspay-cron.service scripts/ajspay-cron.timer scripts/provision-cron.sh \
  "$VPS_USER@$VPS_HOST:/srv/ajspay/"
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

# The site switch (site-switch.php) writes this file as www-data, which owns
# nothing here, so it is created world-writable once and kept across releases.
[[ -e /srv/ajspay/site-down ]] || install -m 666 /dev/null /srv/ajspay/site-down

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
  # systemctl returns as soon as the unit is activated, not when uvicorn has
  # bound its port, and Apache proxies with retry=0 -- so the smoke check below
  # was racing a service that had not finished starting and getting a 503. Wait
  # for the port itself, which is the only thing that actually answers.
  for _ in $(seq 1 30); do
    (exec 3<>/dev/tcp/127.0.0.1/8081) 2>/dev/null && { exec 3>&- 3<&-; break; }
    sleep 1
  done
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
# Each assertion reports what it actually saw. Rolling back with nothing but
# "smoke check failed" is how three deploys in a row got diagnosed by guesswork:
# the evidence dies with the release, because the rollback below puts the
# working one back before anybody can look.
smoke_failed=""
served=$(curl -fsS --retry 3 --retry-delay 2 https://ajspay.co.in/version.txt 2>&1 | head -c 80 || true)
[[ "$served" == "$revision" ]] ||
  smoke_failed="$smoke_failed"$'\n'"  version.txt served '$served', expected '$revision'"
# A site that is switched off must answer 503 on both, and anything else
# means the switch did not take.
php_want=401 py_want=200
[[ ! -s /srv/ajspay/site-down ]] || php_want=503 py_want=503
for probe in "/api/auth/me $php_want PHP" "/api/public/features $py_want Python"; do
  read -r path want backend <<<"$probe"
  for attempt in $(seq 1 10); do
    got=$(curl -sS -o /tmp/smoke.body -w '%{http_code}' "https://ajspay.co.in$path" || echo 000)
    [[ "$got" == "$want" ]] && break
    sleep 2
  done
  [[ "$got" == "$want" ]] ||
    smoke_failed="$smoke_failed"$'\n'"  $path ($backend) answered $got after 10 tries, expected $want: $(head -c 160 /tmp/smoke.body | tr '\n' ' ')"
done
if [[ -n "$smoke_failed" ]]; then
  echo "Deployment smoke check failed:$smoke_failed" >&2
  # The deploy account cannot read the journal -- it is not in adm or
  # systemd-journal and its sudo grants cover three commands, none of them
  # journalctl -- so asking for the log just printed "No entries" and looked
  # like the service had said nothing. Report what it can actually see.
  if systemctl is-enabled --quiet ajspay-pyapi 2>/dev/null; then
    echo "  Python service is $(systemctl is-active ajspay-pyapi 2>&1), port 8081 $(
      (exec 3<>/dev/tcp/127.0.0.1/8081) 2>/dev/null && echo 'accepting' || echo 'not accepting')" >&2
    echo '  For its log, as root on the VPS: journalctl -u ajspay-pyapi -n 50' >&2
  fi
  if [[ -n "$previous" ]]; then
    ln -s "$previous" current.rollback
    mv -Tf current.rollback current
    sudo -n /usr/bin/systemctl reload php8.5-fpm || true
    sudo -n /usr/bin/systemctl restart ajspay-pyapi 2>/dev/null || true
    echo "Rolled back to $previous" >&2
  fi
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
