<?php
// AJSPay: business parameters. Every rate, fee and limit that used to be a PHP
// constant lives here instead -- a real table, not another key buried in
// system_config's JSON blob -- so the bank owner can list, search, filter,
// create, edit and delete them without a deploy touching code.
//
// One invariant does not bend for this table: a 'deposit_rates' row can never
// be saved above the Nidhi Rules cap, no matter what its own min/max say. That
// check lives here, at the one place these values are ever written, rather
// than trusted to every caller that reads one.
declare(strict_types=1);

const PARAM_READ_ROLES = ['admin', 'branch_manager', 'bank_owner'];
const PARAM_WRITE_ROLES = ['bank_owner'];
const PARAM_CATEGORIES = ['loan_rates', 'deposit_rates', 'fees', 'limits', 'program'];

// Read one parameter's value by key, falling back to the code default when the
// row has been deleted or was never seeded -- so removing a row degrades to a
// sane number instead of breaking the caller.
function param_value(string $key, float $default): float
{
    $row = row('SELECT value FROM system_parameters WHERE param_key = ?', [$key]);
    return $row ? (float)$row['value'] : $default;
}

function param_public(array $row): array
{
    return [
        'id' => $row['id'], 'param_key' => $row['param_key'], 'label' => $row['label'],
        'category' => $row['category'], 'value' => (float)$row['value'], 'unit' => $row['unit'],
        'min_value' => $row['min_value'] === null ? null : (float)$row['min_value'],
        'max_value' => $row['max_value'] === null ? null : (float)$row['max_value'],
        'description' => $row['description'],
        'nidhi_capped' => $row['category'] === 'deposit_rates',
        'updated_by' => $row['updated_by'], 'updated_at' => iso($row['updated_at']),
        'created_at' => iso($row['created_at']),
    ];
}

// Bounds a save must clear: the row's own min/max, and -- for a deposit rate,
// always -- the Nidhi Rules cap, independent of whatever max_value the row
// itself carries. A row's own max can be loosened by an edit; the Nidhi cap
// cannot.
function param_validate_value(float $value, ?float $min, ?float $max, string $category): void
{
    if ($min !== null && $value < $min) {
        fail(422, "Value must be at least $min.");
    }
    if ($max !== null && $value > $max) {
        fail(422, "Value must be at most $max.");
    }
    if ($category === 'deposit_rates' && $value > NIDHI_MAX_DEPOSIT_RATE) {
        fail(422, sprintf('Deposit rate parameters cannot be saved above the %.1f%% Nidhi Rules cap.',
            NIDHI_MAX_DEPOSIT_RATE));
    }
}

function route_parameters_list(array $d): void
{
    staff_user(PARAM_READ_ROLES);
    $where = ' WHERE 1 = 1';
    $params = [];
    $category = clip($_GET['category'] ?? '', 40);
    if ($category !== '') {
        $where .= ' AND category = ?';
        $params[] = $category;
    }
    $q = clip($_GET['q'] ?? '', 80);
    if ($q !== '') {
        $where .= ' AND (param_key LIKE ? OR label LIKE ? OR description LIKE ?)';
        $like = "%$q%";
        array_push($params, $like, $like, $like);
    }
    $sortable = ['param_key', 'label', 'category', 'value', 'updated_at'];
    $sort = in_array($_GET['sort'] ?? '', $sortable, true) ? $_GET['sort'] : 'category';
    $dir = strtolower($_GET['dir'] ?? 'asc') === 'desc' ? 'DESC' : 'ASC';
    [$rows, $meta] = paginate("SELECT * FROM system_parameters$where ORDER BY $sort $dir, param_key", $params, 20, 100);
    respond(['parameters' => array_map('param_public', $rows), 'meta' => $meta,
        'categories' => PARAM_CATEGORIES, 'nidhi_cap' => NIDHI_MAX_DEPOSIT_RATE]);
}

function route_parameter_create(array $d): void
{
    global $pdo;
    $owner = staff_user(PARAM_WRITE_ROLES);
    need($d, 'param_key', 'label', 'category', 'value');
    $key = strtolower(clip($d['param_key'], 60));
    if (!preg_match('/\A[a-z][a-z0-9_]{2,59}\z/', $key)) {
        fail(422, 'Key must be lowercase letters, numbers and underscores, starting with a letter.');
    }
    if (row('SELECT id FROM system_parameters WHERE param_key = ?', [$key])) {
        fail(400, 'A parameter with this key already exists.');
    }
    $category = clip($d['category'], 40);
    if (!in_array($category, PARAM_CATEGORIES, true)) {
        fail(422, 'category must be one of: ' . implode(', ', PARAM_CATEGORIES) . '.');
    }
    $min = isset($d['min_value']) && $d['min_value'] !== '' ? money($d['min_value']) : null;
    $max = isset($d['max_value']) && $d['max_value'] !== '' ? money($d['max_value']) : null;
    $value = money($d['value']);
    param_validate_value($value, $min, $max, $category);
    $row = [
        'id' => uuid4(), 'param_key' => $key, 'label' => clip($d['label'], 150), 'category' => $category,
        'value' => $value, 'unit' => clip($d['unit'] ?? '', 20), 'min_value' => $min, 'max_value' => $max,
        'description' => clip($d['description'] ?? '', 255) ?: null, 'updated_by' => $owner['email'],
    ];
    $columns = implode(', ', array_keys($row));
    $holders = rtrim(str_repeat('?, ', count($row)), ', ');
    $pdo->prepare("INSERT INTO system_parameters ($columns) VALUES ($holders)")->execute(array_values($row));
    audit($owner, 'PARAMETER_CREATED', "$key = $value");
    respond(['status' => 'SUCCESS', 'message' => "Parameter $key created.",
        'parameter' => param_public(row('SELECT * FROM system_parameters WHERE id = ?', [$row['id']]))]);
}

function route_parameter_update(array $d, string $id = ''): void
{
    global $pdo;
    $owner = staff_user(PARAM_WRITE_ROLES);
    $existing = row('SELECT * FROM system_parameters WHERE id = ?', [$id]);
    if (!$existing) {
        fail(404, 'Parameter not found.');
    }
    $label = isset($d['label']) ? clip($d['label'], 150) : $existing['label'];
    $unit = isset($d['unit']) ? clip($d['unit'], 20) : $existing['unit'];
    $description = isset($d['description']) ? (clip($d['description'], 255) ?: null) : $existing['description'];
    $min = array_key_exists('min_value', $d)
        ? ($d['min_value'] === '' || $d['min_value'] === null ? null : money($d['min_value']))
        : ($existing['min_value'] === null ? null : (float)$existing['min_value']);
    $max = array_key_exists('max_value', $d)
        ? ($d['max_value'] === '' || $d['max_value'] === null ? null : money($d['max_value']))
        : ($existing['max_value'] === null ? null : (float)$existing['max_value']);
    $value = isset($d['value']) ? money($d['value']) : (float)$existing['value'];
    param_validate_value($value, $min, $max, $existing['category']);
    $pdo->prepare('UPDATE system_parameters SET label = ?, unit = ?, description = ?, min_value = ?, max_value = ?,
            value = ?, updated_by = ? WHERE id = ?')
        ->execute([$label, $unit, $description, $min, $max, $value, $owner['email'], $id]);
    audit($owner, 'PARAMETER_UPDATED', "{$existing['param_key']} = $value");
    respond(['status' => 'SUCCESS', 'message' => "Parameter {$existing['param_key']} updated.",
        'parameter' => param_public(row('SELECT * FROM system_parameters WHERE id = ?', [$id]))]);
}

function route_parameter_delete(array $d, string $id = ''): void
{
    global $pdo;
    $owner = staff_user(PARAM_WRITE_ROLES);
    $existing = row('SELECT * FROM system_parameters WHERE id = ?', [$id]);
    if (!$existing) {
        fail(404, 'Parameter not found.');
    }
    $pdo->prepare('DELETE FROM system_parameters WHERE id = ?')->execute([$id]);
    audit($owner, 'PARAMETER_DELETED', $existing['param_key']);
    respond(['status' => 'SUCCESS',
        'message' => "Parameter {$existing['param_key']} deleted. Callers fall back to the code default."]);
}
