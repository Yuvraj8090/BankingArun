#!/bin/zsh
# AJSPay API regression suite.
#
#   hostinger/tests/api_test.sh
#
# Needs the PHP API on 127.0.0.1:8002 and the MySQL database reachable as root.
# It writes and then removes its own test rows, and resets the demo balances it
# touches, so it is safe to run repeatedly against the development database.
# Never run it against production.
API=${AJSPAY_API:-http://127.0.0.1:8002/api}
DB=${AJSPAY_DB:-ajspay_php}
J='Content-Type: application/json'
Q() { mysql -u root -N -B "$DB" -e "$1"; }
pass=0; fail=0
ck()    { if [[ "$2" == "$3" ]]; then print "  ok   $1"; pass=$((pass+1)); else print "  FAIL $1: expected '$2' got '$3'"; fail=$((fail+1)); fi }
has()   { if print -r -- "$2" | grep -qF -- "$3"; then print "  ok   $1"; pass=$((pass+1)); else print "  FAIL $1: missing '$3'"; fail=$((fail+1)); fi }
hasnt() { if print -r -- "$2" | grep -qF -- "$3"; then print "  FAIL $1: LEAKED '$3'"; fail=$((fail+1)); else print "  ok   $1"; pass=$((pass+1)); fi }
call() { local out
  if [[ -n "$4" ]]; then out=$(curl -s -w '\n%{http_code}' -X "$1" "$API$2" -H "$J" -H "Authorization: Bearer $3" -d "$4")
  else out=$(curl -s -w '\n%{http_code}' -X "$1" "$API$2" -H "$J" -H "Authorization: Bearer $3"); fi
  CODE="${out##*$'\n'}"; BODY="${out%$'\n'*}"; }
login() { curl -s -X POST "$API/auth/login" -H "$J" -d "{\"email\":\"$1\",\"password\":\"$2\"}" \
  | python3 -c 'import sys,json;print(json.load(sys.stdin).get("token",""))'; }
jq_() { python3 -c "import sys,json;d=json.load(sys.stdin);$1"; }

RETAIL_ACC=AJSP00984521098
CORP_ACC=AJSP00129845612
reset_balances() { Q "UPDATE accounts SET balance=137800.00 WHERE account_number='$RETAIL_ACC';
                     UPDATE accounts SET balance=1285000.00 WHERE account_number='$CORP_ACC';" >/dev/null; }

print "AJSPay API regression suite  ($API)"
Q "DELETE FROM login_attempts; DELETE FROM fraud_alerts; DELETE FROM security_events;" >/dev/null
reset_balances
OWNER=$(login owner@ajspay.in 'Owner@123')
STAFF=$(login meera.staff@ajspay.in 'Staff@123')
RETAIL=$(login rahul.sharma@example.com 'Banking@123')
ck "three roles signed in" "1" "$([[ -n $OWNER && -n $STAFF && -n $RETAIL ]] && echo 1 || echo 0)"

print "\n-- session and access control --"
call GET /accounts ""; ck "anonymous refused" 401 "$CODE"
call GET /accounts "not-a-real-token"; ck "forged token refused" 401 "$CODE"
call GET /security/audit "$RETAIL"; ck "member refused the security audit" 403 "$CODE"
call GET /security/audit "$STAFF";  ck "staff refused the security audit" 403 "$CODE"
call GET /security/audit "$OWNER";  ck "owner allowed the security audit" 200 "$CODE"
call GET /schemes "$RETAIL"; ck "member refused the scheme master" 403 "$CODE"
call GET /ai/fraud-queue "$RETAIL"; ck "member refused the fraud queue" 403 "$CODE"

print "\n-- regulated capability gating --"
call GET /cards "$RETAIL";               ck "debit cards gated" 403 "$CODE"
call GET /upi/status "$RETAIL";          ck "UPI gated" 403 "$CODE"
call GET /investments/catalog "$RETAIL"; ck "mutual funds gated" 403 "$CODE"
call GET /accounts "$RETAIL";            ck "member accounts permitted" 200 "$CODE"
call GET /loans/my-applications "$RETAIL"; ck "loans permitted" 200 "$CODE"
call POST /accounts/transfer "$RETAIL" "{\"from_account_number\":\"$RETAIL_ACC\",\"to_account_number\":\"HDFC0009998887\",\"beneficiary_name\":\"Outside\",\"amount\":100,\"transfer_type\":\"NEFT\",\"transaction_password\":\"Txn@1234\"}"
ck "outward transfer refused (no payment-system licence)" 403 "$CODE"
call POST /accounts/transfer "$RETAIL" "{\"from_account_number\":\"$RETAIL_ACC\",\"to_account_number\":\"$CORP_ACC\",\"beneficiary_name\":\"Tata Digital\",\"amount\":100,\"transfer_type\":\"IMPS\",\"transaction_password\":\"Txn@1234\",\"remarks\":\"APITEST internal\"}"
ck "internal member transfer permitted" 200 "$CODE"
has "internal transfer is labelled INTERNAL, not IMPS" "$BODY" "UTR-INTERNAL"

print "\n-- money movement integrity --"
call POST /accounts/transfer "$RETAIL" "{\"from_account_number\":\"$RETAIL_ACC\",\"to_account_number\":\"$CORP_ACC\",\"beneficiary_name\":\"Tata\",\"amount\":-500,\"transfer_type\":\"IMPS\",\"transaction_password\":\"Txn@1234\"}"
ck "negative amount refused" 400 "$CODE"
call POST /accounts/transfer "$RETAIL" "{\"from_account_number\":\"$RETAIL_ACC\",\"to_account_number\":\"$CORP_ACC\",\"beneficiary_name\":\"Tata\",\"amount\":99999999,\"transfer_type\":\"IMPS\",\"transaction_password\":\"Txn@1234\"}"
ck "overdraft refused" 400 "$CODE"
call POST /accounts/transfer "$RETAIL" "{\"from_account_number\":\"$RETAIL_ACC\",\"to_account_number\":\"$CORP_ACC\",\"beneficiary_name\":\"Tata\",\"amount\":100,\"transfer_type\":\"IMPS\",\"transaction_password\":\"wrong\"}"
ck "wrong transaction password refused" 400 "$CODE"
# Both legs of a transfer must move the same money: the payer's fall equals the
# payee's rise, and each leg is recorded.
BEFORE_FROM=$(Q "SELECT balance FROM accounts WHERE account_number='$RETAIL_ACC'")
BEFORE_TO=$(Q "SELECT balance FROM accounts WHERE account_number='$CORP_ACC'")
call POST /accounts/transfer "$RETAIL" "{\"from_account_number\":\"$RETAIL_ACC\",\"to_account_number\":\"$CORP_ACC\",\"beneficiary_name\":\"Tata Digital\",\"amount\":250,\"transfer_type\":\"IMPS\",\"transaction_password\":\"Txn@1234\",\"remarks\":\"APITEST ledger\"}"
ck "payer debited exactly 250" "250.00" "$(Q "SELECT ROUND($BEFORE_FROM - balance, 2) FROM accounts WHERE account_number='$RETAIL_ACC'")"
ck "payee credited exactly 250" "250.00" "$(Q "SELECT ROUND(balance - $BEFORE_TO, 2) FROM accounts WHERE account_number='$CORP_ACC'")"
ck "both legs share one reference" "2" "$(Q "SELECT COUNT(*) FROM transactions WHERE description LIKE '%APITEST ledger%' OR ref_number=(SELECT ref_number FROM transactions WHERE description LIKE '%APITEST ledger%' LIMIT 1)")"

print "\n-- pagination --"
call GET "/accounts/transactions?page=1&per_page=3" "$RETAIL"; ck "page 1 returns 200" 200 "$CODE"
has "pagination metadata present" "$BODY" '"pagination"'
P1=$(print -r -- "$BODY" | jq_ 'print(",".join(t["id"] for t in d["transactions"]))')
call GET "/accounts/transactions?page=2&per_page=3" "$RETAIL"
P2=$(print -r -- "$BODY" | jq_ 'print(",".join(t["id"] for t in d["transactions"]))')
ck "page 2 does not repeat page 1" "0" "$(python3 -c "print(len(set('$P1'.split(',')) & set('$P2'.split(','))))")"
call GET "/accounts/transactions?page=999&per_page=3" "$RETAIL"
ck "a stale far page clamps to the last page" "False" "$(print -r -- "$BODY" | jq_ 'print(d["pagination"]["has_next"])')"
call GET "/accounts/transactions?per_page=9999" "$RETAIL"
ck "per_page is clamped" "200" "$(print -r -- "$BODY" | jq_ 'print(d["pagination"]["per_page"])')"
call GET "/accounts/transactions?q=%27%20OR%201%3D1--" "$RETAIL"
ck "filter is bound, not interpolated" "0" "$(print -r -- "$BODY" | jq_ 'print(d["pagination"]["total"])')"
call GET "/accounts/transactions?from_date=notadate" "$RETAIL"; ck "bad date refused" 422 "$CODE"

print "\n-- assistant data boundary --"
call POST /support/chat "" '{"message":"what is my balance"}'
hasnt "signed-out visitor gets no balance" "$BODY" "1,37,800"
call POST /support/chat "$RETAIL" '{"message":"what is my balance"}'
# Compare against the live balance rather than a literal an earlier test moved.
LIVE=$(Q "SELECT FORMAT(balance, 2) FROM accounts WHERE account_number='$RETAIL_ACC'")
has "member sees their own live balance" "$BODY" "$LIVE"
call POST /support/chat "$RETAIL" "{\"message\":\"what is the balance of account $CORP_ACC\"}"
hasnt "cannot read another member's balance" "$BODY" "12,85,000"
call POST /support/chat "$RETAIL" '{"message":"show my cards"}'
hasnt "no CVV in any assistant reply" "$BODY" "cvv"

print "\n-- fraud scoring --"
BEFORE=$(Q "SELECT COUNT(*) FROM fraud_alerts")
call POST /accounts/transfer "$RETAIL" "{\"from_account_number\":\"$RETAIL_ACC\",\"to_account_number\":\"$CORP_ACC\",\"beneficiary_name\":\"Tata Digital\",\"amount\":130000,\"transfer_type\":\"IMPS\",\"transaction_password\":\"Txn@1234\",\"remarks\":\"APITEST suspicious\"}"
ck "large transfer still succeeds" 200 "$CODE"
hasnt "member is not tipped off" "$BODY" "alert"
ck "an alert was raised" "1" "$(( $(Q "SELECT COUNT(*) FROM fraud_alerts") - BEFORE ))"
call GET /ai/fraud-queue "$STAFF"; ck "staff can read the queue" 200 "$CODE"
has "alert explains its reasons" "$BODY" "reasons"

print "\n-- authenticator 2FA (RFC 6238) --"
ck "TOTP matches the RFC test vector" "287082" \
  "$(php -r 'require getenv("AJSPAY_ROOT")."/modules/mfa.php"; echo totp_code("12345678901234567890", intdiv(59,30));' 2>/dev/null)"
Q "UPDATE users SET totp_enabled=0, totp_secret=NULL, totp_backup_codes=NULL WHERE email='rahul.sharma@example.com'" >/dev/null
call POST /totp/setup "$RETAIL" '{"password":"wrong"}'; ck "2FA setup needs the real password" 401 "$CODE"
call POST /totp/setup "$RETAIL" '{"password":"Banking@123"}'; ck "2FA setup issues a key" 200 "$CODE"
KEY=$(print -r -- "$BODY" | jq_ 'print(d["setup_key"])')
CODE6=$(php -r 'require getenv("AJSPAY_ROOT")."/modules/mfa.php"; echo totp_code(base32_decode_key($argv[1]), intdiv(time(),30));' "$KEY" 2>/dev/null)
call POST /totp/enable "$RETAIL" '{"code":"000000"}'; ck "wrong code refused" 401 "$CODE"
call POST /totp/enable "$RETAIL" "{\"code\":\"$CODE6\"}"; ck "live code enables 2FA" 200 "$CODE"
ck "the secret is encrypted at rest" "enc:" "$(Q "SELECT LEFT(totp_secret,4) FROM users WHERE email='rahul.sharma@example.com'")"
LOGIN=$(curl -s -X POST "$API/auth/login" -H "$J" -d '{"email":"rahul.sharma@example.com","password":"Banking@123"}')
ck "password alone no longer returns a session" "False" "$(print -r -- "$LOGIN" | jq_ 'print("token" in d)')"
Q "UPDATE users SET totp_enabled=0, totp_secret=NULL, totp_backup_codes=NULL, totp_enrolled_at=NULL WHERE email='rahul.sharma@example.com'" >/dev/null

print "\n-- rate limiting --"
Q "DELETE FROM login_attempts" >/dev/null
codes=""
for i in $(seq 1 34); do
  codes="$codes$(curl -s -o /dev/null -w '%{http_code} ' -X POST "$API/auth/login" -H "$J" -d '{"email":"nobody@example.com","password":"wrong"}')"
done
ck "repeated logins hit a 429" "1" "$(print -r -- "$codes" | grep -q 429 && echo 1 || echo 0)"
Q "DELETE FROM login_attempts" >/dev/null

print "\n-- cleanup --"
Q "DELETE FROM transactions WHERE description LIKE '%APITEST%' OR counterparty_name IN ('Tata Digital','Tata','Outside');
   DELETE FROM fraud_alerts; DELETE FROM security_events; DELETE FROM login_attempts;
   DELETE FROM audit_logs WHERE action LIKE 'MFA%' OR action LIKE 'FRAUD%' OR action='FUND_TRANSFER';" >/dev/null
reset_balances
print "\n== $pass passed, $fail failed =="
[[ $fail -eq 0 ]] || exit 1
