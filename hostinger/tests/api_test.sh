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
# Leave the database exactly as it was found. The suite deletes and rewrites rows
# across many tables (the whole member register, CRM, screening...), so snapshot
# it first and restore it on any exit, including a failure or Ctrl-C half way.
SNAP=$(mktemp "${TMPDIR:-/tmp}/ajspay_api_test.XXXXXX")
mysqldump -u root --single-transaction "$DB" > "$SNAP" || { print "could not snapshot $DB"; exit 1; }
trap 'mysql -u root "$DB" < "$SNAP"; rm -f "$SNAP"' EXIT
CFG_BACKUP=$(Q "SELECT TO_BASE64(data) FROM system_config WHERE id='global'")
pass=0; fail=0
ck()    { if [[ "$2" == "$3" ]]; then print "  ok   $1"; pass=$((pass+1)); else print "  FAIL $1: expected '$2' got '$3'"; fail=$((fail+1)); fi }
has()   { if print -r -- "$2" | grep -qF -- "$3"; then print "  ok   $1"; pass=$((pass+1)); else print "  FAIL $1: missing '$3'"; fail=$((fail+1)); fi }
hasnt() { if print -r -- "$2" | grep -qF -- "$3"; then print "  FAIL $1: LEAKED '$3'"; fail=$((fail+1)); else print "  ok   $1"; pass=$((pass+1)); fi }
call() { local out
  if [[ -n "$4" ]]; then out=$(curl -s -w '\n%{http_code}' -X "$1" "$API$2" -H "$J" -H "Authorization: Bearer $3" -d "$4")
  else out=$(curl -s -w '\n%{http_code}' -X "$1" "$API$2" -H "$J" -H "Authorization: Bearer $3"); fi
  CODE="${out##*$'\n'}"; BODY="${out%$'\n'*}"; }
# Login needs a captcha: take a real challenge, then pin its answer to 00000 using the local secret.
export AJSPAY_ROOT=${AJSPAY_ROOT:-${0:A:h:h}}
CAP_HASH=$(php -r '$c=require getenv("AJSPAY_ROOT")."/config.local.php"; echo hash_hmac("sha256","00000",$c["token_secret"]);')
cap() { local id=$(curl -s "$API/public/captcha" | python3 -c 'import sys,json;print(json.load(sys.stdin)["captcha_id"])')
  Q "UPDATE captcha_challenges SET code_hash='$CAP_HASH' WHERE id='$id'" >/dev/null; print -r -- "\"captcha_id\":\"$id\",\"captcha_answer\":\"00000\""; }
# Staff and directors sign in through the staff door (portal=staff); members through the member one.
login() { local portal=member; [[ $1 == *@ajspay.in ]] && portal=staff
  curl -s -X POST "$API/auth/login" -H "$J" -d "{$(cap),\"portal\":\"$portal\",\"email\":\"$1\",\"password\":\"$2\"}" \
  | python3 -c 'import sys,json;print(json.load(sys.stdin).get("token",""))'; }
jq_() { python3 -c "import sys,json;d=json.load(sys.stdin);$1"; }

RETAIL_ACC=AJSP00984521098
CORP_ACC=AJSP00129845612
DOC_PDF=$(python3 -c 'import base64; print("data:application/pdf;base64," + base64.b64encode(b"%PDF-1.4\n" + b"0"*600).decode())')
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

print "\n-- grievance escalation --"
# A grievance is a support ticket the member is not satisfied with, handed to the
# named officer with its own 30-day clock.
Q "DELETE FROM ticket_messages; DELETE FROM support_tickets WHERE subject LIKE 'APITESTG%';" >/dev/null
call POST /support/complaint "$RETAIL" '{"category":"deposit","subject":"APITESTG instalment not credited","description":"My March instalment is missing from the passbook."}'
GRIEV=$(print -r -- "$BODY" | jq_ 'print(d["ticket_id"])')
ck "member raised the ticket to escalate" 200 "$CODE"
call GET /grievance/queue "$RETAIL"; ck "member cannot open the grievance queue" 403 "$CODE"
call GET /grievance/queue "$STAFF";  ck "teller cannot open the grievance queue" 403 "$CODE"
call GET /grievance/queue "$OWNER";  ck "the officer can open the queue" 200 "$CODE"
call POST "/tickets/$GRIEV/escalate" "$RETAIL" '{"ground":"delay","detail":"No answer in three weeks."}'
ck "member can escalate their own ticket" 200 "$CODE"
ck "a 30-day grievance deadline is set" "1" "$(Q "SELECT grievance_due_by IS NOT NULL FROM support_tickets WHERE ticket_id='$GRIEV'")"
call POST "/tickets/$GRIEV/escalate" "$RETAIL" '{"ground":"delay","detail":"Still nothing at all."}'
ck "the same complaint cannot be escalated twice" 400 "$CODE"
call POST "/grievance/$GRIEV/resolve" "$OWNER" '{"outcome":"rejected","decision":"short"}'
ck "a decision without a reason is refused" 422 "$CODE"
call POST "/grievance/$GRIEV/resolve" "$STAFF" '{"outcome":"resolved","decision":"Credited on 4 March, passbook attached."}'
ck "a teller cannot decide a grievance" 403 "$CODE"
call POST "/grievance/$GRIEV/resolve" "$OWNER" '{"outcome":"resolved","decision":"Credited on 4 March; the passbook entry has been reprinted."}'
ck "the officer can decide it" 200 "$CODE"
ck "the decision is recorded against the ticket" "resolved" "$(Q "SELECT grievance_status FROM support_tickets WHERE ticket_id='$GRIEV'")"
call POST "/grievance/$GRIEV/resolve" "$OWNER" '{"outcome":"resolved","decision":"Trying to decide it a second time."}'
ck "a decided complaint cannot be decided again" 400 "$CODE"
Q "DELETE FROM ticket_messages; DELETE FROM support_tickets WHERE subject LIKE 'APITESTG%';" >/dev/null

print "\n-- Nidhi deposit cap on schemes --"
# A scheme that pays more than the Nidhi Rules allow may be drafted but never sold.
call POST /schemes "$OWNER" '{"code":"ZZ-CAP-1","name":"Over cap","scheme_type":"recurring","tenure_months":12,"total_deposit":12000,"maturity_amount":16000,"status":"active"}'
ck "over-cap scheme refused activation" 422 "$CODE"
has "refusal names the rate" "$BODY" "above the 12.5% cap"
call POST /schemes "$OWNER" '{"code":"ZZ-CAP-1","name":"Over cap","scheme_type":"recurring","tenure_months":12,"total_deposit":12000,"maturity_amount":16000,"status":"draft"}'
ck "same scheme saved as a draft" 200 "$CODE"
# A plan switched on straight in the database (as migrations did) skips that check,
# so booking checks the cap again, and the public list does not advertise it.
Q "UPDATE schemes SET status='active' WHERE code='ZZ-CAP-1'" >/dev/null
call POST /deposits/book "$RETAIL" "{\"account_number\":\"$RETAIL_ACC\",\"scheme_code\":\"ZZ-CAP-1\",\"amount\":1000}"
ck "an active over-cap plan cannot be booked" 422 "$CODE"
has "and the refusal says it is closed" "$BODY" "closed to new deposits"
ck "a refused booking admits and charges nobody" "0|0" "$(Q "SELECT CONCAT_WS('|',(SELECT COUNT(*) FROM member_register WHERE user_id='retail-001'),(SELECT COUNT(*) FROM transactions WHERE mode='SHARE_ALLOTMENT' AND user_id='retail-001'))")"
hasnt "nor is it on the public plan list" "$(curl -s "$API/public/schemes")" "ZZ-CAP-1"
Q "UPDATE schemes SET status='draft' WHERE code='ZZ-CAP-1'" >/dev/null
# The director can bring it inside the cap in one action, keeping the plan.
CAP1=$(Q "SELECT id FROM schemes WHERE code='ZZ-CAP-1'")
call POST "/schemes/$CAP1/reprice" "$STAFF" '{}'; ck "only the director re-prices" 403 "$CODE"
call POST "/schemes/$CAP1/reprice" "$OWNER" '{}'; ck "the director re-prices an over-cap plan" 200 "$CODE"
ck "and it now sits at or just under the cap" "True" "$(print -r -- "$BODY" | jq_ 'print(12.4 <= d["scheme"]["effective_rate_pa"] <= 12.5)')"
call POST "/schemes/$CAP1/reprice" "$OWNER" '{}'; has "a second re-price changes nothing" "$BODY" "already within"

# An instalment plan takes one instalment now and records the rest to collect.
call POST /schemes "$OWNER" '{"code":"ZZ-RD-1","name":"Test RD","scheme_type":"recurring","tenure_months":12,"total_deposit":12000,"maturity_amount":12600,"status":"active","slabs":[{"unit":1000,"deposit":12000,"maturity":12600}]}'
ck "a compliant instalment plan is created" 200 "$CODE"
reset_balances
call POST /deposits/book "$RETAIL" "{\"account_number\":\"$RETAIL_ACC\",\"scheme_code\":\"ZZ-RD-1\",\"amount\":1000}"
ck "a member books it" 200 "$CODE"
has "and is told the rest comes from savings" "$BODY" "taken from your savings"
ck "first instalment paid, the plan knows the rest" "1000.00|1000.00|month|12000.00" "$(Q "SELECT CONCAT_WS('|',paid_amount,instalment_amount,instalment_every,principal_amount) FROM deposits WHERE scheme_code='ZZ-RD-1' AND user_id='retail-001'")"
call GET /deposits/staff-member-lookup "$STAFF"
call POST /deposits/staff-book "$STAFF" "{\"account_number\":\"$CORP_ACC\",\"scheme_code\":\"ZZ-RD-1\",\"amount\":1000}"
ck "staff book the same plan for a member" 200 "$CODE"
ck "with the same instalment record" "1000.00|month" "$(Q "SELECT CONCAT_WS('|',paid_amount,instalment_every) FROM deposits WHERE scheme_code='ZZ-RD-1' AND user_id='corp-001'")"

# The cap applies to every published denomination, not just the headline one: a
# member buys a slab, so a compliant headline must not smuggle an over-cap row in.
call POST /schemes "$OWNER" '{"code":"ZZ-CAP-2","name":"Bad slab","scheme_type":"recurring","tenure_months":36,"total_deposit":108000,"maturity_amount":124650,"status":"active","slabs":[{"unit":3000,"deposit":108000,"maturity":124650},{"unit":500,"deposit":18000,"maturity":21975}]}'
ck "over-cap denomination refused" 422 "$CODE"
has "refusal names the denomination" "$BODY" "denomination"
call POST /schemes "$OWNER" '{"code":"ZZ-CAP-2","name":"Good slabs","scheme_type":"recurring","tenure_months":36,"total_deposit":108000,"maturity_amount":124650,"status":"active","slabs":[{"unit":3000,"deposit":108000,"maturity":124650},{"unit":6000,"deposit":216000,"maturity":249300}]}'
ck "compliant denominations accepted" 200 "$CODE"

# A scheme paying out monthly returns the money years earlier than one paying on
# maturity, so the same two totals imply a much higher rate.
call POST /schemes "$OWNER" '{"code":"ZZ-MIS-1","name":"Monthly payout","scheme_type":"mis","tenure_months":60,"principal_amount":10000,"total_deposit":10000,"maturity_amount":15000,"payout_type":"monthly","status":"active"}'
ck "monthly-payout scheme rated on its true return" 422 "$CODE"
has "monthly payout plus the principal back is rated on its true return" "$BODY" "34.49%"
call POST /schemes "$OWNER" '{"code":"ZZ-MIS-2","name":"Maturity payout","scheme_type":"fixed","tenure_months":60,"principal_amount":10000,"total_deposit":10000,"maturity_amount":15000,"payout_type":"maturity","status":"active"}'
ck "same totals paid on maturity stay within the cap" 200 "$CODE"
call POST /schemes "$OWNER" '{"code":"ZZ-FD-X","name":"Wrong payout","scheme_type":"fixed","tenure_months":12,"total_deposit":10000,"maturity_amount":10500,"payout_type":"monthly","status":"draft"}'
ck "a fixed deposit cannot pay monthly" 422 "$CODE"

# The public rate card is open to anyone and must never advertise a draft.
call GET /public/schemes ""
ck "public rate card needs no login" 200 "$CODE"
has "public card carries the CIN" "$BODY" "U65990UP2019PLN121746"
hasnt "public card hides the drafted over-cap scheme" "$BODY" "ZZ-CAP-1"
Q "DELETE FROM schemes WHERE code LIKE 'ZZ-%';" >/dev/null

print "\n-- regulated capability gating --"
Q "INSERT INTO system_config (id,data,updated_by) VALUES ('global','{}','api_test')
   ON DUPLICATE KEY UPDATE data = JSON_SET(data,
     '$.capabilities.debit_cards.enabled', false,
     '$.capabilities.upi.enabled', false,
     '$.capabilities.mutual_funds.enabled', false,
     '$.capabilities.payment_systems.enabled', false), updated_by='api_test';" >/dev/null
# Not Nidhi business at all, so the routes are gone rather than switched off.
for r in /cards /upi/status /investments/catalog; do call GET $r "$RETAIL"; ck "no route for $r" 404 "$CODE"; done
call POST /services/cheque-book "$RETAIL" '{}'; ck "no cheque books" 404 "$CODE"
call GET /accounts "$RETAIL"; hasnt "accounts carry no cards" "$BODY" '"cards"'
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
LOGIN=$(curl -s -X POST "$API/auth/login" -H "$J" -d "{$(cap),\"email\":\"rahul.sharma@example.com\",\"password\":\"Banking@123\"}")
ck "password alone no longer returns a session" "False" "$(print -r -- "$LOGIN" | jq_ 'print("token" in d)')"
Q "UPDATE users SET totp_enabled=0, totp_secret=NULL, totp_backup_codes=NULL, totp_enrolled_at=NULL WHERE email='rahul.sharma@example.com'" >/dev/null

print "\n-- rate limiting --"
Q "DELETE FROM login_attempts" >/dev/null
codes=""
for i in $(seq 1 34); do
  codes="$codes$(curl -s -o /dev/null -w '%{http_code} ' -X POST "$API/auth/login" -H "$J" -d "{$(cap),\"email\":\"nobody@example.com\",\"password\":\"wrong\"}")"
done
ck "repeated logins hit a 429" "1" "$(print -r -- "$codes" | grep -q 429 && echo 1 || echo 0)"
Q "DELETE FROM login_attempts" >/dev/null

print "\n-- support impersonation (read only) --"
call POST /impersonate/start "$RETAIL" '{"user_id":"retail-001","reason":"attempting to escalate"}'
ck "member cannot impersonate" 403 "$CODE"
call POST /impersonate/start "$OWNER" '{"user_id":"retail-001","reason":"x"}'
ck "a reason is required" 422 "$CODE"
call POST /impersonate/start "$OWNER" '{"user_id":"admin-001","reason":"privilege escalation attempt"}'
ck "an administrator cannot be impersonated" 403 "$CODE"
call POST /impersonate/start "$OWNER" '{"user_id":"retail-001","reason":"ticket 4412 missing transfer"}'
ck "owner can open a support session" 200 "$CODE"
IMP=$(print -r -- "$BODY" | jq_ 'print(d["token"])')
call GET /accounts "$IMP";              ck "support session can read" 200 "$CODE"
call GET /auth/me "$IMP"
ck "the session is flagged as impersonation" "True" "$(print -r -- "$BODY" | jq_ 'print(d["impersonation"]["active"])')"
BEFORE_IMP=$(Q "SELECT balance FROM accounts WHERE account_number='$RETAIL_ACC'")
call POST /accounts/transfer "$IMP" "{\"from_account_number\":\"$RETAIL_ACC\",\"to_account_number\":\"$CORP_ACC\",\"beneficiary_name\":\"T\",\"amount\":100,\"transfer_type\":\"IMPS\",\"transaction_password\":\"Txn@1234\"}"
ck "support session cannot move money" 403 "$CODE"
call POST /deposits/book "$IMP" "{\"account_number\":\"$RETAIL_ACC\",\"amount\":1000,\"tenure_months\":12}"
ck "support session cannot book a deposit" 403 "$CODE"
call POST /totp/setup "$IMP" '{"password":"Banking@123"}'
ck "support session cannot touch credentials" 403 "$CODE"
ck "nothing moved while impersonating" "$BEFORE_IMP" "$(Q "SELECT balance FROM accounts WHERE account_number='$RETAIL_ACC'")"
ck "blocked writes are logged" "1" "$([[ $(Q "SELECT COUNT(*) FROM security_events WHERE event_type='IMPERSONATION_WRITE_BLOCKED'") -ge 3 ]] && echo 1 || echo 0)"
call POST /impersonate/stop "$IMP" '{}'
ck "owner returns to their own identity" 200 "$CODE"
ck "both sides are audited" "2" "$(Q "SELECT COUNT(*) FROM audit_logs WHERE action IN ('IMPERSONATION_STARTED','ACCOUNT_VIEWED_BY_SUPPORT')")"

print "\n-- support desk --"
Q "DELETE FROM ticket_messages; DELETE FROM support_tickets WHERE subject LIKE 'APITEST%';" >/dev/null
call POST /support/complaint "$RETAIL" '{"category":"transfer","subject":"APITEST possible fraud on my account","description":"I did not make the transfer shown yesterday."}'
ck "member can raise a ticket" 200 "$CODE"
TID=$(print -r -- "$BODY" | jq_ 'print(d["ticket_id"])')
ck "fraud wording raises the priority" "HIGH" "$(print -r -- "$BODY" | jq_ 'print(d["priority"])')"
ck "an SLA deadline is set" "1" "$(Q "SELECT due_at IS NOT NULL FROM support_tickets WHERE ticket_id='$TID'")"
ck "the member's words open the thread" "1" "$(Q "SELECT COUNT(*) FROM ticket_messages m JOIN support_tickets t ON t.id=m.ticket_id WHERE t.ticket_id='$TID'")"
call GET /support/queue "$RETAIL"; ck "member cannot open the staff queue" 403 "$CODE"
call GET /support/queue "$STAFF";  ck "staff can open the queue" 200 "$CODE"
call POST "/support/ticket/$TID/assign" "$STAFF" '{}'; ck "staff claims the ticket" 200 "$CODE"
ck "claiming moves it to IN_PROGRESS" "IN_PROGRESS" "$(Q "SELECT status FROM support_tickets WHERE ticket_id='$TID'")"
call POST "/support/ticket/$TID/reply" "$STAFF" '{"body":"INTERNALSECRET ledger checked, genuine card test","internal":true}'
ck "staff can add an internal note" 200 "$CODE"
call POST "/support/ticket/$TID/reply" "$STAFF" '{"body":"Thanks for reporting. We are reviewing the transfer."}'
ck "staff can reply to the member" 200 "$CODE"
# Assert the unread flag BEFORE the member opens the thread, since reading clears it.
ck "a staff reply marks it unread for the member" "1" "$(Q "SELECT unread_for_member>0 FROM support_tickets WHERE ticket_id='$TID'")"
ck "first response time is recorded" "1" "$(Q "SELECT first_response_at IS NOT NULL FROM support_tickets WHERE ticket_id='$TID'")"
call GET "/support/ticket/$TID" "$RETAIL"
hasnt "the member never sees an internal note" "$BODY" "INTERNALSECRET"
ck "reading the thread clears the member's unread flag" "0" "$(Q "SELECT unread_for_member FROM support_tickets WHERE ticket_id='$TID'")"
call GET "/support/ticket/$TID" "$STAFF"
has "staff do see the internal note" "$BODY" "INTERNALSECRET"
call POST "/support/ticket/$TID/reply" "$RETAIL" '{"body":"Thank you, I will wait.","internal":true}'
ck "a member cannot post an internal note" "0" "$(Q "SELECT COUNT(*) FROM ticket_messages WHERE author_role='member' AND internal=1")"
ck "a member reply reopens the ticket" "IN_PROGRESS" "$(Q "SELECT status FROM support_tickets WHERE ticket_id='$TID'")"
call POST "/support/ticket/$TID/status" "$STAFF" '{"status":"RESOLVED"}'
ck "cannot resolve without recording how" 422 "$CODE"
call POST "/support/ticket/$TID/status" "$STAFF" '{"status":"RESOLVED","resolution_note":"Confirmed as the members own card verification charge."}'
ck "resolves with a note" 200 "$CODE"
ck "resolution time recorded" "1" "$(Q "SELECT resolved_at IS NOT NULL FROM support_tickets WHERE ticket_id='$TID'")"
Q "DELETE FROM ticket_messages; DELETE FROM support_tickets WHERE subject LIKE 'APITEST%';" >/dev/null

print "\n-- CRM (staff only) --"
Q "DELETE FROM crm_tasks; DELETE FROM crm_interactions; DELETE FROM crm_leads;" >/dev/null
call GET /crm/members "$RETAIL";            ck "member blocked from the CRM" 403 "$CODE"
call GET "/crm/member/retail-001" "$RETAIL"; ck "member blocked from member 360" 403 "$CODE"
call GET "/crm/member/retail-001" "$STAFF";  ck "staff can open member 360" 200 "$CODE"
hasnt "member 360 never exposes a password hash" "$BODY" "password_hash"
call POST /crm/leads "$STAFF" '{"name":"APITEST Sunil Verma","phone":"+91 90111 22333","source":"walk_in"}'
ck "lead created" 200 "$CODE"
LID=$(print -r -- "$BODY" | jq_ 'print(d["id"])')
call POST /crm/leads "$STAFF" '{"name":"APITEST Duplicate","phone":"+91 90111 22333"}'
ck "duplicate lead phone refused" 400 "$CODE"
PLAN=$(Q "SELECT code FROM schemes WHERE status='active' ORDER BY code LIMIT 1")
call POST /crm/leads "$STAFF" "{\"name\":\"APITEST AOF Verma\",\"phone\":\"+91 90222 33444\",\"source\":\"walk_in\",\"scheme_code\":\"$PLAN\"}"
ck "account-opening lead records the plan" 200 "$CODE"
AOF_LID=$(print -r -- "$BODY" | jq_ 'print(d["id"])')
call POST /register/account "$STAFF" "{\"lead_id\":\"$AOF_LID\",\"name\":\"APITEST AOF Verma\",\"phone\":\"+91 90222 33444\",\"password\":\"AOF#2026!Qr7mZp\",\"transaction_password\":\"4321\",\"initial_deposit\":1000}"
ck "account opening waits for verified documents" 409 "$CODE"
call POST "/crm/leads/$AOF_LID/documents" "$STAFF" "{\"kind\":\"pan\",\"file_name\":\"pan.pdf\",\"content\":\"$DOC_PDF\"}"
ck "identity document uploaded against the enquiry" 200 "$CODE"
PANDOC=$(print -r -- "$BODY" | jq_ 'print(next(x["id"] for x in d["documents"] if x["kind"]=="pan"))')
call POST "/crm/leads/$AOF_LID/documents" "$STAFF" "{\"kind\":\"address\",\"file_name\":\"address.pdf\",\"content\":\"$DOC_PDF\"}"
ck "address document uploaded against the enquiry" 200 "$CODE"
ADDRDOC=$(print -r -- "$BODY" | jq_ 'print(next(x["id"] for x in d["documents"] if x["kind"]=="address"))')
call POST "/kyc/documents/$PANDOC/review" "$OWNER" '{"decision":"verified"}'
ck "identity document can be verified" 200 "$CODE"
call POST "/kyc/documents/$ADDRDOC/review" "$OWNER" '{"decision":"verified"}'
ck "address document can be verified" 200 "$CODE"
call GET "/crm/leads/$AOF_LID/documents" "$STAFF"
ck "verified applicant file is ready to open" "True" "$(print -r -- "$BODY" | jq_ 'print(d["ready_to_open"])')"
call POST /register/account "$STAFF" "{\"lead_id\":\"$AOF_LID\",\"name\":\"APITEST AOF Verma\",\"phone\":\"+91 90222 33444\",\"password\":\"AOF#2026!Qr7mZp\",\"transaction_password\":\"4321\",\"initial_deposit\":1000}"
ck "verified applicant account opens" 200 "$CODE"
ck "opened applicant is KYC verified" "verified" "$(print -r -- "$BODY" | jq_ 'print(d["kyc_status"])')"
has "opened response repeats the selected plan" "$BODY" "$PLAN"
AOF_UID=$(print -r -- "$BODY" | jq_ 'print(d["user"]["id"])')
Q "DELETE FROM kyc_documents WHERE user_id='$AOF_UID';
   DELETE FROM cards WHERE user_id='$AOF_UID';
   DELETE FROM transactions WHERE user_id='$AOF_UID';
   DELETE FROM accounts WHERE user_id='$AOF_UID';
   DELETE FROM users WHERE id='$AOF_UID';" >/dev/null
call PATCH "/crm/leads/$LID" "$STAFF" '{"stage":"lost"}'
ck "cannot mark a lead lost without a reason" 422 "$CODE"
call PATCH "/crm/leads/$LID" "$STAFF" '{"stage":"enrolled"}'
ck "cannot enrol without linking the member" 422 "$CODE"
call PATCH "/crm/leads/$LID" "$STAFF" '{"stage":"enrolled","converted_user_id":"retail-001"}'
ck "enrols when linked to a real member" 200 "$CODE"
BEFORE_TASKS=$(Q "SELECT COUNT(*) FROM crm_tasks")
call POST /crm/interaction "$STAFF" '{"member_user_id":"retail-001","channel":"call","subject":"APITEST FD renewal","outcome":"reached","follow_up_on":"2026-12-30"}'
ck "interaction logged" 200 "$CODE"
ck "a follow-up date creates a task" "1" "$(( $(Q "SELECT COUNT(*) FROM crm_tasks") - BEFORE_TASKS ))"
call POST /crm/interaction "$STAFF" '{"channel":"call","subject":"orphan"}'
ck "an interaction needs a member or a lead" 422 "$CODE"
call GET /crm/tasks "$STAFF"
TASKID=$(print -r -- "$BODY" | jq_ 'print(d["tasks"][0]["id"] if d["tasks"] else "")')
call PATCH "/crm/tasks/$TASKID" "$STAFF" '{"status":"done"}'
ck "cannot close a task silently" 422 "$CODE"
call PATCH "/crm/tasks/$TASKID" "$STAFF" '{"status":"done","completion_note":"Member confirmed rollover"}'
ck "task closes with a note" 200 "$CODE"
Q "DELETE FROM crm_tasks; DELETE FROM crm_interactions; DELETE FROM crm_leads;" >/dev/null

print "\n-- reporting --"
call GET /reports "$RETAIL"; ck "member cannot list reports" 403 "$CODE"
call GET /reports "$OWNER";  ck "owner can list reports" 200 "$CODE"
call GET "/reports/member_register" "$STAFF"
ck "the member register is restricted by role" 403 "$CODE"
call GET "/reports/member_register" "$OWNER"
ck "owner can run the member register" 200 "$CODE"
has "totals cover the whole filtered set" "$BODY" '"totals"'
call GET "/reports/nonsense" "$OWNER"; ck "unknown report 404" 404 "$CODE"
call GET "/reports/audit_trail?sort=1;DROP%20TABLE%20users--" "$OWNER"
ck "an injected sort falls back to the default" 200 "$CODE"
ck "the users table survived" "1" "$(Q "SELECT COUNT(*)>0 FROM users")"
call GET "/reports/member_register?q=%27%20OR%201%3D1--" "$OWNER"
ck "an injected filter is bound, not interpolated" "0" "$(print -r -- "$BODY" | jq_ 'print(d["pagination"]["total"])')"
EXPORTS_BEFORE=$(Q "SELECT COUNT(*) FROM audit_logs WHERE action='REPORT_EXPORTED'")
curl -s -o /tmp/ajspay_rep.csv "$API/reports/member_register/export?format=csv" -H "Authorization: Bearer $OWNER"
ck "CSV export is produced" "1" "$([[ -s /tmp/ajspay_rep.csv ]] && echo 1 || echo 0)"
curl -s -o /tmp/ajspay_rep.xlsx "$API/reports/deposit_register/export?format=xlsx" -H "Authorization: Bearer $OWNER"
ck "XLSX export is a real workbook" "1" "$(file /tmp/ajspay_rep.xlsx | grep -qi 'excel\|zip' && echo 1 || echo 0)"
ck "every export is audited" "2" "$(( $(Q "SELECT COUNT(*) FROM audit_logs WHERE action='REPORT_EXPORTED'") - EXPORTS_BEFORE ))"
rm -f /tmp/ajspay_rep.csv /tmp/ajspay_rep.xlsx

print "\n-- first-run tour --"
Q "UPDATE users SET tutorial_status='pending', tutorial_step=0 WHERE email='rahul.sharma@example.com'" >/dev/null
call GET /tutorial/state ""; ck "anonymous cannot read tour state" 401 "$CODE"
call GET /tutorial/state "$RETAIL"; ck "member gets a tour" 200 "$CODE"
ck "it is offered on a first sign-in" "True" "$(print -r -- "$BODY" | jq_ 'print(d["should_show"])')"
has "the welcome is worded for a member" "$BODY" "your member portal"
hasnt "a gated feature is left out of the tour" "$BODY" "tab-cards"
call GET /tutorial/state "$OWNER"
has "the owner gets their own wording" "$BODY" "the management console"
has "the owner tour covers the security centre" "$BODY" "tab-security-center"
has "every tour points at the page guide" "$BODY" "page-guide-btn"
COLL=$(login collections@ajspay.in "$(sed -n "/collections@ajspay.in/,/Password/p" "$AJSPAY_ROOT/../memory/test_credentials.md" | grep -m1 -o 'Password: `[^`]*`' | cut -d'`' -f2)")
call GET /tutorial/state "$COLL"
has "collection agents get a real tour" "$BODY" "tab-collection"
call POST /tutorial/progress "$RETAIL" '{"step":3}'
ck "progress is saved" "in_progress|3" "$(Q "SELECT CONCAT_WS('|',tutorial_status,tutorial_step) FROM users WHERE email='rahul.sharma@example.com'")"
call GET /tutorial/state "$RETAIL"
ck "and resumed" "3" "$(print -r -- "$BODY" | jq_ 'print(d["step"])')"
call POST /tutorial/progress "$RETAIL" '{"step":9999}'
ck "an out-of-range step is clamped" "1" "$(Q "SELECT tutorial_step < 20 FROM users WHERE email='rahul.sharma@example.com'")"
call POST /tutorial/finish "$RETAIL" '{"skipped":true,"step":2}'
ck "skipping is recorded as skipped" "skipped" "$(Q "SELECT tutorial_status FROM users WHERE email='rahul.sharma@example.com'")"
call GET /tutorial/state "$RETAIL"
ck "a skipped tour is not shown again" "False" "$(print -r -- "$BODY" | jq_ 'print(d["should_show"])')"
call POST /tutorial/restart "$RETAIL" '{}'
ck "restart returns to the beginning" "in_progress|0" "$(Q "SELECT CONCAT_WS('|',tutorial_status,tutorial_step) FROM users WHERE email='rahul.sharma@example.com'")"
call POST /tutorial/finish "$RETAIL" '{}'
ck "finishing is recorded as completed" "completed" "$(Q "SELECT tutorial_status FROM users WHERE email='rahul.sharma@example.com'")"
ck "skip and finish are audited distinctly" "2" "$(Q "SELECT COUNT(DISTINCT action) FROM audit_logs WHERE action IN ('TUTORIAL_SKIPPED','TUTORIAL_COMPLETED')")"

print "\n-- member register (Nidhi Rules 11) --"
Q "DELETE FROM screening_hits; DELETE FROM watchlist_entries; DELETE FROM share_allotments; DELETE FROM member_register;" >/dev/null
# A non-member's first deposit admits them on the spot with the statutory ten shares.
reset_balances
call POST /deposits/book "$RETAIL" "{\"account_number\":\"$RETAIL_ACC\",\"amount\":5000,\"tenure_months\":12}"
ck "a non-member's first deposit is booked" 200 "$CODE"
ck "and admits them with ten shares" "10" "$(Q "SELECT shares_held FROM member_register WHERE user_id='retail-001' AND status='active'")"
ck "the ten shares are paid for from their account" "100.00" "$(Q "SELECT amount FROM transactions WHERE mode='SHARE_ALLOTMENT' AND user_id='retail-001' ORDER BY timestamp DESC LIMIT 1")"
ck "so the balance is less the deposit and the share money" "132700.00" "$(Q "SELECT balance FROM accounts WHERE account_number='$RETAIL_ACC'")"
call POST /deposits/book "$RETAIL" "{\"account_number\":\"$RETAIL_ACC\",\"amount\":5000,\"tenure_months\":12}"
ck "an identical booking a moment later is refused" 409 "$CODE"
call POST /register/admit "$RETAIL" '{"user_id":"corp-001","shares":10}'
ck "a member cannot admit anyone" 403 "$CODE"
call POST /register/admit "$OWNER" '{"user_id":"corp-001","shares":5}'
ck "fewer than ten shares is refused" 422 "$CODE"
call POST /register/admit "$OWNER" '{"user_id":"corp-001","shares":10,"occupation":"Business"}'
ck "admitted with ten shares" 200 "$CODE"
has "a folio number is issued" "$BODY" '"folio_no"'
ck "the share ledger records both" "20" "$(Q "SELECT COALESCE(SUM(shares),0) FROM share_allotments WHERE kind='allotment'")"
call POST /register/admit "$OWNER" '{"user_id":"corp-001","shares":10}'
ck "the same person cannot be admitted twice" 400 "$CODE"
call POST /register/shares "$OWNER" '{"user_id":"retail-001","shares":5,"kind":"surrender"}'
ck "cannot drop below ten while deposits are live" 400 "$CODE"
call POST "/register/cease/retail-001" "$OWNER" '{"reason":"requested"}'
ck "cannot cease while deposits are live" 400 "$CODE"
call GET /register/members "$RETAIL"; ck "a member cannot read the register" 403 "$CODE"
call GET /register/members "$OWNER";  ck "the owner can read the register" 200 "$CODE"

print "\n-- loans: approve, disburse, repay --"
reset_balances
call POST /loans/apply "$RETAIL" '{"loan_type":"gold","amount_requested":12000,"tenure_months":12,"monthly_income":40000,"employment_type":"salaried","purpose":"APITEST loan"}'
ck "a member applies for a gold loan" 200 "$CODE"
LAPP=$(Q "SELECT id FROM loan_applications WHERE purpose='APITEST loan' ORDER BY created_at DESC LIMIT 1")
call POST /panel/loan-dept/decision "$OWNER" "{\"application_id\":\"$LAPP\",\"decision\":\"disburse\"}"
ck "an application cannot be disbursed before approval" 400 "$CODE"
call POST /panel/loan-dept/decision "$OWNER" "{\"application_id\":\"$LAPP\",\"decision\":\"approve\"}"
ck "the loan desk approves it" 200 "$CODE"
call POST /panel/loan-dept/decision "$OWNER" "{\"application_id\":\"$LAPP\",\"decision\":\"disburse\"}"
ck "and disburses it" 200 "$CODE"
has "naming the new loan account" "$BODY" "Disbursed as loan LA"
ck "the money reaches the member's savings" "149800.00" "$(Q "SELECT balance FROM accounts WHERE account_number='$RETAIL_ACC'")"
ck "with twelve EMIs that repay exactly the principal" "12|12000.00" \
  "$(Q "SELECT CONCAT_WS('|',COUNT(*),SUM(principal_part)) FROM loan_emis e JOIN loans l ON l.id=e.loan_id WHERE l.application_id='$LAPP'")"
LNO=$(Q "SELECT loan_number FROM loans WHERE application_id='$LAPP'")
OLDAPP=$(Q "SELECT id FROM loan_applications WHERE loan_type NOT IN ('gold','home') LIMIT 1")
if [[ -n $OLDAPP ]]; then
  Q "UPDATE loan_applications SET status='approved' WHERE id='$OLDAPP'" >/dev/null
  call POST /panel/loan-dept/decision "$OWNER" "{\"application_id\":\"$OLDAPP\",\"decision\":\"disburse\"}"
  ck "an old approved unsecured loan cannot be paid out" 400 "$CODE"
fi
call POST /loans/pay-emi "$RETAIL" "{\"loan_number\":\"$LNO\"}"
ck "the member can pay an EMI now" 200 "$CODE"
ck "which reduces what is owed" "1" "$(Q "SELECT emis_paid = 1 AND outstanding < 12000 FROM loans WHERE loan_number='$LNO'")"
call POST /loans/pay-emi "$STAFF" "{\"loan_number\":\"$LNO\"}"
ck "nobody else can pay it from their account" 404 "$CODE"
call POST /panel/loan-dept/decision "$OWNER" "{\"application_id\":\"$LAPP\",\"decision\":\"reject\"}"
ck "a disbursed loan cannot be rejected" 400 "$CODE"
call GET /loans/my-applications "$RETAIL"
has "the member sees the loan and its schedule" "$BODY" '"schedule"'
Q "DELETE e FROM loan_emis e JOIN loans l ON l.id=e.loan_id WHERE l.application_id='$LAPP';
   DELETE FROM loans WHERE application_id='$LAPP'; DELETE FROM loan_applications WHERE id='$LAPP';" >/dev/null
reset_balances

print "\n-- sanctions and PEP screening --"
call POST /screening/run "$OWNER" '{}'
ck "screening refuses to run on an empty list" 400 "$CODE"
call GET /screening/watchlist "$RETAIL"; ck "a member cannot see the watchlist" 403 "$CODE"
call POST /screening/watchlist "$OWNER" '{"entries":[{"list_name":"UNSC","full_name":"Sharma Rahul","reference":"T1"},{"list_name":"PEP","full_name":"Someone Entirely Different","reference":"T2"}]}'
ck "two names loaded" 200 "$CODE"
call POST /screening/run "$OWNER" '{}'
ck "screening ran" 200 "$CODE"
ck "a reordered name is caught" "1" "$(Q "SELECT COUNT(*) FROM screening_hits WHERE status='open'")"
ck "an unrelated name is not" "0" "$(Q "SELECT COUNT(*) FROM screening_hits WHERE matched_name LIKE 'Someone%'")"
ck "an open match rates the member high" "high" "$(Q "SELECT risk_category FROM member_register WHERE user_id='retail-001'")"
HIT=$(Q "SELECT id FROM screening_hits LIMIT 1")
call POST /screening/action "$OWNER" "{\"hit_id\":\"$HIT\",\"action\":\"clear\",\"note\":\"ok\"}"
ck "a review needs a real reason" 422 "$CODE"
call POST /screening/action "$OWNER" "{\"hit_id\":\"$HIT\",\"action\":\"confirm\",\"note\":\"Passport and date of birth both match the listed individual.\"}"
ck "a match can be confirmed" 200 "$CODE"
call POST /deposits/book "$RETAIL" "{\"account_number\":\"$RETAIL_ACC\",\"amount\":1000,\"tenure_months\":12}"
ck "a confirmed match blocks transacting" 403 "$CODE"
ck "and is logged as critical" "1" "$(Q "SELECT COUNT(*)>0 FROM security_events WHERE event_type='BLOCKED_SANCTIONED_MEMBER'")"
Q "DELETE FROM screening_hits; DELETE FROM watchlist_entries; DELETE FROM share_allotments; DELETE FROM member_register;" >/dev/null

print "\n-- compliance officers and OTP delivery --"
call PUT /admin/config "$RETAIL" '{"grievance_officer_name":"X"}'
ck "only the Director may name officers" 403 "$CODE"
call PUT /admin/config "$OWNER" '{"grievance_officer_email":"not-an-email"}'
ck "a malformed officer email is refused" 422 "$CODE"
call PUT /admin/config "$OWNER" '{"grievance_officer_name":""}'
ck "a blank officer name is refused" 422 "$CODE"
call PUT /admin/config "$OWNER" '{"grievance_officer_name":"APITEST Officer","grievance_officer_email":"grievance@example.com","grievance_officer_phone":"+91 90000 00000","principal_officer_name":"APITEST PO","principal_officer_email":"po@example.com","designated_director_name":"APITEST DD"}'
ck "the Director can name them" 200 "$CODE"
call GET /privacy/notice ""
has "the officer reaches the public privacy notice" "$BODY" "APITEST Officer"
call GET /support/notifications "$RETAIL"
has "and the member's support view" "$BODY" "APITEST Officer"
call GET /admin/config "$OWNER"
ck "the config screen knows it is set" "True" "$(print -r -- "$BODY" | jq_ 'print(d["grievance_officer_configured"])')"
ck "and that the PMLA roles are filled" "True" "$(print -r -- "$BODY" | jq_ 'print(d["pmla_officers_configured"])')"
call PUT /admin/config "$OWNER" '{"live_otp":true}'
ck "live OTP is refused with no way to deliver a code" 422 "$CODE"
has "and says what is missing" "$BODY" "Twilio"

print "\n-- referrals before KYC --"
call GET /referrals/my-code "$RETAIL"
REFCODE=$(print -r -- "$BODY" | jq_ 'print(d["referral_code"])')
PENDING_HASH=$(php -r 'echo password_hash("Pending@123", PASSWORD_BCRYPT);')
Q "DELETE FROM referrals WHERE referee_id='apitest-ref-pending';
   DELETE FROM users WHERE id='apitest-ref-pending' OR email='apitest.pending.referral@example.com';
   INSERT INTO users (id, name, email, phone, role, password_hash, transaction_password_hash, branch, kyc_status, referred_by_code)
   VALUES ('apitest-ref-pending', 'APITEST Pending Referral', 'apitest.pending.referral@example.com',
     '+91 90000 00123', 'retail', '$PENDING_HASH', '$PENDING_HASH',
     'AJSP-MUM-042 (Nariman Point Main)', 'pending_approval', '$REFCODE');" >/dev/null
call GET /referrals/history "$RETAIL"
has "pending referred sign-up appears before KYC" "$BODY" "APITEST Pending Referral"
has "pending referred sign-up is labelled pending" "$BODY" "pending_kyc"
# Verifying their KYC records the introduction and pays nobody (Nidhi Rules, Rule 6).
Q "INSERT INTO accounts (id, user_id, account_number, account_type, account_name, balance, branch, ifsc_code, status)
   VALUES ('apitest-ref-acc', 'apitest-ref-pending', 'AJSP0APITEST1', 'Savings', 'APITEST', 0, 'AJSP-MUM-042', 'AJSP0000042', 'active');" >/dev/null
BAL_BEFORE=$(Q "SELECT balance FROM accounts WHERE account_number='$RETAIL_ACC'")
call POST /admin/kyc-action "$OWNER" '{"user_id":"apitest-ref-pending","status":"verified"}'
ck "KYC approval goes through" 200 "$CODE"
ck "the introduction is recorded" "1|0.00" "$(Q "SELECT CONCAT_WS('|',COUNT(*),COALESCE(MAX(credit_amount),0)) FROM referrals WHERE referee_id='apitest-ref-pending'")"
ck "the introducer is paid nothing" "$BAL_BEFORE" "$(Q "SELECT balance FROM accounts WHERE account_number='$RETAIL_ACC'")"
ck "nor is the new member" "0.00" "$(Q "SELECT balance FROM accounts WHERE account_number='AJSP0APITEST1'")"
ck "no referral bonus transaction exists" "0" "$(Q "SELECT COUNT(*) FROM transactions WHERE mode='REFERRAL_BONUS' AND account_number IN ('$RETAIL_ACC','AJSP0APITEST1')")"

print "\n-- statutory checks come from the books --"
call GET /admin/rbi-reports "$OWNER"; ck "the compliance report loads" 200 "$CODE"
hasnt "no typed-in NOF figure" "$BODY" "25.00 lakh"
hasnt "no typed-in ratio" "$BODY" "1:18"
call GET /panel/collection "$OWNER"
hasnt "no made-up recovery target" "$BODY" "recovery_target_month"

print "\n-- public site offers only what a Nidhi may --"
PUB=$(curl -s "$API/public/products")
for p in trade-finance current-account mutual-funds insurance debit-cards personal-loan vehicle-loan education-loan; do
  hasnt "no public page for $p" "$PUB" "\"$p\""
done
has "gold loan is still offered" "$PUB" "gold-loan"

print "\n-- secured lending only --"
call POST /loans/apply "$RETAIL" '{"loan_type":"personal","amount_requested":50000,"tenure_months":12,"monthly_income":40000,"employment_type":"salaried","purpose":"APITEST"}'
ck "an unsecured personal loan is refused" 422 "$CODE"
has "and the refusal says what we lend against" "$BODY" "gold or property"
call POST /loans/apply "$RETAIL" '{"loan_type":"vehicle","amount_requested":50000,"tenure_months":12,"monthly_income":40000,"employment_type":"salaried","purpose":"APITEST"}'
ck "a vehicle loan is refused" 422 "$CODE"

print "\n-- Nidhi limits enforced, and what people are told --"
call GET /notifications "$OWNER"; ck "the director's notices load" 200 "$CODE"
has "and say net owned funds are missing" "$BODY" "Net owned funds not entered"
call GET /notifications "$RETAIL"; ck "a member's notices load" 200 "$CODE"
call GET /notifications ""; ck "and need a session" 401 "$CODE"
call GET /reports/kyc_reviews "$STAFF"; ck "tellers can list KYC reviews due" 200 "$CODE"
Q "UPDATE system_parameters SET value = 1000 WHERE param_key = 'net_owned_funds'" >/dev/null
call POST /accounts/counter-deposit "$STAFF" "{\"account_number\":\"$RETAIL_ACC\",\"amount\":500,\"mode\":\"cash\"}"
ck "new money above 20x net owned funds is refused" 422 "$CODE"
has "and the refusal cites the rule" "$BODY" "twenty times net owned funds"
Q "UPDATE system_parameters SET value = 0 WHERE param_key = 'net_owned_funds'" >/dev/null
call POST /accounts/counter-deposit "$STAFF" "{\"account_number\":\"$RETAIL_ACC\",\"amount\":500,\"mode\":\"cash\"}"
ck "not enforced until net owned funds are entered" 200 "$CODE"
reset_balances

print "\n-- KYC verification desk --"
call GET /admin/kyc-pending "$STAFF"; ck "a teller can open the KYC queue" 200 "$CODE"
call GET /kyc/documents/queue "$STAFF"; ck "and the document review queue" 200 "$CODE"
LOANS=$(login loans@ajspay.in "$(sed -n "/loans@ajspay.in/,/Password/p" "$AJSPAY_ROOT/../memory/test_credentials.md" | grep -m1 -o 'Password: `[^`]*`' | cut -d'`' -f2)")
call GET /admin/kyc-pending "$LOANS"; ck "the loan desk cannot" 403 "$CODE"
call GET /admin/kyc-pending "$RETAIL"; ck "nor can a member" 403 "$CODE"

print "\n-- My Network: recognition only --"
call GET /referrals/structure "$RETAIL"; ck "the plan-book commission table is gone" 404 "$CODE"
call GET /my-standing "$RETAIL"; ck "standing still loads" 200 "$CODE"
hasnt "no booster programme on the standing" "$BODY" '"booster"'
hasnt "no rupee reward beside a rank" "$BODY" "reward_amount"
call GET "/rank-tiers?programme=booster" "$OWNER"; ck "the booster ladder cannot be opened" 422 "$CODE"

print "\n-- cleanup --"
Q "DELETE FROM transactions WHERE description LIKE '%APITEST%' OR counterparty_name IN ('Tata Digital','Tata','Outside');
   DELETE FROM fraud_alerts; DELETE FROM security_events; DELETE FROM login_attempts;
   DELETE FROM ticket_messages; DELETE FROM support_tickets WHERE subject LIKE 'APITEST%';
   DELETE FROM audit_logs WHERE action LIKE 'MFA%' OR action LIKE 'FRAUD%' OR action='FUND_TRANSFER'
     OR action LIKE 'IMPERSONATION%' OR action='ACCOUNT_VIEWED_BY_SUPPORT' OR action LIKE 'TICKET%'
     OR action='SUPPORT_TICKET' OR action LIKE 'CRM%' OR action='REPORT_EXPORTED';
   DELETE FROM kyc_documents WHERE lead_id IN (SELECT id FROM crm_leads WHERE phone='+91 90222 33444')
      OR user_id IN (SELECT id FROM users WHERE phone='+91 90222 33444');
   DELETE FROM referrals WHERE referee_id='apitest-ref-pending';
   DELETE FROM accounts WHERE id='apitest-ref-acc';
   DELETE FROM users WHERE id='apitest-ref-pending' OR email='apitest.pending.referral@example.com';
   DELETE FROM cards WHERE user_id IN (SELECT id FROM users WHERE phone='+91 90222 33444');
   DELETE FROM transactions WHERE user_id IN (SELECT id FROM users WHERE phone='+91 90222 33444');
   DELETE FROM accounts WHERE user_id IN (SELECT id FROM users WHERE phone='+91 90222 33444');
   DELETE FROM users WHERE phone='+91 90222 33444';
   DELETE FROM crm_tasks; DELETE FROM crm_interactions; DELETE FROM crm_leads;
   DELETE FROM audit_logs WHERE action LIKE 'TUTORIAL%';
   UPDATE users SET tutorial_status='completed', tutorial_step=0;
   DELETE FROM transactions WHERE ref_number IN (SELECT deposit_number FROM deposits WHERE principal_amount IN (1000,5000));
   DELETE FROM deposits WHERE principal_amount IN (1000,5000);
   DELETE FROM screening_hits; DELETE FROM watchlist_entries;
   DELETE FROM transactions WHERE mode='SHARE_ALLOTMENT' AND user_id IN ('retail-001','corp-001');
   DELETE FROM share_allotments; DELETE FROM member_register;
   DELETE FROM audit_logs WHERE action LIKE 'MEMBER_%' OR action LIKE 'SHARES_%'
     OR action LIKE 'SCREENING_%' OR action LIKE 'WATCHLIST_%' OR action='DEPOSIT_BOOKED';" >/dev/null
reset_balances
if [[ -n "$CFG_BACKUP" ]]; then
  Q "UPDATE system_config SET data=FROM_BASE64('$CFG_BACKUP') WHERE id='global'" >/dev/null
fi
print "\n== $pass passed, $fail failed =="
[[ $fail -eq 0 ]] || exit 1
