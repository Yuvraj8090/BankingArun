<?php
// AJSPay: account statements as PDF and Excel. Generated without third-party
// libraries: a plain PDF 1.4 writer and a minimal Office Open XML workbook.
declare(strict_types=1);

const PDF_W = 595.28;  // A4 in points
const PDF_H = 841.89;
const PDF_M = 42.5;    // 15 mm margins
const PDF_ROW = 14.0;
const PDF_BLUE = [0.043, 0.231, 0.549];
// width (pt), heading, alignment, max characters
const PDF_COLS = [[50, 'Date', 'l', 10], [108, 'Ref No', 'l', 25], [42, 'Mode', 'l', 11], [138, 'Description', 'l', 38],
    [54, 'Debit (Rs.)', 'r', 0], [54, 'Credit (Rs.)', 'r', 0], [64, 'Balance (Rs.)', 'r', 0]];

// The long mode codes do not fit the PDF's narrow column ("DEPOSIT_INTE…"), so the deposit ones read short.
function statement_mode(string $mode): string
{
    return ['DEPOSIT_INTEREST' => 'Interest', 'DEPOSIT_MATURITY' => 'Maturity', 'DEPOSIT_BOOKING' => 'Deposit',
        'DEPOSIT_PREMATURE_CLOSURE' => 'Early close', 'SHARE_ALLOTMENT' => 'Shares', 'LOAN_DISBURSAL' => 'Loan', 'LOAN_EMI' => 'EMI', 'DEPOSIT_INSTALMENT' => 'Instalment'][$mode] ?? $mode;
}

// Account number and dates arrive in the POST body, never in the URL.
function statement_request(array $d): array
{
    $user = current_user();
    need($d, 'account_number');
    $account = owned_account($user, $d['account_number']);
    if (!$account) {
        fail(404, 'Account not found');
    }
    $start = empty($d['start']) ? null : valid_date($d['start'], 'start');
    $end = empty($d['end']) ? null : valid_date($d['end'], 'end');
    $sql = 'SELECT * FROM transactions WHERE user_id = ? AND account_number = ?';
    $params = [$user['id'], $account['account_number']];
    if ($start) {
        $sql .= ' AND timestamp >= ?';
        $params[] = "$start 00:00:00";
    }
    if ($end) {
        $sql .= ' AND timestamp <= ?';
        $params[] = "$end 23:59:59";
    }
    audit($user, 'STATEMENT_DOWNLOADED', $account['account_number'] . ' ' . ($start ?? 'all') . '..' . ($end ?? 'today'));
    return [$user, $account, rows("$sql ORDER BY timestamp DESC, id LIMIT 500", $params), $start, $end];
}

function statement_filename(array $account, ?string $start, ?string $end, string $ext): string
{
    return 'stmt_' . $account['account_number'] . '_' . str_replace('-', '', $start ?? '') . '_'
        . str_replace('-', '', $end ?? '') . ".$ext";
}

function route_statement_pdf(array $d): void
{
    [$user, $account, $txns, $start, $end] = statement_request($d);
    send_download(statement_pdf($user, $account, $txns, $start, $end), 'application/pdf',
        statement_filename($account, $start, $end, 'pdf'));
}

function route_statement_excel(array $d): void
{
    [$user, $account, $txns, $start, $end] = statement_request($d);
    send_download(statement_xlsx($user, $account, $txns, $start, $end),
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', statement_filename($account, $start, $end, 'xlsx'));
}

// --- PDF --------------------------------------------------------------------------------
// Core Helvetica only covers Windows-1252, so the rupee sign becomes "Rs.".
function pdf_text(string $s): string
{
    $s = iconv('UTF-8', 'Windows-1252//TRANSLIT//IGNORE', str_replace('₹', 'Rs.', $s)) ?: '';
    return strtr($s, ['\\' => '\\\\', '(' => '\\(', ')' => '\\)', "\r" => '', "\n" => ' ']);
}

function pdf_line(string $font, float $size, float $x, float $y, string $text, array $rgb = [0.1, 0.1, 0.12]): string
{
    return sprintf("BT %.3F %.3F %.3F rg /%s %.1F Tf %.2F %.2F Td (%s) Tj ET\n", $rgb[0], $rgb[1], $rgb[2], $font, $size,
        $x, $y, pdf_text($text));
}

function pdf_rect(float $x, float $y, float $w, float $h, array $rgb): string
{
    return sprintf("%.3F %.3F %.3F rg %.2F %.2F %.2F %.2F re f\n", $rgb[0], $rgb[1], $rgb[2], $x, $y, $w, $h);
}

// Helvetica advance widths for the characters that appear in amounts.
function pdf_number_width(string $s, float $size): float
{
    $units = 0;
    foreach (str_split($s) as $ch) {
        $units += ($ch === ',' || $ch === '.') ? 278 : 556;
    }
    return $units * $size / 1000;
}

function pdf_row(array $cells, float $y, string $font, array $rgb): string
{
    $ops = '';
    $x = PDF_M;
    foreach (PDF_COLS as $i => [$width, , $align, $max]) {
        $text = (string)($cells[$i] ?? '');
        if ($max && mb_strlen($text) > $max) {
            $text = mb_substr($text, 0, $max - 1) . '…';
        }
        $tx = $align === 'r' ? $x + $width - 4 - pdf_number_width($text, 7.5) : $x + 3;
        $ops .= pdf_line($font, 7.5, $tx, $y - 9.8, $text, $rgb);
        $x += $width;
    }
    return $ops;
}

function pdf_table_header(float $y): string
{
    return pdf_rect(PDF_M, $y - PDF_ROW, 510, PDF_ROW, PDF_BLUE)
        . pdf_row(array_column(PDF_COLS, 1), $y, 'F2', [1, 1, 1]);
}

function statement_pdf(array $user, array $account, array $txns, ?string $start, ?string $end): string
{
    $logo = dirname(__DIR__) . '/assets/statement-logo.jpg';
    $image = is_file($logo) ? [$logo, ...array_slice(getimagesize($logo) ?: [0, 0], 0, 2)] : null;
    $pages = [];
    $ops = '';
    $y = PDF_H - PDF_M;
    if ($image && $image[1] > 0) {
        $h = 40;
        $w = $image[1] * $h / $image[2];
        $ops .= sprintf("q %.2F 0 0 %.2F %.2F %.2F cm /Im1 Do Q\n", $w, $h, PDF_M, $y - $h);
        $y -= $h + 14;
    }
    $ops .= pdf_line('F2', 13, PDF_M, $y - 12, 'Account Statement - ' . $account['account_number'], PDF_BLUE);
    $y -= 28;
    foreach ([
        'Customer: ' . $user['name'],
        'Account Type: ' . ucfirst($account['account_type']) . ' | Branch code: ' . $account['ifsc_code'],
        'Period: ' . ($start ?? 'All') . ' to ' . ($end ?? 'today') . ' | Generated: ' . gmdate('d-M-Y H:i') . ' UTC',
    ] as $line) {
        $ops .= pdf_line('F1', 8.5, PDF_M, $y, $line, [0.2, 0.25, 0.33]);
        $y -= 12;
    }
    $y -= 8;
    $ops .= pdf_table_header($y);
    $y -= PDF_ROW;
    foreach ($txns as $i => $t) {
        if ($y - PDF_ROW < PDF_M + 30) {
            $pages[] = $ops;
            $ops = '';
            $y = PDF_H - PDF_M;
            $ops .= pdf_table_header($y);
            $y -= PDF_ROW;
        }
        if ($i % 2) {
            $ops .= pdf_rect(PDF_M, $y - PDF_ROW, 510, PDF_ROW, [0.973, 0.98, 0.988]);
        }
        $amount = number_format((float)$t['amount'], 2);
        $ops .= pdf_row([substr($t['timestamp'], 0, 10), $t['ref_number'], statement_mode($t['mode']), $t['description'] ?? '',
            $t['type'] === 'debit' ? $amount : '', $t['type'] === 'credit' ? $amount : '',
            number_format((float)$t['balance_after'], 2)], $y, 'F1', [0.1, 0.1, 0.12]);
        $y -= PDF_ROW;
    }
    if (!$txns) {
        $ops .= pdf_line('F1', 8, PDF_M + 3, $y - 12, 'No transactions in this period.', [0.4, 0.45, 0.5]);
        $y -= PDF_ROW;
    }
    if ($y < PDF_M + 50) {
        $pages[] = $ops;
        $ops = '';
        $y = PDF_H - PDF_M;
    }
    $ops .= pdf_line('F1', 7, PDF_M, $y - 18, 'TDS is deducted on interest under Section 194A of the Income-tax Act, 1961 where applicable.', [0.3, 0.33, 0.4]);
    $ops .= pdf_line('F1', 7, PDF_M, $y - 28, 'This is a system-generated statement and does not require a signature. For queries, call 1800-123-4567.', [0.3, 0.33, 0.4]);
    $pages[] = $ops;
    return pdf_assemble($pages, $image);
}

function pdf_assemble(array $pages, ?array $image): string
{
    $objects = [
        1 => '<< /Type /Catalog /Pages 2 0 R >>',
        3 => '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
        4 => '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
        5 => 'null',
    ];
    $xobject = '';
    if ($image) {
        [$path, $w, $h] = $image;
        $jpeg = file_get_contents($path);
        $objects[5] = "<< /Type /XObject /Subtype /Image /Width $w /Height $h /ColorSpace /DeviceRGB /BitsPerComponent 8"
            . ' /Filter /DCTDecode /Length ' . strlen($jpeg) . " >>\nstream\n$jpeg\nendstream";
        $xobject = ' /XObject << /Im1 5 0 R >>';
    }
    $kids = [];
    $n = 6;
    foreach ($pages as $i => $ops) {
        $ops .= pdf_line('F1', 7, PDF_W - PDF_M - 55, PDF_M - 18, sprintf('Page %d of %d', $i + 1, count($pages)), [0.4, 0.45, 0.5]);
        $objects[$n] = '<< /Length ' . strlen($ops) . " >>\nstream\n$ops\nendstream";
        $objects[$n + 1] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' . PDF_W . ' ' . PDF_H . ']'
            . " /Resources << /Font << /F1 3 0 R /F2 4 0 R >>$xobject >> /Contents $n 0 R >>";
        $kids[] = ($n + 1) . ' 0 R';
        $n += 2;
    }
    $objects[2] = '<< /Type /Pages /Kids [' . implode(' ', $kids) . '] /Count ' . count($pages) . ' >>';
    ksort($objects);
    $pdf = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
    $offsets = [];
    foreach ($objects as $num => $body) {
        $offsets[$num] = strlen($pdf);
        $pdf .= "$num 0 obj\n$body\nendobj\n";
    }
    $xref = strlen($pdf);
    $pdf .= "xref\n0 " . (count($objects) + 1) . "\n0000000000 65535 f \n";
    foreach ($offsets as $offset) {
        $pdf .= sprintf("%010d 00000 n \n", $offset);
    }
    return $pdf . 'trailer << /Size ' . (count($objects) + 1) . " /Root 1 0 R >>\nstartxref\n$xref\n%%EOF\n";
}

// --- Excel (.xlsx) ----------------------------------------------------------------------
// Cell styles: 0 normal, 1 title, 2 subtitle, 3 table header, 4 money.
function xlsx_cell(string $ref, mixed $value, int $style): string
{
    if ($value === null || $value === '') {
        return '';
    }
    if (is_int($value) || is_float($value)) {
        return "<c r=\"$ref\" s=\"$style\"><v>$value</v></c>";
    }
    $text = htmlspecialchars((string)$value, ENT_XML1 | ENT_QUOTES, 'UTF-8');
    return "<c r=\"$ref\" s=\"$style\" t=\"inlineStr\"><is><t xml:space=\"preserve\">$text</t></is></c>";
}

function xlsx_sheet(array $rows, array $widths = []): string
{
    $xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        . '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">';
    if ($widths) {
        $xml .= '<cols>';
        foreach ($widths as $i => $w) {
            $xml .= '<col min="' . ($i + 1) . '" max="' . ($i + 1) . "\" width=\"$w\" customWidth=\"1\"/>";
        }
        $xml .= '</cols>';
    }
    $xml .= '<sheetData>';
    foreach ($rows as $r => $cells) {
        $xml .= '<row r="' . ($r + 1) . '">';
        foreach ($cells as $c => [$value, $style]) {
            $xml .= xlsx_cell(chr(65 + $c) . ($r + 1), $value, $style);
        }
        $xml .= '</row>';
    }
    return $xml . '</sheetData></worksheet>';
}

// A one-sheet .xlsx from rows of [value, style] pairs. Styles: 0 normal,
// 1 title, 2 subtitle, 3 header, 4 money. Shared with the report exports.
function xlsx_workbook(string $sheetName, array $rows, array $widths = []): string
{
    $name = htmlspecialchars(mb_substr($sheetName, 0, 31), ENT_XML1 | ENT_QUOTES, 'UTF-8');
    $files = [
        '[Content_Types].xml' => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
        '_rels/.rels' => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
        'xl/workbook.xml' => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="' . $name . '" sheetId="1" r:id="rId1"/></sheets></workbook>',
        'xl/_rels/workbook.xml.rels' => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
        'xl/styles.xml' => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts><fonts count="4"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><color rgb="FF0B3B8C"/><name val="Calibri"/></font><font><b/><sz val="12"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0B3B8C"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="3" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>',
        'xl/worksheets/sheet1.xml' => xlsx_sheet($rows, $widths),
    ];
    $tmp = tempnam(sys_get_temp_dir(), 'xlsx');
    $zip = new ZipArchive();
    $zip->open($tmp, ZipArchive::OVERWRITE);
    foreach ($files as $file => $xml) {
        $zip->addFromString($file, $xml);
    }
    $zip->close();
    $bytes = file_get_contents($tmp);
    unlink($tmp);
    return $bytes;
}

function statement_xlsx(array $user, array $account, array $txns, ?string $start, ?string $end): string
{
    $rows = [
        [['Aadhunik Jeewan Sanchay Nidhi Limited', 1]],
        [['Account Statement — ' . $account['account_number'], 2]],
        [['Customer: ' . $user['name'] . ' · Type: ' . ucfirst($account['account_type']) . ' · Branch code: ' . $account['ifsc_code'], 0]],
        [['Period: ' . ($start ?? 'All') . ' → ' . ($end ?? 'today') . ' · Generated: ' . gmdate('d-M-Y H:i') . ' UTC', 0]],
        [],
        array_map(fn($h) => [$h, 3], ['Date', 'Ref No', 'Mode', 'Description', 'Debit (INR)', 'Credit (INR)', 'Balance (INR)']),
    ];
    foreach ($txns as $t) {
        $amount = (float)$t['amount'];
        $rows[] = [[substr($t['timestamp'], 0, 10), 0], [$t['ref_number'], 0], [statement_mode($t['mode']), 0],
            [mb_substr($t['description'] ?? '', 0, 120), 0], [$t['type'] === 'debit' ? $amount : '', 4],
            [$t['type'] === 'credit' ? $amount : '', 4], [(float)$t['balance_after'], 4]];
    }
    $files = [
        '[Content_Types].xml' => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
        '_rels/.rels' => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
        'xl/workbook.xml' => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Statement" sheetId="1" r:id="rId1"/><sheet name="TDS Note" sheetId="2" r:id="rId2"/></sheets></workbook>',
        'xl/_rels/workbook.xml.rels' => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
        'xl/styles.xml' => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts><fonts count="4"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><color rgb="FF0B3B8C"/><name val="Calibri"/></font><font><b/><sz val="12"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0B3B8C"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="3" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>',
        'xl/worksheets/sheet1.xml' => xlsx_sheet($rows, [12, 28, 16, 56, 16, 16, 18]),
        'xl/worksheets/sheet2.xml' => xlsx_sheet([
            [['TDS is deducted on interest under Section 194A of the Income-tax Act, 1961 where applicable.', 0]],
        ], [90]),
    ];
    $tmp = tempnam(sys_get_temp_dir(), 'xlsx');
    $zip = new ZipArchive();
    $zip->open($tmp, ZipArchive::OVERWRITE);
    foreach ($files as $name => $xml) {
        $zip->addFromString($name, $xml);
    }
    $zip->close();
    $bytes = file_get_contents($tmp);
    unlink($tmp);
    return $bytes;
}
