#!/usr/bin/env bash
# Install the daily scheduled-money-movement timer. Run as root ON THE VPS.
# Safe to re-run.
#
# Until this existed nothing on the box ran cron.php at all: the file carried
# instructions for Hostinger's shared-hosting cron panel, which this VPS does
# not have. Monthly deposit interest, maturities and standing instructions were
# all implemented, tested, and never once executed in production.
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Run as root" >&2; exit 1; }
# Deployed beside migrate.sql; also works when run from a git checkout.
here=$(cd "$(dirname "$0")" && pwd)

install -m 644 "$here/ajspay-cron.service" /etc/systemd/system/ajspay-cron.service
install -m 644 "$here/ajspay-cron.timer"   /etc/systemd/system/ajspay-cron.timer
systemctl daemon-reload
systemctl enable --now ajspay-cron.timer

echo
echo "Timer installed. Next run:"
systemctl list-timers ajspay-cron.timer --no-pager
echo
echo "Check what it WOULD do right now, without moving any money:"
echo "  sudo -u www-data /usr/bin/php /srv/ajspay/current/cron.php --dry-run"
echo "Then watch a real run with:"
echo "  systemctl start ajspay-cron.service && journalctl -u ajspay-cron -n 40 --no-pager"
