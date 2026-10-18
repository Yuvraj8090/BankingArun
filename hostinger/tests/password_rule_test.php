<?php
// Members may use simple passwords (6+); staff accounts keep 8+ and the breach check.
define('AJSPAY_CRON', 1);  // fail() throws instead of responding
require __DIR__ . '/../db.php';
require __DIR__ . '/../modules/security.php';
$ok = fn($p, $ctx = [], $strict = false) => (function () use ($p, $ctx, $strict) {
    try { assert_password_acceptable($p, $ctx, $strict); return true; } catch (RuntimeException) { return false; }
})();
assert($ok('1234567') && $ok('123456') && $ok('password'));
assert(!$ok('12345') && !$ok(str_repeat('a', 73)) && !$ok(null));
assert(!$ok('ravi1234', ['Ravi']));
assert(!$ok('1234567', [], true));  // staff: still 8+ (breach check needs network, not tested here)
echo "ok\n";
