/**
 * testUpgatesApi.js
 * Testovací skript — ověří připojení k Upgates API a vypíše strukturu dat.
 *
 * Spuštění:  node scripts/testUpgatesApi.js
 *
 * Načítá přihlašovací údaje z .env.local:
 *   UPGATES_API_URL   — https://tvujprojekt.admin.server.upgates.com/api/v2
 *   UPGATES_LOGIN     — login z administrace Upgates
 *   UPGATES_API_KEY   — API klíč z administrace Upgates
 */

const https = require('https');
const fs    = require('fs');
const path  = require('path');

// ── Načtení .env.local ────────────────────────────────────────────────────────
function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(envPath)) {
    console.error('❌  .env.local nenalezen:', envPath);
    process.exit(1);
  }
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (val && !process.env[key]) process.env[key] = val;
  }
}

loadEnv();

const API_URL   = process.env.UPGATES_API_URL;
const LOGIN     = process.env.UPGATES_LOGIN;
const API_KEY   = process.env.UPGATES_API_KEY;

if (!API_URL || !LOGIN || !API_KEY) {
  console.error('❌  Chybí env proměnné. Zkontroluj .env.local:');
  console.error('   UPGATES_API_URL, UPGATES_LOGIN, UPGATES_API_KEY');
  process.exit(1);
}

// ── HTTP helper ───────────────────────────────────────────────────────────────
function apiGet(endpoint) {
  return new Promise((resolve, reject) => {
    const url      = `${API_URL.replace(/\/$/, '')}${endpoint}`;
    const auth     = Buffer.from(`${LOGIN}:${API_KEY}`).toString('base64');
    const parsed   = new URL(url);

    const options = {
      hostname: parsed.hostname,
      path:     parsed.pathname + parsed.search,
      method:   'GET',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type':  'application/json',
        'Accept':        'application/json',
      },
    };

    https.request(options, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
        }
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error(`JSON parse error: ${body.slice(0, 200)}`));
        }
      });
      res.on('error', reject);
    }).on('error', reject).end();
  });
}

// ── Hlavní test ───────────────────────────────────────────────────────────────
async function main() {
  console.log('\n🔌  Upgates API — testovací připojení');
  console.log('   URL:', API_URL);
  console.log('   Login:', LOGIN);
  console.log('');

  // 1) Stránka 1 objednávek — max 1 záznam pro přehled struktury
  console.log('── 1) Stahování první stránky objednávek (limit=1) ──────────────');
  let firstOrder;
  try {
    const data = await apiGet('/orders?page=1&limit=1');
    console.log('✅  Odpověď OK');
    console.log('   Klíče v odpovědi:', Object.keys(data).join(', '));

    // Zjistíme celkový počet objednávek pokud API vrací metadata
    if (data.total_count !== undefined) console.log('   Celkem objednávek:', data.total_count);
    if (data.pages       !== undefined) console.log('   Celkem stránek:', data.pages);
    if (data.count       !== undefined) console.log('   Vráceno záznamů:', data.count);

    // Najdeme pole s objednávkami (orders / data / items…)
    const ordersKey = ['orders', 'data', 'items', 'results'].find(k => Array.isArray(data[k]));
    if (!ordersKey) {
      console.log('\n⚠️  Neznámá struktura odpovědi. Kompletní JSON:');
      console.log(JSON.stringify(data, null, 2));
      return;
    }

    console.log('   Pole s objednávkami:', `"${ordersKey}"`);
    firstOrder = data[ordersKey][0];
  } catch (err) {
    console.error('❌  Chyba:', err.message);
    return;
  }

  // 2) Výpis struktury první objednávky
  console.log('\n── 2) Struktura první objednávky ────────────────────────────────');
  if (!firstOrder) {
    console.log('⚠️  Žádná objednávka nenalezena.');
    return;
  }

  console.log('   Klíče objednávky:', Object.keys(firstOrder).join(', '));
  console.log('');

  // Klíčová pole
  const fieldMap = {
    'Číslo objednávky':  ['order_number', 'number', 'code', 'id'],
    'Datum vytvoření':   ['creation_time', 'created_at', 'date_created', 'date'],
    'Status':            ['status', 'status_name', 'state'],
    'Status ID':         ['status_id', 'state_id'],
    'Email zákazníka':   ['email', 'customer_email', 'customer.email'],
  };

  for (const [label, candidates] of Object.entries(fieldMap)) {
    const found = candidates.find(k => firstOrder[k] !== undefined);
    console.log(`   ${label.padEnd(22)} → ${found ? `"${found}" = ${JSON.stringify(firstOrder[found])}` : '⚠️  nenalezeno'}`);
  }

  // 3) Výpis položek objednávky
  console.log('\n── 3) Položky objednávky ─────────────────────────────────────────');
  const itemsKey = ['items', 'order_items', 'products', 'lines'].find(k => Array.isArray(firstOrder[k]));
  if (!itemsKey) {
    console.log('⚠️  Pole s položkami nenalezeno. Klíče:', Object.keys(firstOrder).join(', '));
  } else {
    console.log(`   Pole s položkami: "${itemsKey}", počet položek: ${firstOrder[itemsKey].length}`);
    const item = firstOrder[itemsKey][0];
    if (item) {
      console.log('\n   Klíče první položky:', Object.keys(item).join(', '));
      const itemFields = {
        'Název produktu':   ['name', 'product_name', 'title'],
        'Kód produktu':     ['code', 'product_code', 'sku', 'item_code'],
        'Množství':         ['amount', 'quantity', 'qty'],
        'Cena s DPH':       ['unit_price', 'price_with_vat', 'price_vat', 'total_price_with_vat'],
        'Cena bez DPH':     ['unit_price_without_vat', 'price_without_vat', 'price', 'total_price_without_vat'],
        'Nákupní cena':     ['purchase_price', 'buying_price', 'cost_price', 'buy_price', 'supplier_price'],
      };
      console.log('');
      for (const [label, candidates] of Object.entries(itemFields)) {
        const found = candidates.find(k => item[k] !== undefined);
        console.log(`   ${label.padEnd(20)} → ${found ? `"${found}" = ${JSON.stringify(item[found])}` : '⚠️  nenalezeno'}`);
      }
      console.log('\n   Kompletní první položka:');
      console.log(JSON.stringify(item, null, 4).split('\n').map(l => '   ' + l).join('\n'));
    }
  }

  // 4) Doprava a platba
  console.log('\n── 4) Doprava a platba ───────────────────────────────────────────');
  const shippingKey = ['shipping', 'delivery', 'transport'].find(k => firstOrder[k] !== undefined);
  const paymentKey  = ['payment'].find(k => firstOrder[k] !== undefined);
  console.log(`   Doprava: ${shippingKey ? `"${shippingKey}" = ${JSON.stringify(firstOrder[shippingKey])}` : '⚠️  nenalezeno'}`);
  console.log(`   Platba:  ${paymentKey  ? `"${paymentKey}"  = ${JSON.stringify(firstOrder[paymentKey])}`  : '⚠️  nenalezeno'}`);

  // 5) Test filtrování podle data
  console.log('\n── 5) Test date filtru (objednávky od 2025-01-01) ───────────────');
  try {
    const filtered = await apiGet('/orders?page=1&limit=5&date_created_from=2025-01-01');
    const fKey = ['orders', 'data', 'items', 'results'].find(k => Array.isArray(filtered[k]));
    const count = fKey ? filtered[fKey].length : '?';
    console.log(`✅  Vráceno ${count} objednávek (první stránka)`);
    if (filtered.total_count) console.log(`   Celkem od 2025-01-01: ${filtered.total_count}`);
  } catch (err) {
    // Zkusíme alternativní parametr
    try {
      const filtered2 = await apiGet('/orders?page=1&limit=5&last_update_time_from=2025-01-01');
      const fKey = ['orders', 'data', 'items', 'results'].find(k => Array.isArray(filtered2[k]));
      console.log(`✅  "last_update_time_from" funguje, vráceno ${fKey ? filtered2[fKey].length : '?'} objednávek`);
    } catch (err2) {
      console.log('⚠️  Date filtr nefunguje ani s date_created_from ani last_update_time_from');
      console.log('   Chyba:', err2.message);
    }
  }

  // 6) Kompletní JSON první objednávky (bez položek pro přehlednost)
  console.log('\n── 6) Kompletní JSON první objednávky (bez items) ───────────────');
  const orderWithoutItems = { ...firstOrder };
  if (itemsKey) delete orderWithoutItems[itemsKey];
  console.log(JSON.stringify(orderWithoutItems, null, 2));

  console.log('\n✅  Test dokončen.\n');
}

main().catch(err => {
  console.error('❌  Neočekávaná chyba:', err.message);
  process.exit(1);
});
