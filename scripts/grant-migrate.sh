#!/usr/bin/env bash
# One-time, as root on the VPS. Creates the credential the deploy uses to apply
# migrate.sql. Kept separate from the application's own user on purpose: the web
# app holds no DDL rights, so a SQL injection against it cannot drop a table.
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Run as root" >&2; exit 1; }

if [[ -f /etc/ajspay/migrate.cnf ]]; then
  echo "/etc/ajspay/migrate.cnf already exists; leaving it alone."
  exit 0
fi

pass=$(openssl rand -hex 24)
mariadb -e "CREATE USER IF NOT EXISTS 'ajspay_migrate'@'localhost' IDENTIFIED BY '$pass';
  GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, DROP, REFERENCES ON ajspay.* TO 'ajspay_migrate'@'localhost';
  FLUSH PRIVILEGES;"

umask 077
printf '[client]\nuser=ajspay_migrate\npassword=%s\n' "$pass" > /etc/ajspay/migrate.cnf
chown root:ajspay-deploy /etc/ajspay/migrate.cnf
chmod 640 /etc/ajspay/migrate.cnf
chmod 751 /etc/ajspay

echo "Done. The deploy can now apply migrations."
echo "The application user still has no DDL rights:"
mariadb -e "SHOW GRANTS FOR 'ajspay'@'localhost';" | tail -1
