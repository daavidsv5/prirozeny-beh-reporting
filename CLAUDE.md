# CLAUDE.md

Tento soubor slouží jako stručný návod pro Claude Code (claude.ai/code) při práci s tímto repozitářem.

## Příkazy

```bash
npm install      # Nainstaluje závislosti
npm run dev -- --webpack  # Spustí dev server — VŽDY s --webpack (Turbopack padá na Windows kvůli junction pointům pro pg)
npm run build    # Produkční build — často odhalí TS chyby
npm run start    # Spustí produkční build
# Pozor: npm run dev spouštět přes cmd.exe nebo PowerShell, ne bash (bash vrací exit code 127)

node scripts/updateData.js         # Ruční refresh dat (Upgates API + Google Sheets costs)
node scripts/updateData.js --full  # Vynutí full sync všech objednávek od 2023-03-03

npm run db:migrate  # Vytvoří tabulky v PostgreSQL (Neon)
npm run db:seed     # Vytvoří prvního admin uživatele
```

V projektu nejsou nakonfigurované linter ani testy.

## Architektura

Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4, Recharts, NextAuth 5, Radix UI, PostgreSQL (Neon).

### Tok dat

```
Upgates REST API (objednávky)  +  Google Sheets CSV (marketingové náklady)
       ↓  scripts/updateData.js  (denně v 06:00 via GitHub Actions)
       ↓  na konci skriptu: git commit + push → Vercel automaticky redeploy
data/realDataCZ.ts + productDataCZ* + marginDataCZ* + hourlyDataCZ* +
crossSellDataCZ* + retentionDataCZ* + orderValueDataCZ* + shippingPaymentDataCZ* +
prodejnaDataCZ* + prodejnaMarginDataCZ* + lastUpdate.ts
       ↓
data/mockGenerator.ts  →  export const mockData: DailyRecord[]
                       →  getDailyMarketingData() + getMarketingSourceData()
       ↓
hooks/useDashboardData.ts  (filters + aggregates → KpiData, chartData, YoY)
       ↓
app/(dashboard|orders|marketing|products|margin|analytics|behavior|crosssell|retention|shipping)/page.tsx
```

**Data jsou pouze CZ (CZK). SK bylo odstraněno.**

### Upgates API

Objednávky se stahují z Upgates REST API (Basic Auth, `LOGIN:API_KEY` v Base64).

| Soubor | Účel |
|--------|------|
| `scripts/upgatesClient.js` | Core API klient — stránkování, rate limit, cache |
| `scripts/upgatesCache.json` | Cache všech objednávek (ignorováno v .gitignore) |

**Sync strategie:**
- **Full sync** — při prázdné cache nebo `--full` flagu; stáhne vše od `2023-03-03`; ~57 stránek, ~40 s
- **Inkrementální sync** — denně; `last_update_time_from` za posledních 30 dní, ale nikdy méně nazpátek než `lastIncrementalSync − 3 dny` (viz níže "Pojistky proti díře v datech"); ~4 stránky, ~5 s
- `mergeOrders()` přepisuje záznamy dle `order_id` → zachytí storna a změny statusů
- **Důležité:** GitHub Actions checkout nemá `scripts/upgatesCache.json` (je v `.gitignore`, nepersistuje mezi běhy) → na GHA se tak fakticky **vždy dělá full sync**, i bez `--full` flagu. Inkrementální větev se reálně uplatní jen při lokálním spuštění (perzistentní cache na disku) nebo na self-hosted runneru.

### Pojistky proti díře v datech (incident 2026-07)

V červenci 2026 se zjistilo, že tržby v aplikaci byly za květen výrazně nižší než v administraci Upgates (238k vs. 724k Kč). Příčina: lokální `scripts/upgatesCache.json` (persistentní, na rozdíl od GHA) měl po full syncu 11. 5. 2026 jen inkrementální syncy s pevným 30denním oknem — objednávky vytvořené mezi tímto full syncem a chvílí, kdy je pokrylo aktuální rolling okno, natrvalo propadly. Lokální spuštění `updateData.js` a následný push pak touto neúplnou verzí přepsalo správná GHA data.

Opravy:
- `scripts/upgatesClient.js` — inkrementální `last_update_time_from` je `min(dnes − 30 dní, lastIncrementalSync − 3 dny)`. I víc než měsíční výpadek syncu už nemůže vytvořit trvalou díru.
- `scripts/updateData.js` → `checkForRevenueRegression()` — před přepsáním `realDataCZ.ts` porovná tržby za "uzavřené" období (starší 35 dní) s aktuálním stavem na disku; při poklesu > 10 % zaloguje hlasité VAROVÁNÍ (běh nepřeruší, jen upozorní v logu/GHA výstupu).
- `scripts/updateData.bat` — opravena zastaralá cesta (mířila na starou přejmenovanou složku `Shoptet reporting` místo `Prirozeny-beh-reporting`), Windows Task Scheduler záloha tak celou dobu tiše selhávala.
- **Doporučení:** lokální spuštění `updateData.js` (např. kvůli testu) před commitem/pushem raději spouštět s `--full`, ať se nikdy neuplatní lokální inkrementální cache s případnou mezerou.

**Stavy objednávek Upgates** (všechny known status_id):

| status_id | Název | Počítá se do tržeb? |
|-----------|-------|---------------------|
| 1 | Nová objednávka | Ano |
| 2 | Storno | **Ne** (vyloučeno) |
| 3 | Zaplaceno | Ano |
| 4 | Odesláno | Ano |
| 5 | Vyřízeno | Ano |
| 6 | Vráceno | Ne (storno) |
| 19 | Obchod – Vydáno | Ano |
| 21 | Obchod – objednávka | Ano |

Filtrace: `statistics_yn === true` AND `status_id !== 2`.

**Vyloučení objednávek:**
- `statistics_yn === false` — testovací / draft objednávky
- `status_id === 2` — Storno

**Nákupní ceny (marže):** `products[].buy_price` z Upgates je **s DPH**. Funkce `buyPriceWithoutVat(p)` v `updateData.js` přepočítá na cenu bez DPH pomocí DPH sazby odvozené z prodejních cen (`price_with_vat / price_without_vat - 1`). Výsledek × `quantity` tvoří `purchaseCost`. Pokud `price_without_vat <= 0` (dárek, doprava zdarma), vrací 0.

**Upozornění — Upgates Statistiky/Zisk zobrazuje vyšší zisk:** Upgates počítá `price_with_vat - buy_price` (mix s DPH a bez DPH), zatímco naše aplikace správně počítá `price_without_vat - buyPriceWithoutVat` (obě hodnoty bez DPH).

**Env proměnné:**
```
UPGATES_API_URL=https://prirozeny-beh-cz.admin.s1.upgates.com/api/v2
UPGATES_LOGIN=53172637
UPGATES_API_KEY="..."   # uvozovky nutné — klíč obsahuje # který by byl jinak interpretován jako komentář
```

`loadEnv()` v `scripts/updateData.js` parsuje `.env.local` ručně a **stripuje okolní uvozovky** z hodnot (`val.slice(1, -1)`). Pokud by se vracelo 401, zkontrolovat že uvozovky jsou v `.env.local` a že `loadEnv()` je správně stripuje.

### Marketingové náklady (Google Sheets)

Náklady se stahují z publikovaného Google Sheets CSV. Obsahuje 5 kanálů:

| Kanál | Pole v datech |
|-------|--------------|
| Facebook Ads | `cost_facebook`, `clicks_facebook` |
| Google Ads | `cost_google`, `clicks_google` |
| Seznam Ads | `cost_seznam`, `clicks_seznam` |
| Zboží.cz | `cost_zbozi` |
| Heureka.cz | `cost_heureka` |

**Tanganica (affiliate síť)** — samostatný zdroj, pole `cost_tanganica`. Dva díly:
- **Archiv** `data/tanganicaCosts.json` (`{ "YYYY-MM-DD": expense }`) — historická data do `2026-05-09`, needitovat ručně (statický export z minulosti).
- **Živý denní feed** od `2026-05-10` — publikovaný Google Sheets CSV export (`SHEETS.tanganica_cz` v `updateData.js`), sloupce: Datum, Vygenerovaný obrat, Reklamní výdaje, PNO, Uživatelé, Objednávky, Konverzní poměr. Používá se pouze sloupec **Reklamní výdaje** (index 2). Stahuje se a slučuje s archivem v `loadTanganicaCosts()` (async) při každém běhu `updateData.js` — žádná ruční údržba není potřeba.

Normalizace zdrojů v `updateData.js`:
```js
function normalizeSource(raw) {
  const s = (raw || '').trim().toLowerCase();
  if (s === 'facebook')        return 'facebook';
  if (s === 'google')          return 'google';
  if (s === 'seznam')          return 'seznam';
  if (s.startsWith('zbozi'))   return 'zbozi';
  if (s.startsWith('heureka')) return 'heureka';
  return s;
}
```

### Aktualizace dat na Vercelu

- **Primárně:** `.github/workflows/update-data.yml` — GitHub Actions spouští `node scripts/updateData.js` každý den v 05:00 UTC (= 06:00 CET / 07:00 CEST), nezávisle na stavu počítače
- Na konci **workflow** (ne skriptu) se provede `git add data/ && git commit && git push` → Vercel automaticky nasadí nová data
- Workflow lze spustit i ručně: GitHub → Actions → Update Data → Run workflow
- Tlačítko **Aktualizovat data** (viditelné pouze adminům) volá `/api/update`:
  - Na Vercelu: spustí Vercel Deploy Hook (`VERCEL_DEPLOY_HOOK_URL` env proměnná)
  - Lokálně: spustí `node updateData.js` přímo
- `data/lastUpdate.ts` — auto-gen timestamp poslední aktualizace, zobrazen v TopBaru vpravo

**GitHub Actions secrets** (Settings → Secrets and variables → Actions):
- `UPGATES_API_URL`, `UPGATES_LOGIN`, `UPGATES_API_KEY` — každý jako samostatný secret

**Vercel environment variables** (Settings → Environment Variables):
- `AUTH_SECRET`, `DATABASE_URL`, `UPGATES_API_URL`, `UPGATES_LOGIN`, `UPGATES_API_KEY`
- `GA4_PROPERTY_ID`, `GA4_CLIENT_EMAIL`, `GA4_PRIVATE_KEY`

**Windows Task Scheduler** — tasky jako záloha (primárně nahrazeno GitHub Actions):
- Spustitelný soubor: `cmd.exe`, argument: `/c "C:\Users\daavi\Desktop\VIBECODING\Prirozeny-beh-reporting\shoptet-reporting\scripts\updateData.bat"`
- `DisallowStartIfOnBatteries` = false (taska se spustí i na baterii)

### Databáze (PostgreSQL / Neon)

Připojení přes `lib/db.ts` — singleton `Pool` z balíčku `pg`.

```
DATABASE_URL=postgresql://neondb_owner:...@ep-green-star-alp25wte-pooler.c-3.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require
```

**SSL musí být vždy zapnuté** (`ssl: { rejectUnauthorized: false }`) — Neon vyžaduje SSL i lokálně.

**Tabulky:**
- `users` — přihlašovací účty (id, email, name, password_hash, role, created_at)

**Utility:**
- `lib/db.ts` — pool singleton
- `lib/users.ts` — CRUD funkce (getUsers, getUserByEmail, addUser, deleteUser, updatePassword)
- `scripts/migrate.js` — vytvoří tabulky (idempotentní, `IF NOT EXISTS`)
- `scripts/seedAdmin.js` — vytvoří admin účet: `node --env-file=.env.local scripts/seedAdmin.js email jméno heslo`

### Autentizace

NextAuth 5 (beta). Uživatelé jsou uloženi v **PostgreSQL** (tabulka `users`, bcrypt hesla). Admin stránka `/admin/users` vyžaduje `role: 'admin'`.

- `auth.ts` — NextAuth konfigurace s Credentials providerem; volá `getUserByEmail()` z `lib/users.ts`
- `AUTH_SECRET` — musí být nastaveno v `.env.local` (vygenerovat: `node -e "require('crypto').randomBytes(32).toString('base64url')|console.log"`)
- Tlačítko **Aktualizovat data** v TopBaru je viditelné **pouze adminům** (kontrola přes `useSession`)

### Stránky

| Stránka | Popis |
|---------|-------|
| `/hlavni-dashboard` | **Hlavní Dashboard** — měsíční přehled 8 KPI metrik jako grouped bar charty (Tržby bez DPH, Hrubý zisk, Počet obj., Mark. investice, PNO %, AOV, Marže %, CPA). **Selektor jednotlivých roků** v TopBaru (yearB = selectedYear − 1, automaticky). Výchozí přesměrování z `/`. |
| `/dashboard` | **Klíčové ukazatele (KPI)** — Tržby s/bez DPH, Počet obj., AOV, Marketing. investice, PNO, CPA, Marže, Marže %, Cena za nového zákazníka, Hrubý zisk na obj. + samostatný řádek Hrubý zisk + Hrubý zisk %. Pod KPI boxy: **4 samostatné spojnicové grafy YoY** z `KpiLineCharts`. |
| `/prodejna` | **Prodejna** — samostatná stránka pouze pro objednávky se status_id 19 (Obchod – Vydáno) a 21 (Obchod – Objednávka). KPI boxy: Tržby s/bez DPH, Počet obj., AOV, Marže, Marže %, Hrubý zisk na obj., Hrubý zisk, Hrubý zisk %. Grafy: Tržby+objednávky, AOV, Hrubý zisk. Denní tabulka se stránkováním. Bez marketingových metrik (PNO, CPA, náklady). Data z `data/prodejnaDataCZ.ts` + `data/prodejnaMarginDataCZ.ts`. |
| `/orders` | Objednávky — tržby vs počet, distribuce hodnot košíku (histogram) |
| `/marketing` | Marketingové investice — 5 kanálů (FB, Google, Seznam, Zboží, Heureka); CPC trend, denní tabulka, source breakdown |
| `/products` | Prodejnost produktů — ABC analýza, sortovatelná tabulka (vč. Marže Kč + Marže %), YoY, CSV export, graf vývoje tržeb pro vybraný produkt |
| `/margin` | Maržový report — marže %, hrubý zisk, grafy |
| `/analytics` | GA4 integrace — sessions, CVR, sources+devices (YoY), vstupní stránky, trychtýř košíku. **Pouze CZ.** |
| `/meta` | Meta Ads — KPI s YoY, grafy po dnech, tabulka kreativ s filtrem kampaně+sady reklam |
| `/behavior` | Nákupní chování — týdenní srovnání, hourly grid (all-time agregace) |
| `/crosssell` | Cross-sell potenciál — top 100 produktových párů |
| `/retention` | Retenční analýza — RFM segmentace, LTV, AOV, repeat purchase rate, měsíční graf Noví vs. stávající zákazníci (100% stacked bar) |
| `/shipping` | Doprava a platby — KPI vč. zisku/ztráty dopravy, ceník dopravců, P&L tabulka per dopravce |
| `/stock` | Stav skladu — KPI boxy (hodnota zboží s DPH, hodnota zboží bez DPH, celkem variant, skladem, u dodavatele, vyprodáno, celkem kusů), prodeje dle dostupnosti, timeseriesový graf, sortovatelná tabulka produktů (kód, název, sklad ks, hodnota zboží, obrátka/den, dojde za, stav) + tabulka dle značky (sklad ks, hodnota, obrátka/den). Klasifikace skladem/dodavatel určena z individuálních variant (majority vote), nikoliv z produktového `variants_availability_type`. |
| `/brands` | Analýza značek — tržby s/bez DPH, marže, počet ks dle výrobce; trendový line chart s YoY (plná = akt., čárkovaná = min.) a autocomplete výběrem značek; sortovatelná tabulka s YoY badges (hodnota nad, badge pod); data z Upgates API přes `lib/upgatesProducts.ts` + `productDataCZ` |
| `/login` | Přihlášení (NextAuth) |
| `/admin/users` | Správa uživatelů (admin only) |

### Práce s měnami

Data jsou výhradně **CZ v CZK**. Všechny money formattery berou `currency: 'CZK'`.

### Meziroční srovnání (YoY)

CZ e-shop běží od května 2025 — **YoY data nejsou k dispozici**. `hasPrevData` bude `false` pro všechny CZ pohledy. Předávej do `KpiCard`, `RevenueOrdersChart` a `CostPnoChart`, aby šlo podmíněně skrýt YoY badge.

### Hlavní Dashboard (`/hlavni-dashboard`)

Výchozí stránka aplikace (redirect z `/`). Zobrazuje 8 grouped bar chartů s měsíčními daty pro 2 vybrané roky.

**Selektory** — zobrazují se v TopBaru, když je aktivní cesta `/hlavni-dashboard`:
- Skupina tlačítek **jednotlivých roků** — výběrem roku se `yearB` nastaví automaticky na `selectedYear − 1`

`hooks/useHlavniDashboard.tsx` — stav: `selectedYear`, `setSelectedYear`, `yearOptions: number[]`; `yearA = selectedYear`, `yearB = selectedYear - 1`. Selektor trhu byl odstraněn — data jsou výhradně CZ.

**Stav** — spravován v `hooks/useHlavniDashboard.tsx` (`HlavniDashboardProvider` je v `ConditionalLayout`). Stránka stav pouze čte přes `useHlavniDashboard()`.

**Grafy (2×4 grid + Konverzní poměr):** Tržby bez DPH (modrá), Hrubý zisk (zelená), Počet objednávek (modrá), Marketingové investice (červená), PNO % (cyan), AOV (indigo), Marže % (zelená), CPA (fialová). Světlejší barva = starší rok, tmavší = novější rok.

**Konverzní poměr (GA4)** — 9. graf, fetchován z `/api/analytics/monthly-cvr?yearA=&yearB=` při změně roků (`useEffect`). Zobrazí se až po načtení dat. Podtitulek "Zdroj: GA4 · pouze CZ". Teal barvy: tmavší (#0e7490) = novější rok, světlejší (#a5f3fc) = starší rok.

**Hrubý zisk** = `marginRev - purchaseCost - cost`.

### Klíčové soubory

| Soubor | Účel |
|--------|------|
| `data/types.ts` | `DailyRecord`, `KpiData`, `FilterState`, `TimePeriod`, `EUR_TO_CZK` |
| `data/mockGenerator.ts` | CZ-only data; `getDailyMarketingData()` + `getMarketingSourceData()` (5 kanálů) |
| `data/realDataCZ.ts` | Auto-gen reálná CZ data (CZK) — **needitovat ručně** |
| `data/lastUpdate.ts` | Auto-gen timestamp poslední aktualizace dat — **needitovat ručně** |
| `data/productDataCZ.ts` | Prodej produktů (počet kusů, tržby, `purchaseCost`) — auto-gen |
| `data/marginDataCZ.ts` | Marže (nákupní cena vs tržby bez DPH) — auto-gen |
| `data/hourlyDataCZ.ts` | Nákupní chování 7×24 grid — auto-gen, all-time |
| `data/crossSellDataCZ.ts` | Top 100 produktových párů — auto-gen |
| `data/retentionDataCZ.ts` | Per-customer retence `{ dates, revenues, revsVat }[]` — auto-gen |
| `data/orderValueDataCZ.ts` | Per-order košík bez DPH `{ date, value }[]` — auto-gen |
| `data/shippingPaymentDataCZ.ts` | Doprava+platby po dnech — auto-gen |
| `data/prodejnaDataCZ.ts` | Prodejna objednávky (status 19+21) po dnech: orders, revenue_vat, revenue — auto-gen |
| `data/prodejnaMarginDataCZ.ts` | Marže prodejna objednávek po dnech — auto-gen (stejná struktura jako `marginDataCZ`) |
| `lib/db.ts` | PostgreSQL pool singleton (Neon, SSL vždy zapnuté) |
| `lib/users.ts` | CRUD funkce pro tabulku users |
| `lib/retentionUtils.ts` | Všechny výpočty pro `/retention` (KPI, YoY, RFM, distribuce, Noví vs. stávající) |
| `lib/formatters.ts` | `formatCurrency`, `formatPercent`, `formatNumber`, `formatDate`, `formatShortDate`, `formatMonthYear`, `localIsoDate` |
| `scripts/updateData.js` | Stáhne objednávky z Upgates + náklady z Google Sheets, generuje data/*.ts, git commit+push |
| `scripts/upgatesClient.js` | Upgates API klient — full/incremental sync, cache, rate limit handling |
| `scripts/migrate.js` | Vytvoří DB tabulky |
| `scripts/seedAdmin.js` | Vytvoří admin účet |
| `app/api/analytics/monthly-cvr/route.ts` | GA4 měsíční CVR pro Hlavní dashboard — `?yearA=&yearB=` → `{ cvrA[], cvrB[] }` |
| `lib/upgatesProducts.ts` | Sdílená 1h in-process cache + `getProducts()` + `czName()` — importováno z `/api/stock` i `/api/brands` |
| `app/api/stock/route.ts` | Upgates produkty — klasifikace dostupnosti, prodeje, obrátka; používá sdílenou cache z `lib/upgatesProducts.ts`. `StockKpi` obsahuje `totalStockValue` (bez DPH) i `totalStockValueVat` (s DPH). Pro produkty s variantami se typ (stock/supplier) určuje majority votem z `availability_type` jednotlivých variant. |
| `app/api/brands/route.ts` | Agregace `productDataCZ` dle výrobce (Upgates name→manufacturer); vrací `brands[]` + `daily[]` + `dailyPrev[]` pro chart; params: `from/to/prevFrom/prevTo` |
| `app/api/meta/route.ts` | Meta Marketing API — KPI + denní breakdown + kreativy; filtruje kampaně "myfish" |
| `app/meta/page.tsx` | Meta Ads stránka — KPI s YoY, grafy po dnech, tabulka kreativ |
| `components/kpi/StatCard.tsx` | KPI karta (border-2 border-blue-800); prop `negative` = rose varianta; `yoy`, `hasPrevData`, `invertYoy` |
| `components/kpi/KpiCard.tsx` | KPI karta se sparkline a YoY badge; `variant: 'default' \| 'green' \| 'red'` |
| `components/charts/KpiLineCharts.tsx` | 4 spojnicové grafy YoY pro `/dashboard`. Prop `isMonthly` přepíná formát osy X. |
| `hooks/useFilters.ts` | `FiltersProvider` + `useFilters()` + `getDateRange()` + live EUR rate |
| `hooks/useDashboardData.ts` | Filtruje, agreguje, počítá KPI + chartData + YoY |
| `hooks/useHlavniDashboard.tsx` | Context pro Hlavní Dashboard — `yearA`, `yearB`, `yearOptions` |
| `app/api/update/route.ts` | POST endpoint — admin only; na Vercelu volá Deploy Hook, lokálně spustí skript |

### KPI komponenty

Dva typy KPI karet — **neměnit vzájemně**:
- **`StatCard`** — používají `/margin`, `/retention`, `/crosssell`. Prop `negative` = rose border/barva.
- **`KpiCard`** — používají `/dashboard`, `/orders`, `/marketing`, `/products`, `/shipping`. Varianty:
  - `'default'` — modrý rámeček (výchozí)
  - `'green'` — tmavě zelený rámeček + zelená hodnota (Hrubý zisk)
  - `'red'` — červený rámeček + červená hodnota (ztráta dopravy)

### `localIsoDate(d: Date)`

Funkce v `lib/formatters.ts` — vrací datum jako `"YYYY-MM-DD"` v **lokálním čase** (bez UTC konverze). Používat všude místo `.toISOString().split('T')[0]`, jinak v CEST (UTC+2) dochází k posunutí data o den zpět.

### `/dashboard` — Klíčové ukazatele (KPI)

KPI boxy (11 + 2 ve vlastním řádku): Tržby s/bez DPH, Počet obj., AOV, Marketing. investice, PNO, CPA, Marže, Marže %, Cena za nového zákazníka, Hrubý zisk na objednávku + **samostatný řádek: Hrubý zisk, Hrubý zisk %** (variant='green').

**Grafy (4 celkem, 2×2 mřížka):** Tržby+Objednávky, Náklady+PNO, AOV (YoY), CPA (YoY) — komponenty `AovChart` a `CpaChart` z `components/charts/AovCpaChart.tsx`.

**Grafy prodloužené do konce měsíce/roku (`chartDataExtended`, 2026-08):** U otevřených period (`current_month`/`current_year`) `hooks/useDashboardData.ts` vrací kromě `chartData` (jen dny s reálnými daty) i `chartDataExtended` — sjednocení dní aktuálního období s loňskými daty rozšířenými až do konce měsíce/roku, takže loňská (přerušovaná) křivka pokračuje až na konec osy X, zatímco letošní křivka viditelně končí posledním dostupným dnem (pole = `null` pro dny bez letošních dat). `KpiLineCharts.tsx` a `AovCpaChart.tsx` přijímají `ExtendedChartDataPoint[]`; jejich tooltipy filtrují `p.value != null`, aby u budoucích dnů nezobrazily zavádějící „0". Sparklines v KPI kartách nadále používají nerozšířený `chartData`. Stejný princip jako u Celtic-supply reportingu.

**Odstraněno:** Storna, Podíl storen, sekce Prodejna (přesunuta na `/prodejna`).

Marže a Hrubý zisk se počítají z `marginDataCZ`:
- `margin = marginRev - purchaseCost`
- `marginPct = margin / marginRev × 100`
- `grossProfit = margin - kpi.cost`
- `grossPct = grossProfit / marginRev × 100`

### `/prodejna` — Prodejna

Samostatná stránka pro objednávky se **status_id 19** (Obchod – Vydáno) a **21** (Obchod – Objednávka). Data z `prodejnaDataCZ.ts` + `prodejnaMarginDataCZ.ts` — generuje `updateData.js` přes funkce `aggregateOrdersProdejna()` a `aggregateMarginProdejna()`.

**KPI boxy (7 + 2 ve vlastním řádku):** Tržby s/bez DPH, Počet obj., AOV, Marže, Marže %, Hrubý zisk na obj. + řádek Hrubý zisk + Hrubý zisk % (variant='green').

**Grafy:** Tržby bez DPH + objednávky (ComposedChart), AOV (LineChart), Hrubý zisk (Bar).

**Tabulka:** Denní přehled (datum s rokem, obj., tržby s/bez DPH, AOV, hrubý zisk, marže %) — stránkování po 20 řádcích, řazeno od nejnovějšího. Zobrazí se pouze dny s ≥1 prodejna objednávkou.

**Bez:** PNO, CPA, marketingové investice.

### `/marketing` — Marketing

5 kanálů zobrazených v UI:
- **Facebook, Google, Seznam** — KPI karty s Náklady / Kliky / CPC + YoY badge
- **Zboží.cz, Heureka.cz** — KPI karty s Náklady / PNO
- CPC trend graf: stacked bars kliky (FB/Google/Seznam) + lines CPC
- Denní tabulka: 7 sloupců (Datum, Celkem, Facebook, Google, Seznam, Zboží, Heureka)
- Source breakdown tabulka: Kanál, Náklady, Kliky, CPC, Objednávky, Tržby, PNO, CPA

Data z `getDailyMarketingData()` a `getMarketingSourceData()` v `data/mockGenerator.ts`.

**ROAS byl odstraněn** ze všech přehledů.

### `/retention` — Retenční analýza

Sjednoceno se strukturou Celtic-supply reportingu (2026-08). Dva grouped bar charty hned pod KPI boxy (dva sloupce vedle sebe per měsíc, ne stacked, ne 100% stacked):
- **„Noví vs. stávající zákazníci — vývoj po měsících"** — absolutní počty, data z `computeMonthlyNewVsReturning()` v `lib/retentionUtils.ts`. Zelená = noví (první nákup v daném měsíci), modrá = stávající (vrátili se).
- **„Noví vs. stávající zákazníci — tržby bez DPH po měsících"** — stejná struktura, data z `computeMonthlyNewVsReturningRevenue()` (sčítá `c.revenues`)

Tooltip obou grafů (custom `content` v `app/retention/page.tsx`) zobrazuje hodnotu + podíl v měsíci, srovnání se stejným měsícem loňského roku (YoY % + předchozí hodnota) a řádek Celkem.

**Meziroční srovnání aktuálního (nedokončeného) měsíce k předcházejícímu dni, ne k celému loňskému měsíci** — `computeCurrentMonthYoyCutoff()` v `lib/retentionUtils.ts` spočítá loňská data jen do stejného dne v měsíci jako letos (`cutoffDay` = den včerejška). Tooltip při najetí na aktuální měsíc použije tato cutoff data a zobrazí popisek „vs. loňský rok (do X. dne)" místo celého loňského měsíce.

- RFM segmentace, LTV, AOV, repeat purchase rate

### `/shipping` — Doprava a platby

**KPI boxy sekce Doprava:**
- `Doprava zákazník` — příjmy od zákazníků za dopravu
- `Doprava e-shop` — náklady e-shopu dle ceníku dopravců
- `Doprava zisk / ztráta` — rozdíl; `variant='green'` nebo `'red'`
- `Prům. doprava` — průměrná doprava na objednávku
- `Doprava zdarma` — počet objednávek s dopravou zdarma (revenue_vat === 0 nebo name obsahuje "zdarma"/"free")
- `Doprava zdarma %` — podíl objednávek s dopravou zdarma z celkového počtu

**Ceník dopravců** — editovatelná tabulka uložená v `localStorage` (`carrierCosts_v1`).

**Tabulka Zisk / ztráta per dopravce** — zobrazí se pouze pokud je vyplněn ceník.

### Struktura sidebaru (`components/layout/Sidebar.tsx`)

Navigace je rozdělena do sekcí pomocí pole `NAV_SECTIONS`. Každá sekce má `label` (nadpis) a `items[]`.

| Sekce | Položky (label → route) |
|-------|------------------------|
| Strategický přehled | Hlavní Dashboard `/hlavni-dashboard`, Hlavní KPI `/dashboard`, Marketingový Mix & PNO `/marketing` |
| Prodej a profitabilita | Výkon prodeje `/orders`, Prodejna `/prodejna`, Analýza marží `/margin`, Doprava a platba `/shipping` |
| Produktová analytika | Produktový žebříček `/products`, Analýza značek `/brands`, Stav skladu `/stock`, Cross-sell potenciál `/crosssell` |
| Zákazníci a retence | Nákupní chování `/behavior`, Retenční analýza `/retention` |
| Akvizice a kanály | Webová návštěvnost (GA4) `/analytics` |
| Admin (podmíněně) | Správa uživatelů `/admin/users` (jen pro role=admin) |

### Skryté sekce (sidebar)

Následující stránky **existují v kódu**, ale nejsou zobrazeny v navigaci:

| Stránka | Route | Důvod skrytí |
|---------|-------|--------------|
| Meta Ads | `/meta` | Chybí `META_ACCESS_TOKEN` |
| Google Ads | `/google-ads` | Nenaplněno daty |

Až bude potřeba zpřístupnit, přidat položku do příslušné sekce v `NAV_SECTIONS`.

### ABC analýza produktů (`/products`)

Klasifikace dle kumulativního podílu na tržbách bez DPH:
- **A** — 0–80 % tržeb (zelené)
- **B** — 80–95 % tržeb (žluté)
- **C** — 95–100 % tržeb (červené)

**Marže barevné kódování** (sloupec Marže % v tabulce produktů):
- zelená — ≥ 30 %
- amber — ≥ 15 %
- rose — < 15 %

### `/orders` — Objednávky

**Grafy (pořadí):**
1. Tržby a objednávky (ComposedChart — Bar tržby + Line objednávky)
2. Storna a podíl storen (ComposedChart — Bar počet storen + Line % podíl); denně ≤60 dní, měsíčně >60 dní
3. Distribuce hodnot objednávek (histogram)

### Distribuce hodnot objednávek (`/orders`)

`orderValueDataCZ` = per-order košík bez DPH. CZK buckety: 0–500, 500–1k, 1k–2k, 2k–5k, 5k+. Histogram zobrazuje peak bucket (tmavě modrý).

### RFM segmentace zákazníků (`/retention`)

Výpočet v `lib/retentionUtils.ts` → `computeRfmSegments()`. Referenční datum = nejnovější objednávka.

| Segment | Podmínka (priority pořadí) |
|---------|---------------------------|
| Ztracení | R > 365 dní |
| Šampioni | F ≥ 3 AND R ≤ 90 dní |
| Věrní zákazníci | F ≥ 2 AND R ≤ 180 dní |
| Ohrožení | F ≥ 2 AND R > 180 dní |
| Noví zákazníci | F = 1 AND R ≤ 90 dní |
| Jednorázové | F = 1, ostatní |

### Definice Noví vs. Stávající zákazníci (`/retention`)

- **Noví** = zákazník, jehož úplně první nákup je v daném roce
- **Stávající** = zákazník, který měl v daném roce svůj 2.+ nákup vůbec
- Jeden zákazník **může být v obou kategoriích** v jednom roce

### Filtr období (TopBar)

Dostupné možnosti `TimePeriod`:
- `current_year`, `current_month`, `last_month`, `last_14_days`, `last_7_days`, `yesterday`, `last_year`, `all_time`, `custom`

`all_time` začíná od `2023-03-03` (první CZ objednávka). Logika datových rozsahů v `hooks/useFilters.ts` → `getDateRange()`.

### Selektor Trh (TopBar)

Selektor trhu byl **odstraněn ze všech stránek** — aplikace pracuje výhradně s CZ daty v CZK.

### Konstanta `TODAY`

`hooks/useFilters.ts` používá aktuální datum dynamicky (`const TODAY = new Date()`). Používej `localIsoDate()` pro grouping po dnech — viz výše.

### Vzorec PNO

`PNO = Marketingové investice / Tržby bez DPH × 100`

### Hourly data

Hourly grid na `/behavior` je **all-time agregace** — nezohledňuje vybrané časové období.

### GA4

GA4 je napojeno pouze pro **CZ**. Service account: `ga4-reporting@prirozeny-beh.iam.gserviceaccount.com`, Property ID: `358727482`.

**Env proměnné:**
```
GA4_PROPERTY_ID=358727482
GA4_CLIENT_EMAIL=ga4-reporting@prirozeny-beh.iam.gserviceaccount.com
GA4_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```
`GA4_PRIVATE_KEY` musí mít `\n` jako doslovné znaky (ne reálné newliny) — route.ts volá `.replace(/\\n/g, '\n')` při inicializaci klienta.

**`app/api/analytics/route.ts`** — vrací:
- `daily`, `dailyPrev` — denní sessions/users/conversions/bounceRate/avgDuration
- `totals` — agregáty za aktuální + předchozí rok
- `sources`, `sourcesPrev` — zdroje návštěvnosti (top 20)
- `devices`, `devicesPrev` — rozpad na deviceCategory
- `landingPages` — vstupní stránky (top 20)
- `funnel` — checkout trychtýř: begin_checkout → add_shipping_info → add_payment_info → purchase
- `funnelTrend` — denní průchodnost košíkem

**`app/api/analytics/monthly-cvr/route.ts`** — měsíční konverzní poměr pro Hlavní dashboard. Přijímá `?yearA=&yearB=`, fetchuje sessions + conversions z GA4 pro oba roky paralelně (dimenze `yearMonth`), vrací `{ cvrA: number[12], cvrB: number[12] }`.

### Branding

- Název aplikace: **Manažerský reporting**
- Logo: `public/logo.png`
- Sidebar: logo + text "Manažerský / reporting"

### `/meta` — Meta Ads

**Env proměnné:**
```
META_ACCESS_TOKEN=...
META_AD_ACCOUNT_ID_CZ=act_...
```

**Filtr MyFish:** Kampaně obsahující `"myfish"` jsou vyloučeny ze všech metrik. Konstanta `EXCLUDE_CAMPAIGN = 'myfish'` v `route.ts`.

**KPI agregace:** Na úrovni `level=campaign` (ne account-level), aby šlo filtrovat MyFish.

**YoY:** API fetchuje předchozí rok posunutím `time_range` o -1 rok.

### Názvy měsíců v grafech

Grafy s rozpadem po měsících zobrazují české zkratky (`formatMonthYear` z `lib/formatters.ts`).

### Pre-existing TS chyby

`app/shipping/page.tsx` má ~8 TS chyb (Recharts PieLabel + Tooltip typy). Jsou **pre-existující** — neřešit, pokud se nerefaktoruje shipping stránka.
