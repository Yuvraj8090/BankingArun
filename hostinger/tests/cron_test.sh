#!/bin/zsh
# AJSPay cron regression suite: standing instructions, scheduled transfers,
# deposit interest and maturity. Writes and removes its own rows.
#
#   hostinger/tests/cron_test.sh
ROOT=${AJSPAY_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}
DB=${AJSPAY_DB:-ajspay_php}
Q() { mysql -u root -N -B "$DB" -e "$1"; }
DBX() { mysql -u root "$DB"; }
CRON() { php "$ROOT/cron.php" "$@"; }
RETAIL_ACC=AJSP00984521098
CORP_ACC=AJSP00129845612
TODAY=$(date +%F)
CFG_BACKUP=$(Q "SELECT TO_BASE64(data) FROM system_config WHERE id='global'")
pass=0; fail=0
ck() { if [[ "$2" == "$3" ]]; then print "  ok   $1"; pass=$((pass+1)); else print "  FAIL $1: expected '$2' got '$3'"; fail=$((fail+1)); fi }

cleanup() {
  Q "DELETE FROM transactions WHERE description LIKE '%CRONTEST%' OR counterparty_name LIKE 'CRONTEST%' OR ref_number LIKE 'MAT-CRONTEST%' OR ref_number LIKE 'INT-CRONTEST%' OR ref_number LIKE 'DINT-CRONTEST%';
     DELETE FROM rail_transactions WHERE counterparty_name LIKE 'CRONTEST%' OR ref_number IN (SELECT ref_number FROM scheduled_payments WHERE id LIKE 'crontest-%' AND ref_number IS NOT NULL);
     DELETE FROM standing_instructions WHERE id LIKE 'crontest-%';
     DELETE FROM scheduled_payments WHERE id LIKE 'crontest-%';
     DELETE FROM deposits WHERE deposit_number LIKE 'CRONTEST%';
     DELETE FROM schemes WHERE code LIKE 'CRONTEST%';
     DELETE FROM audit_logs WHERE action IN ('SI_EXECUTED','SI_FAILED','SI_PAUSED','DEPOSIT_MATURED','SCHEDULED_TRANSFER_EXECUTED','SCHEDULED_TRANSFER_FAILED');
     UPDATE accounts SET balance=137800.00 WHERE account_number='$RETAIL_ACC';
     UPDATE accounts SET balance=1285000.00 WHERE account_number='$CORP_ACC';" >/dev/null
  if [[ -n "$CFG_BACKUP" ]]; then
    Q "UPDATE system_config SET data=FROM_BASE64('$CFG_BACKUP') WHERE id='global'" >/dev/null
  fi
}

print "AJSPay cron regression suite"
cleanup
Q "INSERT INTO system_config (id,data,updated_by) VALUES ('global','{}','cron_test')
   ON DUPLICATE KEY UPDATE data = JSON_SET(data,
     '$.capabilities.payment_systems.enabled', true,
     '$.capabilities.payment_systems.reference', 'CRONTEST',
     '$.capabilities.payment_systems.authorised_on', NOW(),
     '$.capabilities.payment_systems.by', 'cron_test',
     '$.rails.driver', 'simulator',
     '$.rails.max_payout', 200000,
     '$.rails.daily_payout_cap', 1000000), updated_by='cron_test';" >/dev/null
DBX <<SQL
INSERT INTO standing_instructions (id,user_id,from_account_number,beneficiary_name,beneficiary_account,amount,frequency,category,start_date,end_date,remarks,status,executions,next_run) VALUES
('crontest-daily','retail-001','$RETAIL_ACC','Tata Digital','$CORP_ACC',100.00,'daily','generic','$TODAY',NULL,'CRONTEST daily','active',0,'$TODAY'),
('crontest-poor','retail-001','$RETAIL_ACC','Tata Digital','$CORP_ACC',9000000.00,'monthly','generic','$TODAY',NULL,'CRONTEST unaffordable','active',0,'$TODAY'),
('crontest-clamp','retail-001','$RETAIL_ACC','Tata Digital','$CORP_ACC',300.00,'monthly','generic','2026-01-31',NULL,'CRONTEST month end','active',0,'2026-01-31'),
('crontest-future','retail-001','$RETAIL_ACC','Tata Digital','$CORP_ACC',500.00,'monthly','generic','$TODAY',NULL,'CRONTEST future','active',0,'2027-12-01'),
('crontest-paused','retail-001','$RETAIL_ACC','Tata Digital','$CORP_ACC',600.00,'monthly','generic','$TODAY',NULL,'CRONTEST paused','paused',0,'$TODAY');
INSERT INTO scheduled_payments (id,user_id,from_account_number,to_account_number,beneficiary_name,transfer_type,amount,schedule_date,status,remarks) VALUES
('crontest-pay-ok','retail-001','$RETAIL_ACC','$CORP_ACC','Tata Digital','IMPS',250.00,'$TODAY','SCHEDULED','CRONTEST scheduled ok'),
('crontest-pay-external','retail-001','$RETAIL_ACC','HDFC0009998887','CRONTEST Outside','NEFT',400.00,'$TODAY','SCHEDULED','CRONTEST scheduled external'),
('crontest-pay-future','retail-001','$RETAIL_ACC','$CORP_ACC','Tata Digital','NEFT',700.00,'2027-12-01','SCHEDULED','CRONTEST scheduled future');
INSERT INTO deposits (id,user_id,deposit_number,deposit_type,source_account,principal_amount,interest_rate,tenure_months,interest_payout,maturity_amount,maturity_date,status,created_at) VALUES
('crontest-dep-mat','retail-001','CRONTEST-MAT','fixed','$RETAIL_ACC',10000.00,7.25,12,'on_maturity',10725.00,DATE_SUB(CURDATE(),INTERVAL 1 DAY),'active',DATE_SUB(NOW(),INTERVAL 13 MONTH)),
('crontest-dep-mon','retail-001','CRONTEST-MON','fixed','$RETAIL_ACC',120000.00,6.00,24,'monthly',134400.00,DATE_ADD(CURDATE(),INTERVAL 22 MONTH),'active',DATE_SUB(NOW(),INTERVAL 2 MONTH)),
('crontest-dep-fut','retail-001','CRONTEST-FUT','fixed','$RETAIL_ACC',5000.00,7.00,12,'on_maturity',5350.00,DATE_ADD(CURDATE(),INTERVAL 6 MONTH),'active',NOW());
-- Simple daily-% plan (1%/day, ₹150 withdrawal threshold). Deposit A's
-- accrued total stays under the threshold today (₹100 + ₹10 = ₹110), so it
-- should only accrue. Deposit B's crosses it (₹145 + ₹10 = ₹155), so it
-- should release in full and reset to zero.
INSERT INTO schemes (id,code,name,scheme_type,tenure_months,principal_amount,total_deposit,maturity_amount,
    payout_type,daily_rate_percent,withdrawal_threshold,status) VALUES
('crontest-scheme-daily','CRONTEST-DAILY','CRONTEST Daily Plan','fixed',12,1000.00,1000.00,1000.00,
    'daily',1.000,150.00,'active');
INSERT INTO deposits (id,user_id,deposit_number,deposit_type,scheme_code,source_account,principal_amount,
    interest_rate,tenure_months,interest_payout,maturity_amount,maturity_date,status,created_at,
    accrued_interest,last_payout_date) VALUES
('crontest-dep-daily-a','retail-001','CRONTEST-DAILY-A','fixed','CRONTEST-DAILY','$RETAIL_ACC',1000.00,365.00,12,
    'daily',1000.00,DATE_ADD(CURDATE(),INTERVAL 6 MONTH),'active',DATE_SUB(NOW(),INTERVAL 1 MONTH),
    100.00,DATE_SUB(CURDATE(),INTERVAL 1 DAY)),
('crontest-dep-daily-b','retail-001','CRONTEST-DAILY-B','fixed','CRONTEST-DAILY','$RETAIL_ACC',1000.00,365.00,12,
    'daily',1000.00,DATE_ADD(CURDATE(),INTERVAL 6 MONTH),'active',DATE_SUB(NOW(),INTERVAL 1 MONTH),
    145.00,DATE_SUB(CURDATE(),INTERVAL 1 DAY));
SQL

print "\n-- dry run changes nothing --"
CRON --dry-run >/dev/null
ck "balance untouched by a dry run" "137800.00" "$(Q "SELECT balance FROM accounts WHERE account_number='$RETAIL_ACC'")"
ck "no instruction marked run" "5" "$(Q "SELECT COUNT(*) FROM standing_instructions WHERE id LIKE 'crontest-%' AND last_run IS NULL")"

print "\n-- real run --"
CRON >/dev/null 2>&1

print "\n-- standing instructions --"
ck "daily paid and rolled forward" "$(date -v+1d +%F 2>/dev/null || date -d '+1 day' +%F)|1|success" \
  "$(Q "SELECT CONCAT_WS('|',next_run,executions,last_status) FROM standing_instructions WHERE id='crontest-daily'")"
ck "unaffordable held for retry, not skipped" "$TODAY|0|failed|1" \
  "$(Q "SELECT CONCAT_WS('|',next_run,executions,last_status,failures) FROM standing_instructions WHERE id='crontest-poor'")"
ck "31st anchor clamps to end of February" "2026-02-28" \
  "$(Q "SELECT next_run FROM standing_instructions WHERE id='crontest-clamp'")"
ck "future instruction untouched" "2027-12-01|0" \
  "$(Q "SELECT CONCAT_WS('|',next_run,executions) FROM standing_instructions WHERE id='crontest-future'")"
ck "paused instruction untouched" "0|paused" \
  "$(Q "SELECT CONCAT_WS('|',executions,status) FROM standing_instructions WHERE id='crontest-paused'")"

print "\n-- scheduled transfers --"
ck "due payment executed" "EXECUTED" "$(Q "SELECT status FROM scheduled_payments WHERE id='crontest-pay-ok'")"
ck "external due payment executed" "EXECUTED" "$(Q "SELECT status FROM scheduled_payments WHERE id='crontest-pay-external'")"
ck "external scheduled payout settled through rail" "SUCCESS|SUCCESS" \
  "$(Q "SELECT CONCAT_WS('|',rt.status,t.status) FROM scheduled_payments sp JOIN rail_transactions rt ON rt.ref_number=sp.ref_number JOIN transactions t ON t.ref_number=sp.ref_number WHERE sp.id='crontest-pay-external'")"
ck "future payment still scheduled" "SCHEDULED" "$(Q "SELECT status FROM scheduled_payments WHERE id='crontest-pay-future'")"

print "\n-- deposit interest and maturity --"
ck "matured deposit marked matured" "matured" "$(Q "SELECT status FROM deposits WHERE deposit_number='CRONTEST-MAT'")"
ck "maturity proceeds credited" "10725.00" "$(Q "SELECT amount FROM transactions WHERE ref_number='MAT-CRONTEST-MAT'")"
ck "monthly interest = 120000 x 6%/12" "600.00" "$(Q "SELECT amount FROM transactions WHERE mode='DEPOSIT_INTEREST' AND ref_number LIKE 'INT-CRONTEST-MON%'")"
ck "monthly deposit stays active" "active" "$(Q "SELECT status FROM deposits WHERE deposit_number='CRONTEST-MON'")"
ck "undue deposit untouched" "active|0.00" "$(Q "SELECT CONCAT_WS('|',status,interest_paid) FROM deposits WHERE deposit_number='CRONTEST-FUT'")"

print "\n-- daily interest accrual --"
ck "under threshold: accrues, no payout" "110.00|active" \
  "$(Q "SELECT CONCAT_WS('|',accrued_interest,status) FROM deposits WHERE deposit_number='CRONTEST-DAILY-A'")"
ck "under threshold: no transaction written" "0" "$(Q "SELECT COUNT(*) FROM transactions WHERE ref_number LIKE 'DINT-CRONTEST-DAILY-A%'")"
ck "over threshold: released and reset to zero" "0.00|155.00" \
  "$(Q "SELECT CONCAT_WS('|',accrued_interest,interest_paid) FROM deposits WHERE deposit_number='CRONTEST-DAILY-B'")"
ck "over threshold: full accrued total credited" "155.00" \
  "$(Q "SELECT amount FROM transactions WHERE ref_number LIKE 'DINT-CRONTEST-DAILY-B%'")"

print "\n-- balance reconciles --"
# out: 100 daily + 300 clamp + 250 scheduled + 400 external scheduled = 1050
# in: 10725 maturity + 600 interest + 155 daily interest released = 11480
ck "balance = 137800 - 1050 + 11480" "148230.00" "$(Q "SELECT balance FROM accounts WHERE account_number='$RETAIL_ACC'")"

print "\n-- a second run the same day is a no-op --"
CRON >/dev/null 2>&1
ck "nothing paid twice" "148230.00" "$(Q "SELECT balance FROM accounts WHERE account_number='$RETAIL_ACC'")"
ck "maturity credited once only" "1" "$(Q "SELECT COUNT(*) FROM transactions WHERE ref_number='MAT-CRONTEST-MAT'")"
ck "interest credited once only" "1" "$(Q "SELECT COUNT(*) FROM transactions WHERE mode='DEPOSIT_INTEREST' AND ref_number LIKE 'INT-CRONTEST-MON%'")"
ck "daily interest not accrued twice" "110.00" "$(Q "SELECT accrued_interest FROM deposits WHERE deposit_number='CRONTEST-DAILY-A'")"
ck "daily interest not released twice" "1" "$(Q "SELECT COUNT(*) FROM transactions WHERE ref_number LIKE 'DINT-CRONTEST-DAILY-B%'")"

print "\n-- repeated failure pauses the instruction --"
for day in 1 2; do
  Q "UPDATE standing_instructions SET last_run=DATE_SUB('$TODAY',INTERVAL 1 DAY) WHERE id='crontest-poor'" >/dev/null
  CRON >/dev/null 2>&1
done
ck "paused after three consecutive failures" "paused|3" \
  "$(Q "SELECT CONCAT_WS('|',status,failures) FROM standing_instructions WHERE id='crontest-poor'")"

print "\n-- cron refuses to run over HTTP --"
ck "CLI guard present" "1" "$(grep -c "PHP_SAPI" "$ROOT/cron.php" >/dev/null && grep -cF "PHP_SAPI !== " "$ROOT/cron.php")"

cleanup
print "\n== $pass passed, $fail failed =="
[[ $fail -eq 0 ]] || exit 1
