/**
 * updateData.js
 * Stáhne CZ objednávky z Upgates API (cache + inkrementální sync)
 * + marketingové náklady z Google Sheets.
 * Vygeneruje všechny data/*CZ.ts soubory.
 *
 * Spuštění:
 *   node scripts/updateData.js          — inkrementální (posledních 30 dní)
 *   node scripts/updateData.js --full   — full sync (od 2023-03-03)
 */

const https = require('https');
const fs    = require('fs');
const path  = require('path');
const { syncOrders } = require('./upgatesClient');

// ── Env ───────────────────────────────────────────────────────────────────────
function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (val && !process.env[key]) process.env[key] = val;
  }
}
loadEnv();

const UPGATES_API_URL = process.env.UPGATES_API_URL;
const UPGATES_LOGIN   = process.env.UPGATES_LOGIN;
const UPGATES_API_KEY = process.env.UPGATES_API_KEY;

// ── Google Sheets (pouze cost CZ) ────────────────────────────────────────────
const SHEETS = {
  cost_cz: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTK-KMsKcq2yH1cQ7AHWSoFmIrZdMVclI1BM60P3ulSWRlzVbdgNUw-61g9WuG8h98cLwMPaQY7dB0q/pub?output=csv',
};

const DATA_DIR = path.join(__dirname, '..', 'data');
const LOG_FILE = path.join(__dirname, 'updateData.log');

// ── Logging ───────────────────────────────────────────────────────────────────
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n');
}

// ── HTTP fetch (pro Google Sheets) ────────────────────────────────────────────
function fetchUrl(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Too many redirects'));
    const lib = url.startsWith('https') ? https : require('http');
    lib.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(fetchUrl(res.headers.location, redirects + 1));
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    }).on('error', reject);
  });
}

// ── CSV helpers (pouze pro cost Sheets) ──────────────────────────────────────
function parseCSV(content) {
  const lines = content.split('\n');
  const result = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cols = [];
    let cur = '', inQ = false;
    for (const c of lines[i]) {
      if (c === '"') { inQ = !inQ; }
      else if (c === ',' && !inQ) { cols.push(cur); cur = ''; }
      else { cur += c; }
    }
    cols.push(cur);
    result.push(cols);
  }
  return result;
}

const parseNum = s => parseFloat((s || '0').replace(',', '.')) || 0;

// ── Cost processing (Google Sheets) ──────────────────────────────────────────
// Normalizuje názvy zdrojů na interní klíče
function normalizeSource(raw) {
  const s = (raw || '').trim().toLowerCase();
  if (s === 'facebook')    return 'facebook';
  if (s === 'google')      return 'google';
  if (s === 'seznam')      return 'seznam';
  if (s.startsWith('zbozi'))   return 'zbozi';
  if (s.startsWith('heureka')) return 'heureka';
  return s; // ostatní zdroje zachovat tak jak jsou
}

function aggregateCost(csv) {
  const rows = parseCSV(csv);
  const byDay = {};
  const byDaySource = {};

  for (const cols of rows) {
    if (cols.length < 6) continue;
    const date   = cols[1].trim();
    const source = normalizeSource(cols[2]);
    const cost   = parseNum(cols[4]);
    const clicks = parseNum(cols[5]);

    if (!date) continue;
    byDay[date] = (byDay[date] || 0) + cost;
    if (!byDaySource[date]) byDaySource[date] = {};
    if (!byDaySource[date][source]) byDaySource[date][source] = { cost: 0, clicks: 0 };
    byDaySource[date][source].cost   += cost;
    byDaySource[date][source].clicks += clicks;
  }
  return { byDay, byDaySource };
}

// ── Upgates order helpers ─────────────────────────────────────────────────────

/** Vrátí datum YYYY-MM-DD z ISO timestampu objednávky */
function orderDate(order) {
  return order.creation_time.substring(0, 10);
}

/**
 * Vrátí true pro objednávky, které se nemají počítat ve statistikách:
 *   - statistics_yn = false  → testovací / draft objednávky
 *   - status_id === 2        → Storno
 */
function isExcluded(order) {
  if (!order.statistics_yn) return true;
  if (order.status_id === 2) return true;
  return false;
}

// ── Agregační funkce (Upgates JSON → struktury pro data/*.ts) ─────────────────

// buy_price v Upgates je s DPH — přepočet na cenu bez DPH dle sazby produktu.
// Sazbu odvozujeme z prodejních cen (price_with_vat / price_without_vat - 1).
// Fallback na 0 pokud price_without_vat chybí (dárek, doprava zdarma apod.).
function buyPriceWithoutVat(p) {
  const vatBase = p.price_without_vat || 0;
  const vatFull = p.price_with_vat    || 0;
  if (vatBase <= 0 || vatFull <= 0) return 0;
  const vatRate = vatFull / vatBase - 1;
  return (p.buy_price || 0) / (1 + vatRate);
}

function aggregateOrders(orders) {
  const byDay = {};

  for (const o of orders) {
    const date = orderDate(o);
    if (!byDay[date]) byDay[date] = { orders: 0, orders_cancelled: 0, revenue_vat: 0, revenue: 0 };

    if (isExcluded(o)) {
      if (o.status_id === 2) byDay[date].orders_cancelled++;
      continue;
    }

    byDay[date].orders++;
    for (const p of (o.products || [])) {
      if (p.type !== 'product') continue;
      byDay[date].revenue_vat += p.price_with_vat    || 0;
      byDay[date].revenue     += p.price_without_vat || 0;
    }
  }
  return byDay;
}

function aggregateOrdersProdejna(orders) {
  const byDay = {};
  for (const o of orders) {
    if (isExcluded(o)) continue;
    if (o.status_id !== 19 && o.status_id !== 21) continue;
    const date = orderDate(o);
    if (!byDay[date]) byDay[date] = { orders: 0, revenue_vat: 0, revenue: 0 };
    byDay[date].orders++;
    for (const p of (o.products || [])) {
      if (p.type !== 'product') continue;
      byDay[date].revenue_vat += p.price_with_vat    || 0;
      byDay[date].revenue     += p.price_without_vat || 0;
    }
  }
  return Object.entries(byDay)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({
      date,
      orders:      v.orders,
      revenue_vat: Math.round(v.revenue_vat * 100) / 100,
      revenue:     Math.round(v.revenue     * 100) / 100,
    }));
}

function aggregateMarginProdejna(orders) {
  const byDay = {};
  for (const o of orders) {
    if (isExcluded(o)) continue;
    if (o.status_id !== 19 && o.status_id !== 21) continue;
    const date = orderDate(o);
    if (!byDay[date]) byDay[date] = { purchaseCost: 0, revenue: 0 };
    for (const p of (o.products || [])) {
      if (p.type !== 'product') continue;
      byDay[date].purchaseCost += buyPriceWithoutVat(p) * (p.quantity || 0);
      byDay[date].revenue      += p.price_without_vat || 0;
    }
  }
  return Object.entries(byDay)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({
      date,
      purchaseCost: Math.round(v.purchaseCost * 100) / 100,
      revenue:      Math.round(v.revenue      * 100) / 100,
    }));
}

function aggregateProducts(orders) {
  const byDateProduct = {};

  for (const o of orders) {
    if (isExcluded(o)) continue;
    const date = orderDate(o);

    for (const p of (o.products || [])) {
      if (p.type !== 'product') continue;
      const name = (p.title || '').trim();
      if (!name || (p.quantity || 0) <= 0) continue;

      const key = `${date}||${name}`;
      if (!byDateProduct[key]) byDateProduct[key] = { date, name, amount: 0, revenue_vat: 0, revenue: 0, purchaseCost: 0 };
      byDateProduct[key].amount       += p.quantity           || 0;
      byDateProduct[key].revenue_vat  += p.price_with_vat    || 0;
      byDateProduct[key].revenue      += p.price_without_vat || 0;
      byDateProduct[key].purchaseCost += buyPriceWithoutVat(p) * (p.quantity || 0);
    }
  }

  return Object.values(byDateProduct)
    .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name))
    .map(r => ({
      ...r,
      revenue_vat:  Math.round(r.revenue_vat  * 100) / 100,
      revenue:      Math.round(r.revenue      * 100) / 100,
      purchaseCost: Math.round(r.purchaseCost * 100) / 100,
    }));
}

function aggregateMargin(orders) {
  const byDay = {};

  for (const o of orders) {
    if (isExcluded(o)) continue;
    const date = orderDate(o);
    if (!byDay[date]) byDay[date] = { purchaseCost: 0, revenue: 0 };

    for (const p of (o.products || [])) {
      if (p.type !== 'product') continue;
      byDay[date].purchaseCost += buyPriceWithoutVat(p) * (p.quantity || 0);
      byDay[date].revenue      += p.price_without_vat || 0;
    }
  }

  return Object.entries(byDay)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({
      date,
      purchaseCost: Math.round(v.purchaseCost * 100) / 100,
      revenue:      Math.round(v.revenue      * 100) / 100,
    }));
}

function aggregateHourly(orders) {
  const cancelledIds = new Set(
    orders.filter(o => o.status_id === 2).map(o => o.order_id)
  );
  const dayDateSets = Array.from({ length: 7 }, () => new Set());
  const grid        = Array.from({ length: 7 }, () =>
    Array.from({ length: 24 }, () => ({ revenue: 0, orders: 0 }))
  );

  for (const o of orders) {
    if (!o.statistics_yn || cancelledIds.has(o.order_id)) continue;
    const dateStr = o.creation_time.substring(0, 10);
    const hour    = parseInt(o.creation_time.substring(11, 13), 10);
    if (isNaN(hour) || hour < 0 || hour > 23) continue;

    const dow = new Date(dateStr + 'T12:00:00').getDay();
    dayDateSets[dow].add(dateStr);

    let rev = 0;
    for (const p of (o.products || [])) {
      if (p.type !== 'product') continue;
      rev += p.price_without_vat || 0;
    }
    grid[dow][hour].revenue += rev;
    grid[dow][hour].orders++;
  }

  const result = [];
  for (let dow = 0; dow < 7; dow++) {
    const dayCount = dayDateSets[dow].size || 1;
    for (let h = 0; h < 24; h++) {
      result.push({
        dayOfWeek:    dow,
        hour:         h,
        dayCount,
        totalRevenue: Math.round(grid[dow][h].revenue  * 100) / 100,
        totalOrders:  grid[dow][h].orders,
        avgRevenue:   Math.round((grid[dow][h].revenue  / dayCount) * 100) / 100,
        avgOrders:    Math.round((grid[dow][h].orders   / dayCount) * 100) / 100,
      });
    }
  }
  return result;
}

function aggregateCrossSell(orders) {
  const orderProducts = new Map();

  for (const o of orders) {
    if (isExcluded(o)) continue;
    const names = new Set(
      (o.products || [])
        .filter(p => p.type === 'product' && (p.quantity || 0) > 0)
        .map(p => (p.title || '').trim())
        .filter(Boolean)
    );
    if (names.size > 0) orderProducts.set(o.order_id, names);
  }

  const pairCounts = new Map();
  const totalOrders = orderProducts.size;
  let multiItemOrders = 0;

  for (const products of orderProducts.values()) {
    const arr = [...products].sort();
    if (arr.length < 2) continue;
    multiItemOrders++;
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const key = `${arr[i]}|||${arr[j]}`;
        pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
      }
    }
  }

  const pairs = [...pairCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 100)
    .map(([key, count]) => {
      const sep = key.indexOf('|||');
      return {
        productA: key.slice(0, sep),
        productB: key.slice(sep + 3),
        count,
        pct: totalOrders > 0 ? Math.round((count / totalOrders) * 10000) / 100 : 0,
      };
    });

  return { totalOrders, multiItemOrders, pairs };
}

function aggregateShippingPayment(orders) {
  const byKey           = {};
  const seenOrderMethod = new Set();

  for (const o of orders) {
    if (isExcluded(o)) continue;
    const date = orderDate(o);

    if (o.shipment && o.shipment.name) {
      const name = o.shipment.name.trim();
      const key  = `${date}||shipping||${name}`;
      if (!byKey[key]) byKey[key] = { date, type: 'shipping', name, count: 0, revenue_vat: 0 };
      const omKey = `${o.order_id}||${name}`;
      if (!seenOrderMethod.has(omKey)) { seenOrderMethod.add(omKey); byKey[key].count++; }
      byKey[key].revenue_vat += o.shipment.price_with_vat || 0;
    }

    if (o.payment && o.payment.name) {
      const name = o.payment.name.trim();
      const key  = `${date}||payment||${name}`;
      if (!byKey[key]) byKey[key] = { date, type: 'payment', name, count: 0, revenue_vat: 0 };
      const omKey = `${o.order_id}||payment||${name}`;
      if (!seenOrderMethod.has(omKey)) { seenOrderMethod.add(omKey); byKey[key].count++; }
      byKey[key].revenue_vat += o.payment.price_with_vat || 0;
    }
  }

  return Object.values(byKey)
    .sort((a, b) => a.date.localeCompare(b.date) || a.type.localeCompare(b.type) || a.name.localeCompare(b.name))
    .map(r => ({ ...r, revenue_vat: Math.round(r.revenue_vat * 100) / 100 }));
}

function aggregateOrderValues(orders) {
  const result = [];

  for (const o of orders) {
    if (isExcluded(o)) continue;
    let value = 0;
    for (const p of (o.products || [])) {
      if (p.type !== 'product') continue;
      value += p.price_without_vat || 0;
    }
    if (value > 0) result.push({ date: orderDate(o), value: Math.round(value * 100) / 100 });
  }

  return result.sort((a, b) => a.date.localeCompare(b.date));
}

function aggregateRetention(orders) {
  const orderTotals = new Map();

  for (const o of orders) {
    if (isExcluded(o)) continue;
    const email = (o.customer?.email || '').trim().toLowerCase();
    if (!email) continue;

    let revVat = 0, rev = 0;
    for (const p of (o.products || [])) {
      if (p.type !== 'product') continue;
      revVat += p.price_with_vat    || 0;
      rev    += p.price_without_vat || 0;
    }
    if (revVat <= 0) continue;
    orderTotals.set(o.order_id, { email, date: orderDate(o), revVat, rev });
  }

  const byCustomer = new Map();
  for (const { email, date, revVat, rev } of orderTotals.values()) {
    if (!byCustomer.has(email)) byCustomer.set(email, []);
    byCustomer.get(email).push({ date, rev, revVat });
  }

  const result = [];
  for (const customerOrders of byCustomer.values()) {
    const sorted = customerOrders.sort((a, b) => a.date.localeCompare(b.date));
    result.push({
      dates:    sorted.map(x => x.date),
      revenues: sorted.map(x => Math.round(x.rev    * 100) / 100),
      revsVat:  sorted.map(x => Math.round(x.revVat * 100) / 100),
    });
  }
  return result;
}

function mergeDailyRecords(ordersByDay, costByDay, costByDaySource) {
  const allDates = new Set([...Object.keys(ordersByDay), ...Object.keys(costByDay)]);

  return [...allDates].sort().map(date => {
    const o       = ordersByDay[date]     || { orders: 0, orders_cancelled: 0, revenue_vat: 0, revenue: 0 };
    const cost    = costByDay[date]       || 0;
    const sources = costByDaySource[date] || {};

    return {
      date,
      country:          'cz',
      orders:            o.orders,
      orders_cancelled:  o.orders_cancelled,
      revenue_vat:       Math.round(o.revenue_vat * 100) / 100,
      revenue:           Math.round(o.revenue     * 100) / 100,
      cost:              Math.round(cost           * 100) / 100,
      cost_facebook:     Math.round((sources.facebook?.cost   || 0) * 100) / 100,
      cost_google:       Math.round((sources.google?.cost     || 0) * 100) / 100,
      cost_seznam:       Math.round((sources.seznam?.cost     || 0) * 100) / 100,
      cost_zbozi:        Math.round((sources.zbozi?.cost      || 0) * 100) / 100,
      cost_heureka:      Math.round((sources.heureka?.cost    || 0) * 100) / 100,
      clicks_facebook:   Math.round(sources.facebook?.clicks  || 0),
      clicks_google:     Math.round(sources.google?.clicks    || 0),
      clicks_seznam:     Math.round(sources.seznam?.clicks    || 0),
    };
  });
}

// ── Zápis .ts souborů ─────────────────────────────────────────────────────────

function writeTsFile(filePath, varName, interfaceName, records) {
  const today = new Date().toISOString().split('T')[0];
  fs.writeFileSync(filePath, `// Auto-generated by scripts/updateData.js — last update: ${today}
// CZ: orders in CZK (cancelled/test excluded)

export interface ${interfaceName} {
  date: string;
  country: 'cz';
  orders: number;
  orders_cancelled: number;
  revenue_vat: number;
  revenue: number;
  cost: number;
  cost_facebook: number;
  cost_google: number;
  cost_seznam: number;
  cost_zbozi: number;
  cost_heureka: number;
  clicks_facebook: number;
  clicks_google: number;
  clicks_seznam: number;
}

export const ${varName}: ${interfaceName}[] = ${JSON.stringify(records, null, 2)};
`, 'utf8');
}

function writeProductTsFile(filePath, varName, records) {
  const today = new Date().toISOString().split('T')[0];
  fs.writeFileSync(filePath, `// Auto-generated by scripts/updateData.js — last update: ${today}
// CZ: product sales (cancelled/test excluded)

export interface ProductSaleRecord {
  date: string;
  name: string;
  amount: number;
  revenue_vat: number;
  revenue: number;
  purchaseCost: number;
}

export const ${varName}: ProductSaleRecord[] = ${JSON.stringify(records, null, 2)};
`, 'utf8');
}

function writeMarginTsFile(filePath, varName, records) {
  const today = new Date().toISOString().split('T')[0];
  fs.writeFileSync(filePath, `// Auto-generated by scripts/updateData.js — last update: ${today}
// CZ: daily margin data (CZK). purchaseCost = nákupní cena bez DPH (buy_price přepočten přes vatRate × quantity), revenue = tržby bez DPH.

export interface MarginDailyRecord {
  date: string;
  purchaseCost: number;
  revenue: number;
}

export const ${varName}: MarginDailyRecord[] = ${JSON.stringify(records, null, 2)};
`, 'utf8');
}

function writeHourlyTsFile(filePath, varName, records) {
  const today = new Date().toISOString().split('T')[0];
  fs.writeFileSync(filePath, `// Auto-generated by scripts/updateData.js — last update: ${today}
// CZ: hourly purchase behaviour (CZK), all-time

export interface HourlyPoint {
  dayOfWeek:    number;
  hour:         number;
  dayCount:     number;
  totalRevenue: number;
  totalOrders:  number;
  avgRevenue:   number;
  avgOrders:    number;
}

export const ${varName}: HourlyPoint[] = ${JSON.stringify(records, null, 2)};
`, 'utf8');
}

function writeCrossSellTsFile(filePath, varName, data) {
  const today = new Date().toISOString().split('T')[0];
  fs.writeFileSync(filePath, `// Auto-generated by scripts/updateData.js — last update: ${today}
// CZ: product pair co-occurrence from orders

export interface CrossSellPair {
  productA: string;
  productB: string;
  count: number;
  pct: number;
}

export interface CrossSellData {
  totalOrders: number;
  multiItemOrders: number;
  pairs: CrossSellPair[];
}

export const ${varName}: CrossSellData = ${JSON.stringify(data, null, 2)};
`, 'utf8');
}

function writeShippingPaymentTsFile(filePath, varName, records) {
  const today = new Date().toISOString().split('T')[0];
  fs.writeFileSync(filePath, `// Auto-generated by scripts/updateData.js — last update: ${today}
// CZ: what customers paid for shipping & payment (CZK, cancelled excluded)

export interface ShippingPaymentRecord {
  date: string;
  type: 'shipping' | 'payment';
  name: string;
  count: number;
  revenue_vat: number;
}

export const ${varName}: ShippingPaymentRecord[] = ${JSON.stringify(records, null, 2)};
`, 'utf8');
}

function writeOrderValueTsFile(filePath, varName, records) {
  const today = new Date().toISOString().split('T')[0];
  fs.writeFileSync(filePath, `// Auto-generated by scripts/updateData.js — last update: ${today}
// CZ: per-order product basket value bez DPH (CZK), cancelled excluded

export interface OrderValueRecord {
  date: string;
  value: number;
}

export const ${varName}: OrderValueRecord[] = ${JSON.stringify(records, null, 2)};
`, 'utf8');
}

function writeProdejnaTsFile(filePath, varName, records) {
  const today = new Date().toISOString().split('T')[0];
  fs.writeFileSync(filePath, `// Auto-generated by scripts/updateData.js — last update: ${today}
// CZ: prodejna orders (status 19 + 21) in CZK

export interface ProdejnaRecord {
  date: string;
  orders: number;
  revenue_vat: number;
  revenue: number;
}

export const ${varName}: ProdejnaRecord[] = ${JSON.stringify(records, null, 2)};
`, 'utf8');
}

function writeRetentionTsFile(filePath, varName, records) {
  const today = new Date().toISOString().split('T')[0];
  fs.writeFileSync(filePath, `// Auto-generated by scripts/updateData.js — last update: ${today}
// CZ: per-customer retention data (CZK)

export const ${varName}: { dates: string[]; revenues: number[]; revsVat: number[] }[] = ${JSON.stringify(records, null, 2)};
`, 'utf8');
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  log('=== Data update started ===');
  const isFullSync = process.argv.includes('--full');

  if (!UPGATES_API_URL || !UPGATES_LOGIN || !UPGATES_API_KEY) {
    log('ERROR: Chybí Upgates env proměnné (UPGATES_API_URL, UPGATES_LOGIN, UPGATES_API_KEY)');
    process.exit(1);
  }

  try {
    // ── 1) Upgates objednávky ────────────────────────────────────────────────
    log('Upgates: synchronizace objednávek...');
    const orders = await syncOrders({
      apiUrl: UPGATES_API_URL,
      login:  UPGATES_LOGIN,
      apiKey: UPGATES_API_KEY,
      log,
      full:   isFullSync,
    });
    log(`Upgates: ${orders.length} objednávek v cache`);

    // ── 2) Marketing náklady z Google Sheets ─────────────────────────────────
    log('Google Sheets: stahování nákladů CZ...');
    const csvCostCZ = await fetchUrl(SHEETS.cost_cz);
    log('Google Sheets: download OK');
    const { byDay: costByDayCZ, byDaySource: costSrcCZ } = aggregateCost(csvCostCZ);

    // ── 3) Agregace a zápis ──────────────────────────────────────────────────
    const ordersByDayCZ = aggregateOrders(orders);
    const recordsCZ     = mergeDailyRecords(ordersByDayCZ, costByDayCZ, costSrcCZ);
    const totalCZ       = recordsCZ.reduce(
      (a, r) => ({ orders: a.orders + r.orders, revenue: a.revenue + r.revenue, cost: a.cost + r.cost }),
      { orders: 0, revenue: 0, cost: 0 }
    );
    log(`CZ: ${recordsCZ.length} dní | ${totalCZ.orders} objednávek | ${totalCZ.revenue.toFixed(0)} Kč | PNO ${totalCZ.revenue > 0 ? (totalCZ.cost / totalCZ.revenue * 100).toFixed(2) : 0}%`);
    writeTsFile(path.join(DATA_DIR, 'realDataCZ.ts'), 'realDataCZ', 'RealDailyRecord', recordsCZ);
    log('Written realDataCZ.ts');

    const productsCZ = aggregateProducts(orders);
    writeProductTsFile(path.join(DATA_DIR, 'productDataCZ.ts'), 'productDataCZ', productsCZ);
    log(`CZ products: ${productsCZ.reduce((s, r) => s + r.amount, 0)} ks across ${new Set(productsCZ.map(r => r.name)).size} unique products`);
    log('Written productDataCZ.ts');

    const marginCZ = aggregateMargin(orders);
    writeMarginTsFile(path.join(DATA_DIR, 'marginDataCZ.ts'), 'marginDataCZ', marginCZ);
    log(`CZ margin: ${marginCZ.length} dní | marže ${marginCZ.reduce((s, r) => s + (r.revenue - r.purchaseCost), 0).toFixed(0)} Kč`);
    log('Written marginDataCZ.ts');

    const prodejnaCZ = aggregateOrdersProdejna(orders);
    writeProdejnaTsFile(path.join(DATA_DIR, 'prodejnaDataCZ.ts'), 'prodejnaDataCZ', prodejnaCZ);
    log(`CZ prodejna: ${prodejnaCZ.length} dní | ${prodejnaCZ.reduce((s, r) => s + r.orders, 0)} objednávek`);
    log('Written prodejnaDataCZ.ts');

    const prodejnaMarginCZ = aggregateMarginProdejna(orders);
    writeMarginTsFile(path.join(DATA_DIR, 'prodejnaMarginDataCZ.ts'), 'prodejnaMarginDataCZ', prodejnaMarginCZ);
    log(`CZ prodejna margin: ${prodejnaMarginCZ.length} dní`);
    log('Written prodejnaMarginDataCZ.ts');

    const hourlyCZ = aggregateHourly(orders);
    writeHourlyTsFile(path.join(DATA_DIR, 'hourlyDataCZ.ts'), 'hourlyDataCZ', hourlyCZ);
    log(`CZ hourly: ${hourlyCZ.filter(p => p.totalOrders > 0).length}/168 active slots`);
    log('Written hourlyDataCZ.ts');

    const crossSellCZ = aggregateCrossSell(orders);
    writeCrossSellTsFile(path.join(DATA_DIR, 'crossSellDataCZ.ts'), 'crossSellDataCZ', crossSellCZ);
    log(`CZ cross-sell: ${crossSellCZ.pairs.length} pairs from ${crossSellCZ.totalOrders} orders`);
    log('Written crossSellDataCZ.ts');

    const shippingCZ = aggregateShippingPayment(orders);
    writeShippingPaymentTsFile(path.join(DATA_DIR, 'shippingPaymentDataCZ.ts'), 'shippingPaymentDataCZ', shippingCZ);
    log(`CZ shipping/payment: ${shippingCZ.length} records`);
    log('Written shippingPaymentDataCZ.ts');

    const orderValuesCZ = aggregateOrderValues(orders);
    writeOrderValueTsFile(path.join(DATA_DIR, 'orderValueDataCZ.ts'), 'orderValueDataCZ', orderValuesCZ);
    log(`CZ order values: ${orderValuesCZ.length} orders`);
    log('Written orderValueDataCZ.ts');

    const retentionCZ = aggregateRetention(orders);
    writeRetentionTsFile(path.join(DATA_DIR, 'retentionDataCZ.ts'), 'retentionDataCZ', retentionCZ);
    log(`CZ retention: ${retentionCZ.length} customers`);
    log('Written retentionDataCZ.ts');

    fs.writeFileSync(
      path.join(DATA_DIR, 'lastUpdate.ts'),
      `// Auto-generated by scripts/updateData.js\nexport const lastUpdate = '${new Date().toISOString()}';\n`,
      'utf8'
    );
    log('Written lastUpdate.ts');

    log('=== Data update finished successfully ===');

  } catch (err) {
    log(`ERROR: ${err.message}`);
    process.exit(1);
  }
}

main();
