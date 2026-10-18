#!/bin/zsh
# Every backend suite in one go. Needs the PHP API on 127.0.0.1:8002
# (`php -S 127.0.0.1:8002 api.php` from hostinger/) and the dev database.
# Never point it at production: the suites write and delete rows.
cd ${0:A:h}
rc=0
for t in api_test.sh cron_test.sh role_smoke.sh; do
  print -n "$t: "; zsh $t | tail -1; (( ${pipestatus[1]} )) && rc=1
done
print -n "market_rates_test.php: "; php market_rates_test.php || rc=1
print -n "password_rule_test.php: "; php -d zend.assertions=1 -d assert.exception=1 password_rule_test.php || rc=1
print -n "pyapi: "; (cd ../../pyapi && .venv/bin/python -m pytest -q | tail -1) || rc=1
exit $rc
