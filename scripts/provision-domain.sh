#!/usr/bin/env bash
# One-time root setup on the VPS: domain, certificate, atomic-swap document root
# and backup credentials. Safe to re-run. Run as root ON THE VPS.
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Run as root" >&2; exit 1; }
domain=ajspay.co.in
legacy=srv1983286.hstgr.cloud

for name in "$domain" "www.$domain"; do
  ip=$(dig +short "$name" A | tail -1)
  [[ "$ip" == "89.116.134.116" ]] || { echo "$name resolves to '$ip', not the VPS" >&2; exit 1; }
done

install -d -m 755 /var/www/acme
cat > /etc/apache2/sites-available/ajspay-http.conf <<EOF
<VirtualHost *:80>
    ServerName $domain
    ServerAlias www.$domain $legacy 89.116.134.116
    DocumentRoot /var/www/acme

    <Directory /var/www/acme>
        Require all granted
        Options -Indexes
    </Directory>

    RewriteEngine On
    RewriteCond %{REQUEST_URI} !^/\.well-known/acme-challenge/
    RewriteRule ^ https://$domain%{REQUEST_URI} [R=301,L]
</VirtualHost>
EOF
apache2ctl configtest && systemctl reload apache2

certbot certonly --webroot -w /var/www/acme --cert-name ajspay --expand \
  --non-interactive --agree-tos --keep-until-expiring \
  -d "$domain" -d "www.$domain" -d "$legacy"

# Seed the release structure from the currently-served directory BEFORE the
# document root moves, so the site keeps answering throughout the switch.
if [[ ! -L /srv/ajspay/current ]]; then
  seed="/srv/ajspay/releases/seed-$(date -u +%Y%m%dT%H%M%SZ)"
  install -d -m 755 "$seed"
  cp -a /var/www/ajspay/. "$seed/"
  rm -f "$seed/config.local.php"
  ln -s /etc/ajspay/config.local.php "$seed/config.local.php"
  chown -R ajspay-deploy:ajspay-deploy "$seed"
  ln -s "$seed" /srv/ajspay/current.next
  mv -Tf /srv/ajspay/current.next /srv/ajspay/current
  chown -h ajspay-deploy:ajspay-deploy /srv/ajspay/current
fi
chmod 755 /srv/ajspay /srv/ajspay/releases

cat > /etc/apache2/sites-available/ajspay-ssl.conf <<EOF
<VirtualHost *:443>
    ServerName $domain
    ServerAlias www.$domain $legacy
    # A symlink swapped by the deploy script: releases go live atomically.
    DocumentRoot /srv/ajspay/current

    SSLEngine on
    SSLCertificateFile    /etc/letsencrypt/live/ajspay/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/ajspay/privkey.pem
    SSLProtocol -all +TLSv1.2 +TLSv1.3
    SSLHonorCipherOrder off

    # www and the old hostname 301 to the apex, so CORS, cookies and passkeys
    # only ever see one origin. Runs before .htaccess.
    RewriteEngine On
    RewriteCond %{HTTP_HOST} !^${domain//./\\.}\$ [NC]
    RewriteRule ^ https://$domain%{REQUEST_URI} [R=301,L]

    # Covers both the 'current' symlink used as DocumentRoot and the real
    # release path behind it; granting on only one of the two leaves Apache
    # falling through to the global "Require all denied" and serving 403s.
    <Directory /srv/ajspay>
        Options -Indexes +FollowSymLinks
        AllowOverride All
        Require all granted
    </Directory>

    <FilesMatch "^(db|config\.local|cron)\.php\$">
        Require all denied
    </FilesMatch>
    <FilesMatch "\.(sql|md|log|env|ini|bak)\$">
        Require all denied
    </FilesMatch>
    <DirectoryMatch "^/srv/ajspay/(current|releases/[^/]+)/(modules|assets)">
        Require all denied
    </DirectoryMatch>

    <FilesMatch "\.php\$">
        SetHandler "proxy:unix:/run/php/php8.5-fpm.sock|fcgi://localhost"
    </FilesMatch>

    ErrorLog  \${APACHE_LOG_DIR}/ajspay-error.log
    CustomLog \${APACHE_LOG_DIR}/ajspay-access.log combined
</VirtualHost>
EOF
apache2ctl configtest && systemctl reload apache2

# The config the site is actually being served with wins. A hand-uploaded
# document root carries its own config.local.php, whose credentials may have
# moved on from the ones written when the box was first provisioned; adopting
# the served copy is what keeps the database reachable after the swap.
if [[ -f /var/www/ajspay/config.local.php ]]; then
  cp -n /etc/ajspay/config.local.php /root/config.local.php.provisioned.bak || true
  cp -f /var/www/ajspay/config.local.php /etc/ajspay/config.local.php
  chown root:www-data /etc/ajspay/config.local.php
  chmod 640 /etc/ajspay/config.local.php
fi

# Point the application at its own domain. Passkeys registered against the old
# hostname stop working and must be re-enrolled; passwords are unaffected.
cp -n /etc/ajspay/config.local.php /root/config.local.php.bak || true
sed -i "s/$legacy/$domain/g; s/89\.116\.134\.116/$domain/g" /etc/ajspay/config.local.php

# A dump-only database user, so backups never need the application's password.
if [[ ! -f /etc/ajspay/backup.cnf ]]; then
  pass=$(openssl rand -hex 24)
  mariadb -e "CREATE USER IF NOT EXISTS 'ajspay_backup'@'localhost' IDENTIFIED BY '$pass';
              GRANT SELECT, LOCK TABLES, SHOW VIEW, EVENT, TRIGGER ON ajspay.* TO 'ajspay_backup'@'localhost';
              FLUSH PRIVILEGES;"
  umask 077
  printf '[mariadb-dump]\nuser=ajspay_backup\npassword=%s\n' "$pass" > /etc/ajspay/backup.cnf
  chown root:ajspay-deploy /etc/ajspay/backup.cnf
  chmod 640 /etc/ajspay/backup.cnf
fi
# The directory is root:www-data 750, which the deploy account cannot traverse,
# so backup.cnf stayed unreadable however its own mode was set. 751 lets it
# through to the file it owns without making the directory listable, and
# config.local.php stays 640 root:www-data and out of reach.
chmod 751 /etc/ajspay

# Apache passes SCRIPT_FILENAME as /srv/ajspay/current/..., a path that never
# changes across a release swap, so OPcache keeps serving the previous
# release's bytecode until the pool is reloaded. The deploy account is allowed
# that one command and nothing else.
printf 'ajspay-deploy ALL=(root) NOPASSWD: /usr/bin/systemctl reload php8.5-fpm\n' > /etc/sudoers.d/ajspay-deploy
chmod 440 /etc/sudoers.d/ajspay-deploy
visudo -c -q -f /etc/sudoers.d/ajspay-deploy
install -d -m 700 -o ajspay-deploy -g ajspay-deploy /srv/ajspay/backups

# A read-only login for querying production over an SSH tunnel. MariaDB stays
# bound to localhost and 3306 is never opened to the network; the tunnel is what
# makes it reachable from anywhere. The password is written to a root-only file
# rather than echoed, so it stays out of shell history and scrollback.
if [[ ! -f /root/db-readonly.txt ]]; then
  rpass=$(openssl rand -hex 24)
  mariadb -e "CREATE USER IF NOT EXISTS 'ajspay_read'@'localhost' IDENTIFIED BY '$rpass';
              GRANT SELECT ON ajspay.* TO 'ajspay_read'@'localhost';
              FLUSH PRIVILEGES;"
  umask 077
  printf 'host=127.0.0.1\nport=3306\ndatabase=ajspay\nuser=ajspay_read\npassword=%s\n' "$rpass" > /root/db-readonly.txt
  chmod 600 /root/db-readonly.txt
fi

# Confirm the database is not listening on anything but loopback.
ss -ltnp 2>/dev/null | awk '$4 ~ /:3306$/ {print "mariadb listening on " $4}'

echo "Done. Verify: curl -I https://$domain/  and  curl -I https://www.$domain/"
