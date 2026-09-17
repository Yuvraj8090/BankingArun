#!/usr/bin/env bash
# One-time root setup for the Python backend. Safe to re-run. Run as root ON THE VPS.
# It does not move any route across on its own: the service starts, Apache gains
# the proxy include, and traffic only shifts for paths listed in pyapi-proxy.conf.
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Run as root" >&2; exit 1; }

id -u ajspay-api >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin ajspay-api

apt-get update -qq
apt-get install -y -qq python3-venv python3-dev >/dev/null

install -d -m 755 -o ajspay-deploy -g ajspay-deploy /srv/ajspay/pyapi
[[ -d /srv/ajspay/pyapi-venv ]] || python3 -m venv /srv/ajspay/pyapi-venv
/srv/ajspay/pyapi-venv/bin/pip install -q --upgrade pip
[[ -f /srv/ajspay/pyapi/requirements.txt ]] &&
  /srv/ajspay/pyapi-venv/bin/pip install -q -r /srv/ajspay/pyapi/requirements.txt

# Both backends must read one source of truth for the token secret, or a session
# minted by one is rejected by the other. PHP is the only thing that can parse a
# PHP array reliably, so PHP is what exports it.
php -r '$c = require "/etc/ajspay/config.local.php"; echo json_encode($c);' > /etc/ajspay/config.json
chown root:ajspay-api /etc/ajspay/config.json
chmod 640 /etc/ajspay/config.json
# The directory is 751, so ajspay-api can traverse to the file it owns without
# the directory being listable — the same arrangement the backup account has.
chmod 751 /etc/ajspay

install -m 644 /srv/ajspay/pyapi/deploy/ajspay-pyapi.service /etc/systemd/system/ajspay-pyapi.service
systemctl daemon-reload
# One more single-command grant, matching the php-fpm one: the deploy account
# may restart this service and nothing else.
printf 'ajspay-deploy ALL=(root) NOPASSWD: /usr/bin/systemctl restart ajspay-pyapi\n' > /etc/sudoers.d/ajspay-deploy-pyapi
chmod 440 /etc/sudoers.d/ajspay-deploy-pyapi
visudo -c -q -f /etc/sudoers.d/ajspay-deploy-pyapi
systemctl enable --now ajspay-pyapi
sleep 2
systemctl is-active --quiet ajspay-pyapi || { journalctl -u ajspay-pyapi -n 20 --no-pager; exit 1; }

# Health check on loopback before Apache is told about the service at all.
curl -fsS --max-time 5 http://127.0.0.1:8081/api/_py/health

a2enmod -q proxy proxy_http
install -m 644 /srv/ajspay/pyapi/deploy/pyapi-proxy.conf /etc/apache2/conf-available/ajspay-pyapi.conf

# The include is referenced from the vhost rather than enabled globally, so the
# proxy applies to this site only.
if ! grep -q 'ajspay-pyapi.conf' /etc/apache2/sites-available/ajspay-ssl.conf; then
  sed -i 's|^    DocumentRoot /srv/ajspay/current|    DocumentRoot /srv/ajspay/current\n\n    # Routes ported to the Python backend; everything else reaches api.php.\n    Include /etc/apache2/conf-available/ajspay-pyapi.conf|' \
    /etc/apache2/sites-available/ajspay-ssl.conf
fi
apache2ctl configtest
systemctl reload apache2

echo "Python backend up. Proxied routes:"
grep -oP '^ProxyPass \K/\S+' /etc/apache2/conf-available/ajspay-pyapi.conf || echo "  (none yet)"
