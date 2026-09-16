/**
 * Slovník klíčových metrik (/slovnik).
 *
 * Vzorce odpovídají skutečnému výpočtu v aplikaci. Benchmarky jsou orientační rozpětí z praxe
 * e-shopů v daném segmentu v CZ/SK a nejde o oficiální statistiku.
 * Aktuální hodnoty dopočítává `lib/glossaryValues.ts`.
 */

export type MetricCategory = 'obrat' | 'ziskovost' | 'marketing' | 'zakaznici' | 'web' | 'meta' | 'provoz';

export type CurrentValueKey =
  | 'revenueVat' | 'revenue' | 'orders' | 'aov'
  | 'margin' | 'marginPct' | 'grossProfit' | 'grossPct' | 'grossPerOrder' | 'grossPerNewCustomer'
  | 'cost' | 'costNoBrand' | 'pno' | 'pnoNoBrand' | 'poas' | 'poasNoBrand' | 'cpa'
  | 'cac' | 'ltv' | 'ltvProfit' | 'ltvCac' | 'repeatRate' | 'daysBetween';

export type ValueFormat = 'currency' | 'percent' | 'number' | 'ratio' | 'days';

export interface Benchmark {
  /** Text benchmarku zobrazený uživateli */
  text: string;
  /** Číselné rozpětí pro barevné vyhodnocení (ve stejné jednotce jako aktuální hodnota) */
  min?: number;
  max?: number;
  /** higher = čím víc, tím lépe; lower = čím míň, tím lépe; range = ideálně uvnitř rozpětí */
  better?: 'higher' | 'lower' | 'range';
}

export interface MetricDefinition {
  id: string;
  name: string;
  category: MetricCategory;
  meaning: string;
  formula: string;
  where: string[];
  benchmark?: Benchmark;
  note?: string;
  current?: { key: CurrentValueKey; format: ValueFormat };
}

export const CATEGORY_LABELS: Partial<Record<MetricCategory, string>> = {
  obrat: "Obrat a objednávky",
  ziskovost: "Ziskovost",
  marketing: "Marketingová efektivita",
  zakaznici: "Zákazníci a retence",
  web: "Webová návštěvnost (GA4)",
  provoz: "Produkty a doprava",
};

export const VALUE_LABEL = "Přirozený běh";

export const VALUE_SCOPE = "CZ e-shop bez kamenné prodejny (marketing cílí na e-shop, prodejna by PNO a CPA zkreslila).";

export const SEGMENT_LABEL = "barefoot obuvi";

export const SEGMENT_DESCRIPTION =
  "Přirozený běh prodává barefoot obuv a doplňky přes e-shop (CZ, SK) a kamennou prodejnu v Třebíči. Obuv má vyšší hodnotu objednávky, výraznou sezónnost a řeší se u ní velikosti a výměny. Zákazník, který si barefoot obuv oblíbí, se k značkám vrací, proto je vedle PNO důležitá retence.";

export const METRICS: MetricDefinition[] = [
  {
    id: "trzby-s-dph",
    name: "Tržby s DPH",
    category: "obrat",
    meaning: "Celková hodnota objednávek, kterou zákazníci zaplatili, včetně DPH. Odpovídá tomu, co vidí zákazník v košíku.",
    formula: "Σ hodnota objednávek s DPH\n(bez stornovaných a vrácených objednávek)",
    where: ["Hlavní KPI", "Výkon prodeje"],
    benchmark: { text: "Absolutní hodnota nemá tržní benchmark, sledujte meziroční vývoj (YoY) a sezónnost (jaro a podzim, Vánoce)." },
    current: { key: "revenueVat", format: "currency" },
  },
  {
    id: "trzby-bez-dph",
    name: "Tržby bez DPH",
    category: "obrat",
    meaning: "Obrat, který skutečně zůstává firmě (bez DPH odvedené státu). Je základem pro PNO, marži i hrubý zisk.",
    formula: "Σ hodnota objednávek bez DPH\n(bez stornovaných a vrácených objednávek)",
    where: ["Hlavní Dashboard", "Hlavní KPI", "Výkon prodeje", "Produktový žebříček"],
    benchmark: { text: "Bez tržního benchmarku, jde o hlavní měřítko růstu. Zdravý e-shop v růstové fázi roste meziročně dvouciferně." },
    current: { key: "revenue", format: "currency" },
  },
  {
    id: "pocet-objednavek",
    name: "Počet objednávek",
    category: "obrat",
    meaning: "Počet dokončených objednávek. Ukazuje, zda růst tržeb táhne víc nákupů, nebo jen vyšší hodnota košíku.",
    formula: "Σ objednávek (bez storen)",
    where: ["Hlavní Dashboard", "Hlavní KPI", "Výkon prodeje"],
    benchmark: { text: "Bez tržního benchmarku. Porovnávejte YoY a v poměru k návštěvnosti (konverzní poměr)." },
    current: { key: "orders", format: "number" },
  },
  {
    id: "aov",
    name: "AOV (průměrná hodnota objednávky)",
    category: "obrat",
    meaning: "Kolik zákazník v průměru utratí za jednu objednávku. Vyšší AOV rozkládá náklady na dopravu a marketing na větší částku.",
    formula: "Hlavní KPI:        Tržby s DPH / Počet objednávek\nHlavní Dashboard:  Tržby bez DPH / Počet objednávek",
    where: ["Hlavní Dashboard", "Hlavní KPI"],
    benchmark: { text: "Barefoot obuv má AOV orientačně 1 800 až 3 000 Kč s DPH (jeden pár, případně s doplňky).", min: 1800, max: 3000, better: "higher" },
    note: "Pozor: na Hlavních KPI je AOV s DPH, na Hlavním Dashboardu bez DPH, hodnoty se proto liší zhruba o sazbu DPH.",
    current: { key: "aov", format: "currency" },
  },
  {
    id: "marze",
    name: "Marže",
    category: "ziskovost",
    meaning: "Obchodní přirážka v korunách, tedy kolik zbude z tržeb po odečtení nákupní ceny zboží. Z ní se platí marketing, doprava i provoz.",
    formula: "Tržby bez DPH − Nákupní cena prodaného zboží",
    where: ["Hlavní KPI", "Analýza marží"],
    benchmark: { text: "Absolutní hodnota bez benchmarku, sledujte YoY a poměr k marketingovým investicím (POAS)." },
    note: "SK nemá v datech nákupní ceny před 5/2025. Za starší období vychází SK marže 100 % a je nadhodnocená.",
    current: { key: "margin", format: "currency" },
  },
  {
    id: "marze-pct",
    name: "Marže %",
    category: "ziskovost",
    meaning: "Jaký podíl z tržeb bez DPH tvoří marže. Určuje, kolik si e-shop může dovolit utratit za marketing.",
    formula: "Marže / Tržby bez DPH × 100",
    where: ["Hlavní Dashboard", "Hlavní KPI", "Analýza marží"],
    benchmark: { text: "Značková obuv v e-commerce orientačně 35 až 50 %. Výprodeje sezónního zboží marži snižují.", min: 35, max: 50, better: "higher" },
    current: { key: "marginPct", format: "percent" },
  },
  {
    id: "hruby-zisk",
    name: "Hrubý zisk",
    category: "ziskovost",
    meaning: "Co zbude z marže po zaplacení marketingu (příspěvek na úhradu provozu). V aplikaci nejde o účetní hrubý zisk, neodečítá dopravu, platby ani mzdy.",
    formula: "Marže − Marketingové investice",
    where: ["Hlavní Dashboard", "Hlavní KPI", "Analýza marží"],
    benchmark: { text: "Musí být kladný; absolutní výši porovnávejte s fixními náklady firmy (sklad, mzdy, software)." },
    current: { key: "grossProfit", format: "currency" },
  },
  {
    id: "hruby-zisk-pct",
    name: "Hrubý zisk %",
    category: "ziskovost",
    meaning: "Podíl hrubého zisku (po marketingu) na tržbách bez DPH. Jednoduchý ukazatel, zda je růst ziskový.",
    formula: "Hrubý zisk / Tržby bez DPH × 100\n= Marže % − PNO",
    where: ["Hlavní KPI", "Analýza marží"],
    benchmark: { text: "Orientačně 20 až 35 % je zdravé pásmo díky vyšší hodnotě objednávky.", min: 20, max: 35, better: "higher" },
    current: { key: "grossPct", format: "percent" },
  },
  {
    id: "hruby-zisk-obj",
    name: "Hrubý zisk na objednávku",
    category: "ziskovost",
    meaning: "Kolik korun hrubého zisku v průměru přinese jedna objednávka. Z této částky se musí zaplatit balení, doprava zdarma a provoz.",
    formula: "Hrubý zisk / Počet objednávek",
    where: ["Hlavní KPI"],
    benchmark: { text: "Mělo by pokrýt dopravu, balení a náklady na případnou výměnu velikosti (orientačně 150 až 300 Kč) s rezervou." },
    current: { key: "grossPerOrder", format: "currency" },
  },
  {
    id: "marketingove-investice",
    name: "Marketingové investice",
    category: "marketing",
    meaning: "Celkové náklady na placenou reklamu za období.",
    formula: "Σ náklady Google Ads + Meta (Facebook/Instagram) + Sklik + Zboží.cz + Heureka + Tanganica",
    where: ["Hlavní Dashboard", "Hlavní KPI", "Marketingový Mix & PNO"],
    benchmark: { text: "Bez absolutního benchmarku, hodnotí se vždy v poměru k tržbám (PNO) nebo marži (POAS)." },
    current: { key: "cost", format: "currency" },
  },
  {
    id: "pno",
    name: "PNO (podíl nákladů na obratu)",
    category: "marketing",
    meaning: "Kolik procent z tržeb bez DPH stojí marketing. Nejběžnější metrika efektivity reklamy v Česku.",
    formula: "Marketingové investice / Tržby bez DPH × 100",
    where: ["Hlavní Dashboard", "Hlavní KPI", "Marketingový Mix & PNO"],
    benchmark: { text: "Obuv v CZ orientačně 10 až 18 %; vyšší AOV snese nižší PNO než levné zboží. Tvrdá hranice: PNO musí být nižší než Marže %, jinak marketing prodělává.", min: 10, max: 18, better: "lower" },
    note: "PNO počítá všechny tržby (i organické a opakované nákupy), ne jen tržby přivedené reklamou. Vrácené a vyměněné páry nejsou v tržbách vždy zachycené hned, PNO proto může být reálně o něco vyšší.",
    current: { key: "pno", format: "percent" },
  },
  {
    id: "poas",
    name: "POAS (zisk z investice do reklamy)",
    category: "marketing",
    meaning: "Kolik korun marže přinese každá koruna vložená do marketingu. Na rozdíl od PNO a ROAS zohledňuje marži, takže lépe ukazuje skutečnou ziskovost reklamy.",
    formula: "Marže / Marketingové investice",
    where: ["Hlavní Dashboard", "Hlavní KPI"],
    benchmark: { text: "Pod 1,0× marketing prodělává marži · 1 až 2× akviziční fáze · 3 až 5× zdravý stav u obuvi · nad 5× prostor přidat rozpočet.", min: 3, max: 5, better: "higher" },
    note: "POAS 1,0× = hranice, kdy marketing spotřebuje celou marži. POAS = Marže % / PNO.",
    current: { key: "poas", format: "ratio" },
  },
  {
    id: "cpa",
    name: "Cena za objednávku (CPA)",
    category: "marketing",
    meaning: "Kolik marketingu připadá na jednu objednávku. Počítá se ze všech objednávek, ne jen z těch, které přivedla reklama.",
    formula: "Marketingové investice / Počet objednávek",
    where: ["Hlavní Dashboard", "Hlavní KPI", "Marketingový Mix & PNO"],
    benchmark: { text: "Tržní benchmark závisí na AOV. Maximální udržitelná CPA ≈ AOV bez DPH × Marže % (pak je hrubý zisk nulový); zdravá CPA je do poloviny této hodnoty." },
    current: { key: "cpa", format: "currency" },
  },
  {
    id: "cpc",
    name: "CPC (cena za proklik)",
    category: "marketing",
    meaning: "Kolik stojí jeden proklik z reklamy. Sleduje se zvlášť pro každý reklamní kanál.",
    formula: "Náklady kanálu / Počet prokliků kanálu",
    where: ["Marketingový Mix & PNO"],
    benchmark: { text: "Obuv v CZ orientačně: Google Ads 5 až 15 Kč, Sklik 4 až 10 Kč, Zboží.cz a Heureka 3 až 8 Kč, Meta 4 až 10 Kč." },
  },
  {
    id: "cac",
    name: "Cena za nového zákazníka (CAC)",
    category: "zakaznici",
    meaning: "Kolik marketingu připadá na jednoho zákazníka, který v období nakoupil poprvé.",
    formula: "Marketingové investice / Počet nových zákazníků\n(nový = první objednávka vůbec padla do období)",
    where: ["Hlavní KPI", "Retenční analýza"],
    benchmark: { text: "Samostatně bez benchmarku, hodnotí se vůči ziskovému LTV (poměr LTV a CAC)." },
    note: "Celé marketingové náklady se dělí jen novými zákazníky, i když část rozpočtu přivádí stávající zákazníky, CAC je tedy spíš horní odhad.",
    current: { key: "cac", format: "currency" },
  },
  {
    id: "ltv",
    name: "LTV (bez DPH)",
    category: "zakaznici",
    meaning: "Průměrný obrat, který e-shop od jednoho zákazníka získal za celou dobu vztahu.",
    formula: "Σ tržby bez DPH všech zákazníků / Počet zákazníků\n(celé období, nezávisí na filtru období)",
    where: ["Hlavní Dashboard", "Hlavní KPI"],
    benchmark: { text: "Zákazník barefoot obuvi často dokupuje další páry, LTV bývá orientačně 1,4 až 2násobek AOV bez DPH." },
    note: "Retenční analýza zobrazuje LTV s DPH, Hlavní KPI a Hlavní Dashboard bez DPH.",
    current: { key: "ltv", format: "currency" },
  },
  {
    id: "ziskove-ltv",
    name: "Ziskové LTV",
    category: "zakaznici",
    meaning: "Kolik marže (ne obratu) přinese průměrný zákazník za celou dobu. Říká, kolik maximálně dává smysl zaplatit za jeho získání.",
    formula: "LTV (bez DPH) × Marže %",
    where: ["Hlavní KPI", "Retenční analýza"],
    benchmark: { text: "Bez samostatného benchmarku, porovnává se s CAC." },
    current: { key: "ltvProfit", format: "currency" },
  },
  {
    id: "ltv-cac",
    name: "Poměr LTV a CAC (dle marže)",
    category: "zakaznici",
    meaning: "Kolikrát se vrátí investice do získání zákazníka v podobě marže za celou dobu vztahu.",
    formula: "Ziskové LTV / CAC",
    where: ["Hlavní KPI", "Retenční analýza"],
    benchmark: { text: "Pod 1× akvizice prodělává · 1 až 3× hraniční · 3× a více zdravý stav.", min: 3, better: "higher" },
    current: { key: "ltvCac", format: "ratio" },
  },
  {
    id: "repeat-rate",
    name: "Míra opakovaného nákupu",
    category: "zakaznici",
    meaning: "Podíl zákazníků, kteří nakoupili alespoň dvakrát. U barefoot obuvi ukazuje, zda si zákazníci styl oblíbili a vracejí se pro další páry.",
    formula: "Zákazníci s 2+ objednávkami / Všichni zákazníci × 100",
    where: ["Retenční analýza"],
    benchmark: { text: "Obuv a specializovaná móda orientačně 20 až 35 %.", min: 20, max: 35, better: "higher" },
    current: { key: "repeatRate", format: "percent" },
  },
  {
    id: "dny-mezi-nakupy",
    name: "Ø dní mezi nákupy",
    category: "zakaznici",
    meaning: "Jak dlouho v průměru trvá, než se vracející zákazník vrátí. Pomáhá načasovat e-maily a remarketing.",
    formula: "Průměr mezer mezi po sobě jdoucími objednávkami\n(jen zákazníci s 2+ objednávkami)",
    where: ["Retenční analýza"],
    benchmark: { text: "Nákup dalšího páru obuvi orientačně 150 až 300 dní.", min: 150, max: 300, better: "lower" },
    current: { key: "daysBetween", format: "days" },
  },
  {
    id: "rfm",
    name: "RFM segmenty",
    category: "zakaznici",
    meaning: "Rozdělení zákazníků podle toho, jak nedávno (R) a jak často (F) nakupují: Šampioni, Věrní, Ohrožení, Noví, Jednorázoví a Ztracení.",
    formula: "Ztracení:  poslední nákup > 365 dní\nŠampioni:  3+ nákupy a poslední ≤ 90 dní\nVěrní:     2+ nákupy a poslední ≤ 180 dní\nOhrožení:  2+ nákupy a poslední > 180 dní\nNoví:      1 nákup a poslední ≤ 90 dní\nJednorázoví: ostatní",
    where: ["Retenční analýza"],
    benchmark: { text: "Cílem je růst podílu Šampionů a Věrných a včasná reaktivace Ohrožených (dřív, než přejdou mezi Ztracené)." },
  },
  {
    id: "sessions",
    name: "Návštěvnost (sessions)",
    category: "web",
    meaning: "Počet návštěv webu podle Google Analytics 4. Jeden uživatel může mít více návštěv.",
    formula: "GA4 metrika sessions",
    where: ["Hlavní Dashboard", "Webová návštěvnost (GA4)"],
    benchmark: { text: "Bez tržního benchmarku, sledujte YoY a podíl zdrojů (organika, placené, e-mail, přímé)." },
  },
  {
    id: "cvr",
    name: "Konverzní poměr (CVR)",
    category: "web",
    meaning: "Jaký podíl návštěv skončí nákupem. Ukazuje kvalitu návštěvnosti i to, jak dobře web prodává.",
    formula: "Konverze (nákupy) / Sessions × 100",
    where: ["Hlavní Dashboard", "Webová návštěvnost (GA4)"],
    benchmark: { text: "Obuv orientačně 0,8 až 2 % (výběr velikosti a vyšší cena prodlužují rozhodování). Mobil bývá výrazně níž než desktop." },
  },
  {
    id: "bounce",
    name: "Bounce rate",
    category: "web",
    meaning: "Podíl návštěv bez zapojení (krátká návštěva bez interakce). V GA4 jde o doplněk míry zapojení.",
    formula: "1 − míra zapojení (GA4)",
    where: ["Webová návštěvnost (GA4)"],
    benchmark: { text: "E-shopy orientačně 35 až 55 %. Vysoké hodnoty u konkrétního zdroje nebo vstupní stránky ukazují na nesoulad reklamy a obsahu." },
  },
  {
    id: "delka-navstevy",
    name: "Průměrná délka návštěvy",
    category: "web",
    meaning: "Jak dlouho v průměru návštěva trvá.",
    formula: "GA4 průměrná délka relace",
    where: ["Webová návštěvnost (GA4)"],
    benchmark: { text: "E-shopy orientačně 1,5 až 3 minuty. Samostatně má omezenou vypovídací hodnotu, čtěte spolu s CVR." },
  },
  {
    id: "checkout-funnel",
    name: "Průchodnost košíkem",
    category: "web",
    meaning: "Kolik zákazníků, kteří zahájí pokladnu, nákup opravdu dokončí. Odhaluje problémy v dopravě, platbě nebo formuláři.",
    formula: "purchase / begin_checkout × 100\n(kroky: begin_checkout → add_shipping_info → add_payment_info → purchase)",
    where: ["Webová návštěvnost (GA4)"],
    benchmark: { text: "Orientačně 45 až 65 % dokončených pokladen. Propad u kroku dopravy obvykle znamená vysokou cenu dopravy nebo chybějící výměnu zdarma." },
  },
  {
    id: "abc",
    name: "ABC analýza produktů",
    category: "provoz",
    meaning: "Rozdělení produktů podle podílu na tržbách, podle kterého se určuje, kam soustředit sklad, reklamu a péči o dostupnost.",
    formula: "Produkty seřazené podle tržeb bez DPH, kumulativní podíl:\nA = 0 až 80 % tržeb · B = 80 až 95 % · C = 95 až 100 %",
    where: ["Produktový žebříček"],
    benchmark: { text: "U obuvi tvoří skupina A typicky 15 až 25 % modelů. Pozor na chybějící velikosti u nejprodávanějších modelů." },
  },
  {
    id: "doprava-zdarma",
    name: "Doprava zdarma %",
    category: "provoz",
    meaning: "Podíl doručovaných objednávek, u kterých zákazník za dopravu neplatil.",
    formula: "Objednávky s dopravou zdarma / Doručované objednávky × 100\n(bez osobního odběru a nedoručovacích metod)",
    where: ["Doprava a platba"],
    benchmark: { text: "U obuvi s vyšší hodnotou objednávky orientačně 50 až 80 %." },
  },
  {
    id: "doprava-zisk",
    name: "Doprava: zisk / ztráta",
    category: "provoz",
    meaning: "Rozdíl mezi tím, co za dopravu zaplatili zákazníci, a tím, co e-shop zaplatil dopravcům.",
    formula: "Příjmy za dopravu od zákazníků − Náklady na dopravu (dle ceníku dopravců)",
    where: ["Doprava a platba"],
    benchmark: { text: "Mírná ztráta je běžná (doprava zdarma jako marketingový nástroj), ztráta by ale neměla přesáhnout pár procent tržeb." },
    note: "Počítá se jen pokud je vyplněný ceník dopravců (uložený v prohlížeči).",
  },
  {
    id: "prodejna",
    name: "Prodejna (kamenný obchod)",
    category: "provoz",
    meaning: "Tržby a objednávky kamenné prodejny v Třebíči. Na Hlavních KPI je lze přepínačem E-shop / Prodejna oddělit od e-shopu.",
    formula: "Objednávky se stavem 19 (Obchod: Vydáno) a 21 (Obchod: objednávka)",
    where: ["Prodejna", "Hlavní KPI"],
    benchmark: { text: "Bez tržního benchmarku. Sledujte podíl prodejny na celkových tržbách a marži prodejny oproti e-shopu." },
    note: "PNO a CPA za celek (e-shop + prodejna) vycházejí příznivěji, protože marketing cílí hlavně na e-shop.",
  },
];
