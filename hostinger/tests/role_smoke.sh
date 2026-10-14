#!/bin/zsh
# AJSPay: every role against every read endpoint.
#
#   hostinger/tests/role_smoke.sh
#
# Signs in as each of the seven demo roles and calls every GET route the API
# exposes, plus every report the role is allowed to run. A 5xx anywhere fails,
# and so does a role the menu shows a page to but the API refuses (the page
# would open blank). Read-only: it changes nothing but sessions and captchas.
# Needs the PHP API on 127.0.0.1:8002 and the database reachable as root.
API=${AJSPAY_API:-http://127.0.0.1:8002/api}
DB=${AJSPAY_DB:-ajspay_php}
ROOT=${AJSPAY_ROOT:-${0:A:h:h}}
J='Content-Type: application/json'
Q() { mysql -u root -N -B "$DB" -e "$1"; }
CAP_HASH=$(php -r '$c=require "'"$ROOT"'/config.local.php"; echo hash_hmac("sha256","00000",$c["token_secret"]);')
cap() { local id=$(curl -s "$API/public/captcha" | python3 -c 'import sys,json;print(json.load(sys.stdin)["captcha_id"])')
  Q "UPDATE captcha_challenges SET code_hash='$CAP_HASH' WHERE id='$id'" >/dev/null; print -r -- "\"captcha_id\":\"$id\",\"captcha_answer\":\"00000\""; }
login() { local portal=member; [[ $1 == *@ajspay.in ]] && portal=staff
  curl -s -X POST "$API/auth/login" -H "$J" -d "{$(cap),\"portal\":\"$portal\",\"email\":\"$1\",\"password\":\"$2\"}" \
  | python3 -c 'import sys,json;print(json.load(sys.stdin).get("token",""))'; }
code() { curl -s -o /dev/null -w '%{http_code}' "$API$1" -H "Authorization: Bearer $2"; }
pass=0; fail=0
ok()  { pass=$((pass+1)); }
bad() { print "  FAIL $1"; fail=$((fail+1)); }

# Every GET route with no path parameter, read from the router itself.
ROUTES=(${(f)"$(grep -oE "^\s*'GET /[^']+'" "$ROOT/api.php" | tr -d " '" | sed 's/^GET//' | grep -v '^/public/captcha$')"})

# Endpoint each menu tab needs to render, per role (from frontend/src/navigation.js).
typeset -A PAGE_API=(
  dashboard /accounts  transfer /accounts  deposits /accounts  loans /loans/my-applications
  standing-instructions /standing-instructions  referrals /referrals/my-code  my-standing /my-standing
  statements /accounts  security /passkey/list  kyc /kyc/documents  branches /branches/locator
  admin /admin/overview  crm /crm/members  member-register /register/members  screening /screening/hits
  data-requests /privacy/queue  grievance /grievance/queue  reports /reports  staff /panel/staff
  loan-dept /panel/loan-dept  collection /panel/collection  agents /agents  schemes /schemes
  video-kyc-queue /kyc/video/queue  owner /panel/bank-owner  security-center /security/audit
  support-view /impersonate/candidates  fraud /ai/fraud-queue  branch-admin /branches
  public-pages /products  member-ranks /member-ranks  rails /rails/config  admin-config /admin/config
  parameters /parameters  book-deposit /public/schemes  video-kyc /kyc/documents
)
NAV=$(node -e '
  const src = require("fs").readFileSync(process.argv[1], "utf8");
  const nav = eval("(" + src.slice(src.indexOf("{", src.indexOf("NAV_BY_ROLE")), src.indexOf("};", src.indexOf("NAV_BY_ROLE")) + 1)
    .replace(/icon: \w+,/g, "") + ")");
  for (const [role, items] of Object.entries(nav)) console.log(role + " " + items.filter(i => !i.requires).map(i => i.id).join(" "));
' "$ROOT/../frontend/src/navigation.js")

# email password role
USERS=(
  rahul.sharma@example.com Banking@123 retail
  tata.corp@example.com Corporate@123 corporate
  meera.staff@ajspay.in Staff@123 staff
  manager@ajspay.in Admin@123 admin
  owner@ajspay.in Owner@123 bank_owner
  loans@ajspay.in Loan@123 loan_officer
  collections@ajspay.in Collect@123 collection_agent
)
Q "DELETE FROM login_attempts" >/dev/null
print "AJSPay role smoke test  ($API, ${#ROUTES} GET routes)"
for email pw role in $USERS; do
  T=$(login $email $pw)
  if [[ -z $T ]]; then bad "$role could not sign in"; continue; fi
  print "\n-- $role --"
  for r in $ROUTES; do
    c=$(code $r $T)
    if [[ $c == 5* ]]; then bad "$role GET $r -> $c"; else ok; fi
  done
  # Each menu page's backing call must not be refused for the role that sees it.
  for tab in ${=${${(f)NAV}[(r)$role *]#$role }}; do
    api=${PAGE_API[$tab]}
    [[ -z $api ]] && { bad "$role menu tab '$tab' has no smoke mapping"; continue; }
    c=$(code $api $T)
    if [[ $c == 2* ]]; then ok; else bad "$role sees '$tab' but GET $api -> $c"; fi
  done
  # Every report this role is offered must actually run.
  for id in ${(f)"$(curl -s "$API/reports" -H "Authorization: Bearer $T" \
      | python3 -c 'import sys,json
d=json.load(sys.stdin); d=d.get("reports",d) if isinstance(d,dict) else d
print("\n".join(r["id"] for r in d if isinstance(r,dict) and "id" in r))' 2>/dev/null)"}; do
    c=$(code /reports/$id $T)
    if [[ $c == 2* ]]; then ok; else bad "$role report $id -> $c"; fi
  done
done
Q "DELETE FROM login_attempts" >/dev/null
print "\n== $pass passed, $fail failed =="
[[ $fail -eq 0 ]] || exit 1
