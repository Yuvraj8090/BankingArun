#!/usr/bin/env bash
# Checks that must pass before a release reaches the VPS. Each one exists because
# the corresponding mistake has been made in this repository at least once.
set -uo pipefail
cd "$(dirname "$0")/.."
fail=0
note() { printf '%-42s %s\n' "$1" "$2"; }
bad() { note "$1" "FAIL — $2"; fail=1; }
ok() { note "$1" "ok"; }

# 1. Every PHP file parses. A syntax error here is a 500 on every request.
# Only a real parse failure counts: this used to treat any output at all as an
# error, so a deprecation notice from whichever PHP the runner happens to carry
# would fail the build for something that is not a fault in the code.
if ! command -v php >/dev/null 2>&1; then
  bad "php syntax" "php is not on PATH, so nothing was linted"
else
  errors=$(find hostinger -name '*.php' ! -name config.local.php ! -name config.rails.php -print0 \
    | xargs -0 -n1 php -l 2>&1 | grep -E '^(Parse|Fatal) error' || true)
  [[ -z "$errors" ]] && ok "php syntax" || bad "php syntax" "$errors"
fi

# 2. No secret may be committed. backend/.env was tracked for months, carrying a
# live Twilio token. The test is the content, not the filename: frontend/.env
# holds only REACT_APP_* values, which CRA compiles into the public bundle
# anyway and which are therefore public by construction.
leaked=""
for f in $(git ls-files | grep -E '(^|/)\.env($|\.)|config\.local\.php$' | grep -v '\.example$'); do
  if grep -qE '^[A-Z_]*(SECRET|TOKEN|PASSWORD|API_KEY|AUTH)[A-Z_]*=.+' "$f" 2>/dev/null; then
    leaked="$leaked $f"
  fi
done
[[ -z "$leaked" ]] && ok "no secrets tracked" || bad "no secrets tracked" "secret-shaped values in:$leaked" 

# 3. Queries must be parameterised. Catches a value interpolated into SQL.
if grep -rnE '(query|prepare|exec)\s*\(\s*"[^"]*\$(_GET|_POST|_REQUEST|d\[)' hostinger --include='*.php' -q; then
  bad "no interpolated SQL" "request data is being formatted into a query"
else ok "no interpolated SQL"; fi

# 4. Debug output must not survive into a release.
if grep -rnE '\b(var_dump|print_r)\s*\(' hostinger --include='*.php' -q; then
  bad "no debug output" "var_dump or print_r left in"
else ok "no debug output"; fi

# 5. Errors must never be displayed to a visitor.
if grep -q "ini_set('display_errors', '0')" hostinger/db.php; then ok "errors not displayed"
else bad "errors not displayed" "display_errors is not forced off in db.php"; fi

# 6. An icon painted dark on a dark panel is invisible; this has shipped three
# times. The first check only covered the hover case, so the static one went
# straight past it: the Refer & Earn hero and the face of every debit card were
# carrying near-black text on a dark blue ground.
#
# text-slate-900/85 is the signature. Nobody writes a dark colour with an
# opacity suffix on a light background -- it is always a text-white/85 that was
# converted by a sweep, and the surface underneath it is dark.
contrast=""
grep -rnE 'hover:bg-\[#0b3b8c\][^"]*hover:text-(slate-900|slate-800|black)' frontend/src --include='*.js' -q \
  && contrast="$contrast dark-text-on-dark-hover-fill"
faded=$(grep -rnE 'text-(slate-900|slate-800|black)/[0-9]+' frontend/src --include='*.js' | head -3)
[[ -n "$faded" ]] && contrast="$contrast $(echo "$faded" | cut -d: -f1-2 | tr '\n' ' ')"
[[ -z "$contrast" ]] && ok "hover contrast" || bad "hover contrast" "dark text on a dark surface:$contrast"

# 7. Dependencies with known high-severity advisories.
if [[ -d frontend/node_modules ]]; then
  audit=$( (cd frontend && npm audit --audit-level=high --json 2>/dev/null) \
    | python3 -c 'import sys,json;d=json.load(sys.stdin);v=d.get("metadata",{}).get("vulnerabilities",{});print(v.get("high",0)+v.get("critical",0))' 2>/dev/null | tr -dc '0-9')
  audit=${audit:-0}
  if [[ "$audit" -eq 0 ]]; then ok "npm audit (high+)"; else bad "npm audit (high+)" "$audit high or critical advisories"; fi
else
  note "npm audit (high+)" "skipped — no node_modules"
fi

# 8. A status file that claims something is missing after it was built is worse
# than no status file: it sends the reader looking for work already done. This
# caught a row still saying there was no password reset flow weeks after there
# was one.
stale=""
while IFS='|' read -r claim fn; do
  if grep -q "$claim" SECURITY.md 2>/dev/null && grep -rq "$fn" hostinger 2>/dev/null; then
    stale="$stale $claim"
  fi
done <<'CLAIMS'
No reset flow exists at all|route_reset_password
no device list|route_sessions_list
No complexity rule, no breached-password check|password_is_breached
No XML is parsed anywhere|simplexml_load_string
CLAIMS
[[ -z "$stale" ]] && ok "SECURITY.md not stale" || bad "SECURITY.md not stale" "claims something missing that is built:$stale"

# 9. Scheduled money movement must have something that actually runs it.
# cron.php spent its whole life pointing at a cron panel the VPS does not have,
# so monthly interest and maturities were implemented and never executed. If the
# timer or its installer goes missing again, that must fail a deploy rather than
# be discovered by a member asking where their payout is.
missing_schedule=""
for f in scripts/ajspay-cron.service scripts/ajspay-cron.timer scripts/provision-cron.sh; do
  [[ -f "$f" ]] || missing_schedule="$missing_schedule $f"
done
grep -q 'ajspay-cron' scripts/deploy-vps.sh || missing_schedule="$missing_schedule deploy-vps.sh-does-not-ship-it"
[[ -z "$missing_schedule" ]] && ok "cron has a scheduler" \
  || bad "cron has a scheduler" "cron.php would never run:$missing_schedule"

# 10. The seed data must not be left syntactically broken.
# A commit that dropped the cvv column rewrote the cards seed into "(Issuer Only),
# (), ..." and nobody noticed for months: production was already installed, so
# only a fresh build would have hit it, and nothing built fresh. Everything after
# line 546 of schema.sql -- half the tables -- silently never ran.
empty_tuples=$(grep -nE '^\s*\(\s*\),?\s*$' hostinger/schema.sql hostinger/migrate.sql 2>/dev/null | head -3)
[[ -z "$empty_tuples" ]] && ok "seed rows intact" \
  || bad "seed rows intact" "empty VALUES tuple, seed data was mangled: $(echo "$empty_tuples" | tr '\n' ' ')"

# 11. The disclosure contact must not silently expire.
if [[ -f frontend/public/.well-known/security.txt ]]; then
  exp=$(grep -i '^Expires:' frontend/public/.well-known/security.txt | head -1 | cut -d' ' -f2)
  if python3 -c "
import datetime,sys
e=datetime.datetime.fromisoformat('$exp'.replace('Z','+00:00'))
sys.exit(0 if e > datetime.datetime.now(datetime.timezone.utc) else 1)" 2>/dev/null; then
    ok "security.txt not expired"
  else bad "security.txt not expired" "Expires is in the past ($exp)"; fi
else bad "security.txt present" "missing"; fi

echo
[[ $fail -eq 0 ]] && echo "All security checks passed." || echo "Security checks FAILED."
exit $fail
