#!/usr/bin/env bash
# Asks both backends the same authenticated question and reports whether the
# answers match. Run on the VPS.
#
# The password is typed here and used here. It is sent to the PHP login to get a
# session, and never leaves this machine — nothing is echoed, stored, or written
# to a file, and the shell is asked not to keep it in history.
set -uo pipefail
route=${1:-/api/auth/me}

read -rp "Member email: " email
read -rsp "Password: " password; echo

jar=$(mktemp); trap 'rm -f "$jar" /tmp/cmp.php.json /tmp/cmp.py.json' EXIT

code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 -c "$jar" \
  -X POST https://ajspay.co.in/api/auth/login \
  -H 'Content-Type: application/json' \
  -d "$(python3 -c '
import json,sys
print(json.dumps({"email": sys.argv[1], "password": sys.argv[2]}))' "$email" "$password")")
unset password

if [[ "$code" != "200" ]]; then
  echo "Login failed (HTTP $code). Nothing was compared."
  exit 1
fi
token=$(python3 - "$jar" <<'PY'
import sys
for line in open(sys.argv[1]):
    if 'access_token' in line:
        print(line.rsplit('\t', 1)[-1].strip())
        break
PY
)
[[ -n "$token" ]] || { echo "No session cookie came back."; exit 1; }

# The same token to both: one through Apache, one straight to the service.
curl -fsS --max-time 10 -H "Authorization: Bearer $token" "https://ajspay.co.in$route"      > /tmp/cmp.php.json 2>/dev/null
curl -fsS --max-time 10 -H "Authorization: Bearer $token" "http://127.0.0.1:8081$route"     > /tmp/cmp.py.json  2>/dev/null

echo
echo "route: $route"
echo "  php:    $(wc -c < /tmp/cmp.php.json) bytes"
echo "  python: $(wc -c < /tmp/cmp.py.json) bytes"
if cmp -s /tmp/cmp.php.json /tmp/cmp.py.json; then
  echo "  BYTE-IDENTICAL"
else
  echo "  DIFFERS at:"
  cmp -l /tmp/cmp.php.json /tmp/cmp.py.json 2>/dev/null | head -3 | while read -r pos _ _; do
    start=$(( pos > 50 ? pos - 50 : 1 ))
    echo "    php: ...$(cut -c${start}-$((pos+30)) /tmp/cmp.php.json)"
    echo "    py : ...$(cut -c${start}-$((pos+30)) /tmp/cmp.py.json)"
  done
fi
