<?php
declare(strict_types=1);

require __DIR__ . '/../modules/master.php';

$xml = <<<'XML'
<Envelope xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">
  <Cube><Cube time="2026-09-18">
    <Cube currency="USD" rate="1.2"/>
    <Cube currency="INR" rate="100"/>
  </Cube></Cube>
</Envelope>
XML;

$rate = ecb_usd_inr_from_xml($xml);
if ($rate !== ['rate' => 83.3333, 'as_of' => '2026-09-18'] || ecb_usd_inr_from_xml('<bad>') !== null) {
    throw new RuntimeException('ECB USD/INR parser failed');
}

echo "market rates parser ok\n";
