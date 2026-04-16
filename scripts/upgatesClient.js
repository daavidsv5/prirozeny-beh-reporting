/**
 * upgatesClient.js
 * Upgates API klient — stahování objednávek s cachováním.
 *
 * Cache soubor: scripts/upgatesCache.json
 *   { orders: [...], lastFullSync: "YYYY-MM-DD", lastIncrementalSync: "YYYY-MM-DD" }
 *
 * Použití z updateData.js:
 *   const { syncOrders } = require('./upgatesClient');
 *   const orders = await syncOrders({ log, full: false });
 *   // vrátí celé pole cachovanych objednávek po mergi
 */

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const CACHE_FILE     = path.join(__dirname, 'upgatesCache.json');
const FULL_SYNC_FROM = '2023-03-03';   // první CZ objednávka v Upgates
const DELAY_MS       = 400;            // prodleva mezi stránkami (rate limit)
const RETRY_DELAY_MS = 10000;          // čekání při 429 Too Many Requests

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function loadCache() {
  if (!fs.existsSync(CACHE_FILE)) return { orders: [], lastFullSync: null, lastIncrementalSync: null };
  try {
    return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
  } catch {
    return { orders: [], lastFullSync: null, lastIncrementalSync: null };
  }
}

function saveCache(cache) {
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache), 'utf8');
}

/**
 * Merguje nové/aktualizované objednávky do cache.
 * Existující objednávky (stejné order_id) se přepíší — zachytí storna a změny statusů.
 */
function mergeOrders(cached, incoming) {
  const map = new Map(cached.map(o => [o.order_id, o]));
  for (const o of incoming) {
    map.set(o.order_id, o);
  }
  return [...map.values()].sort((a, b) => a.creation_time.localeCompare(b.creation_time));
}

// ── API volání ────────────────────────────────────────────────────────────────

function apiGet(apiUrl, login, apiKey, endpoint) {
  return new Promise((resolve, reject) => {
    const url    = apiUrl.replace(/\/$/, '') + endpoint;
    const auth   = Buffer.from(`${login}:${apiKey}`).toString('base64');
    const parsed = new URL(url);

    const req = https.request(
      {
        hostname: parsed.hostname,
        path:     parsed.pathname + parsed.search,
        method:   'GET',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Accept':        'application/json',
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode === 429) {
            return reject(Object.assign(new Error('RATE_LIMIT'), { statusCode: 429 }));
          }
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
      }
    );
    req.on('error', reject);
    req.end();
  });
}

/**
 * Stáhne všechny stránky objednávek pro daný parametr filtru.
 * @param {string} filterParam  — např. "creation_time_from=2023-03-03"
 *                                nebo "last_update_time_from=2026-04-01"
 */
async function fetchAllPages(apiUrl, login, apiKey, filterParam, log) {
  const orders = [];
  let page = 1;
  let totalPages = null;

  while (true) {
    let data;
    // Retry loop pro rate limit
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        data = await apiGet(apiUrl, login, apiKey, `/orders?page=${page}&${filterParam}`);
        break;
      } catch (err) {
        if (err.statusCode === 429 && attempt < 4) {
          log(`  Rate limit — čekám ${RETRY_DELAY_MS / 1000}s...`);
          await sleep(RETRY_DELAY_MS);
        } else {
          throw err;
        }
      }
    }

    orders.push(...data.orders);
    totalPages = data.number_of_pages;
    log(`  Stránka ${page}/${totalPages} — staženo ${data.orders.length} objednávek (celkem ${orders.length})`);

    if (page >= totalPages) break;
    page++;
    await sleep(DELAY_MS);
  }

  return orders;
}

// ── Hlavní export ─────────────────────────────────────────────────────────────

/**
 * Synchronizuje objednávky z Upgates API a vrátí kompletní cachovany seznam.
 *
 * @param {object} opts
 *   opts.apiUrl   — UPGATES_API_URL
 *   opts.login    — UPGATES_LOGIN
 *   opts.apiKey   — UPGATES_API_KEY
 *   opts.log      — funkce pro logování
 *   opts.full     — true = vždy full sync, false = auto (full pokud cache prázdná)
 *
 * @returns {object[]} — pole všech cachovanych objednávek
 */
async function syncOrders({ apiUrl, login, apiKey, log, full = false }) {
  const cache    = loadCache();
  const isEmpty  = cache.orders.length === 0;
  const doFull   = full || isEmpty;

  const today = new Date().toISOString().split('T')[0];

  if (doFull) {
    log(`Full sync od ${FULL_SYNC_FROM}...`);
    const incoming = await fetchAllPages(
      apiUrl, login, apiKey,
      `creation_time_from=${FULL_SYNC_FROM}`,
      log
    );
    cache.orders          = mergeOrders([], incoming);
    cache.lastFullSync    = today;
    cache.lastIncrementalSync = today;
    log(`Full sync dokončen — ${cache.orders.length} objednávek v cache`);
  } else {
    // Inkrementální: stáhneme objednávky aktualizované za posledních 30 dní.
    // last_update_time_from zachytí jak nové objednávky, tak změněné statusy (storna).
    const d = new Date();
    d.setDate(d.getDate() - 30);
    const fromDate = d.toISOString().split('T')[0];

    log(`Inkrementální sync od ${fromDate} (last_update_time_from)...`);
    const incoming = await fetchAllPages(
      apiUrl, login, apiKey,
      `last_update_time_from=${fromDate}`,
      log
    );
    cache.orders              = mergeOrders(cache.orders, incoming);
    cache.lastIncrementalSync = today;
    log(`Inkrementální sync dokončen — ${incoming.length} objednávek aktualizováno, celkem ${cache.orders.length} v cache`);
  }

  saveCache(cache);
  return cache.orders;
}

module.exports = { syncOrders };
