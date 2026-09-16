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
has "monthly payout rate is far above the maturity reading" "$BODY" "18.71%"
call POST /schemes "$OWNER" '{"code":"ZZ-MIS-2","name":"Maturity payout","scheme_type":"mis","tenure_months":60,"principal_amount":10000,"total_deposit":10000,"maturity_amount":15000,"payout_type":"maturity","status":"active"}'
ck "same totals paid on maturity stay within the cap" 200 "$CODE"

# The public rate card is open to anyone and must never advertise a draft.
call GET /public/schemes ""
ck "public rate card needs no login" 200 "$CODE"
has "public card carries the CIN" "$BODY" "U65990UP2019PLN121746"
hasnt "public card hides the drafted over-cap scheme" "$BODY" "ZZ-CAP-1"
Q "DELETE FROM schemes WHERE code LIKE 'ZZ-%';" >/dev/null

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
call POST /deposits/book "$RETAIL" "{\"account_number\":\"$RETAIL_ACC\",\"amount\":5000,\"tenure_months\":12}"
ck "a non-member cannot deposit" 403 "$CODE"
has "and is told why" "$BODY" "members only"
call POST /register/admit "$RETAIL" '{"user_id":"retail-001","shares":10}'
ck "a member cannot admit anyone" 403 "$CODE"
call POST /register/admit "$OWNER" '{"user_id":"retail-001","shares":5}'
ck "fewer than ten shares is refused" 422 "$CODE"
call POST /register/admit "$OWNER" '{"user_id":"retail-001","shares":10,"occupation":"Salaried"}'
ck "admitted with ten shares" 200 "$CODE"
has "a folio number is issued" "$BODY" '"folio_no"'
ck "the share ledger records it" "10" "$(Q "SELECT COALESCE(SUM(shares),0) FROM share_allotments WHERE kind='allotment'")"
call POST /register/admit "$OWNER" '{"user_id":"retail-001","shares":10}'
ck "the same person cannot be admitted twice" 400 "$CODE"
call POST /deposits/book "$RETAIL" "{\"account_number\":\"$RETAIL_ACC\",\"amount\":5000,\"tenure_months\":12}"
ck "a member can deposit" 200 "$CODE"
call POST /register/shares "$OWNER" '{"user_id":"retail-001","shares":5,"kind":"surrender"}'
ck "cannot drop below ten while deposits are live" 400 "$CODE"
call POST "/register/cease/retail-001" "$OWNER" '{"reason":"requested"}'
ck "cannot cease while deposits are live" 400 "$CODE"
call GET /register/members "$RETAIL"; ck "a member cannot read the register" 403 "$CODE"
call GET /register/members "$OWNER";  ck "the owner can read the register" 200 "$CODE"

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

print "\n-- cleanup --"
Q "DELETE FROM transactions WHERE description LIKE '%APITEST%' OR counterparty_name IN ('Tata Digital','Tata','Outside');
   DELETE FROM fraud_alerts; DELETE FROM security_events; DELETE FROM login_attempts;
   DELETE FROM ticket_messages; DELETE FROM support_tickets WHERE subject LIKE 'APITEST%';
   DELETE FROM audit_logs WHERE action LIKE 'MFA%' OR action LIKE 'FRAUD%' OR action='FUND_TRANSFER'
     OR action LIKE 'IMPERSONATION%' OR action='ACCOUNT_VIEWED_BY_SUPPORT' OR action LIKE 'TICKET%'
     OR action='SUPPORT_TICKET' OR action LIKE 'CRM%' OR action='REPORT_EXPORTED';
   DELETE FROM crm_tasks; DELETE FROM crm_interactions; DELETE FROM crm_leads;
   DELETE FROM audit_logs WHERE action LIKE 'TUTORIAL%';
   UPDATE users SET tutorial_status='completed', tutorial_step=0;
   DELETE FROM deposits WHERE principal_amount IN (1000,5000);
   DELETE FROM screening_hits; DELETE FROM watchlist_entries;
   DELETE FROM share_allotments; DELETE FROM member_register;
   DELETE FROM audit_logs WHERE action LIKE 'MEMBER_%' OR action LIKE 'SHARES_%'
     OR action LIKE 'SCREENING_%' OR action LIKE 'WATCHLIST_%' OR action='DEPOSIT_BOOKED';" >/dev/null
reset_balances
print "\n== $pass passed, $fail failed =="
[[ $fail -eq 0 ]] || exit 1
