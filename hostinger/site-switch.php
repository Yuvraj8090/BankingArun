<?php
// The owner's off/on switch for the whole site, reached through
// /site/off/<key> and /site/on/<key> (see .htaccess). While the switch file is
// non-empty, Apache and the Python service answer every request with 503.
//
// Only the key's SHA-256 lives here; the key itself is only in the URLs.
// Opening a URL shows a button and only the button's POST flips the switch,
// so a chat app fetching a link preview can never turn the site off.
const SWITCH_KEY_SHA256 = '4e6c8e5f29361dab38b15d2a3dfdabfce57e40245e8119ce4f80d69443c4d2d1';
const SWITCH_FILE = '/srv/ajspay/site-down';  // created 0666 by deploy-vps.sh

header('Cache-Control: no-store');
header('X-Robots-Tag: noindex');
header('Content-Type: text/html; charset=utf-8');

$do = $_GET['do'] ?? '';
if (!in_array($do, ['on', 'off'], true)
    || !hash_equals(SWITCH_KEY_SHA256, hash('sha256', (string)($_GET['k'] ?? '')))) {
    http_response_code(404);
    exit('Not Found');
}

$note = '';
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    if (file_put_contents(SWITCH_FILE, $do === 'off' ? '1' : '', LOCK_EX) === false) {
        http_response_code(500);
        exit('Could not write ' . SWITCH_FILE . '. Deploy once so it exists and is writable.');
    }
    $note = $do === 'off' ? 'Done: the site is now OFF.' : 'Done: the site is now ON.';
}
clearstatcache();
$state = @filesize(SWITCH_FILE) ? 'OFF' : 'ON';
$button = $do === 'off' ? 'Turn the site OFF' : 'Turn the site ON';
?>
<!doctype html>
<html lang="en">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Site switch</title>
<body style="font-family: system-ui, sans-serif; max-width: 28rem; margin: 3rem auto; padding: 0 1rem">
<h1>Site switch</h1>
<p>The site is currently <strong><?= $state ?></strong>.</p>
<?php if ($note !== ''): ?><p role="status"><?= $note ?></p><?php endif; ?>
<form method="post">
    <button type="submit" style="font-size: 1.1rem; padding: .7rem 1.2rem"><?= $button ?></button>
</form>
</body>
</html>
