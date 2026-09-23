#!/usr/bin/env bash
# Install the daily scheduled-money-movement timer. Run as root ON THE VPS.
# Safe to re-run.
#
# A timer may already be installed. One was -- put there out of band and running
# nightly since 17 September 2026 -- and it was found only after this script had
# been written on the assumption that nothing scheduled cron.php at all. So this
# refuses to replace an existing unit unless told to, and shows you what is
# there first. Overwriting a schedule that is working, to fix a problem that
# turned out not to exist, is the worse outcome of the two.
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Run as root" >&2; exit 1; }
# Deployed beside migrate.sql; also works when run from a git checkout.
here=$(cd "$(dirname "$0")" && pwd)

unit=/etc/systemd/system/ajspay-cron.service
timer=/etc/systemd/system/ajspay-cron.timer

if [[ -e "$unit" || -e "$timer" ]] && [[ "${1:-}" != "--replace" ]]; then
  echo "A cron unit is already installed on this machine." >&2
  echo >&2
  for f in "$unit" "$timer"; do
    [[ -e "$f" ]] || continue
    echo "--- $f ---" >&2
    diff -u "$f" "$here/$(basename "$f")" >&2 && echo "  (identical to this repository's copy)" >&2
    echo >&2
  done
  echo "It has been running:" >&2
  systemctl list-timers ajspay-cron.timer --no-pager >&2 || true
  echo >&2
  echo "Check which cron.php it actually runs before replacing it -- a unit" >&2
  echo "pointing at an old path keeps working while serving stale code:" >&2
  echo "  systemctl cat ajspay-cron.service | grep ExecStart" >&2
  echo >&2
  echo "To replace it with this repository's version, re-run with --replace." >&2
  echo "The existing files are backed up alongside them." >&2
  exit 1
fi

for f in "$unit" "$timer"; do
  [[ -e "$f" ]] && cp -a "$f" "$f.replaced-$(date -u +%Y%m%dT%H%M%SZ)"
done
install -m 644 "$here/ajspay-cron.service" "$unit"
install -m 644 "$here/ajspay-cron.timer"   "$timer"
systemctl daemon-reload
systemctl enable --now ajspay-cron.timer

echo
echo "Verifying it can actually run before trusting the schedule:"
if systemctl start ajspay-cron.service; then
  systemctl --no-pager -n 12 status ajspay-cron.service || true
else
  echo "ERROR: the unit failed on its first run. The previous files are beside" >&2
  echo "       the new ones with a .replaced- suffix. journalctl -u ajspay-cron -n 30" >&2
  exit 1
fi
echo
echo "Timer installed. Next run:"
systemctl list-timers ajspay-cron.timer --no-pager
echo
echo "Check what it WOULD do right now, without moving any money:"
echo "  sudo -u www-data /usr/bin/php /srv/ajspay/current/cron.php --dry-run"
echo "Then watch a real run with:"
echo "  systemctl start ajspay-cron.service && journalctl -u ajspay-cron -n 40 --no-pager"
