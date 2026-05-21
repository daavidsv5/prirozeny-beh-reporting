import { auth } from '@/auth';
import { NextRequest, NextResponse } from 'next/server';
import { productDataCZ } from '@/data/productDataCZ';
import { localIsoDate } from '@/lib/formatters';
import { getProducts as getUpgatesProducts, czName as upgatesCzName } from '@/lib/upgatesProducts';

// ── Types ─────────────────────────────────────────────────────────────────────

export type AvailType = 'stock' | 'supplier' | 'unavailable';
export type StockStatus = 'skladem' | 'malo' | 'dodavatel' | 'vyprodano';

export interface StockProduct {
  code: string;
  name: string;
  manufacturer: string;
  stock: number;
  stockValue: number;
  type: AvailType;
  status: StockStatus;
  avgDailySales: number;
  daysUntilEmpty: number | null;
  soldQty: number;
  marginPct: number | null;
}

export interface StockBrandRow {
  brand: string;
  stockQty: number;
  stockValue: number;
  soldQty: number;
  marginCzk: number;
  marginPct: number | null;
  avgDailySales: number;
}

export interface StockDailyRow {
  date: string;
  revenueStock: number;
  revenueSupplier: number;
}

export interface StockAvailDailyRow {
  date: string;
  countSkladem: number;
  countDodavatel: number;
  countVyprodano: number;
}

export interface StockKpi {
  totalProducts: number;
  inStock: number;
  outOfStock: number;
  supplierCount: number;
  totalUnits: number;
  totalStockValue: number;
  totalStockValueVat: number;
  countSkladem: number;
  countMalo: number;
  countDodavatel: number;
  countVyprodano: number;
  revenueStock: number;
  revenueSupplier: number;
  revenueTotal: number;
}

export interface StockResponse {
  products: StockProduct[];
  daily: StockDailyRow[];
  availDaily: StockAvailDailyRow[];
  kpi: StockKpi;
  brands: StockBrandRow[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function classifyType(availType: string | null, variantsAvailType: string | null): AvailType {
  const t = availType ?? variantsAvailType;
  if (t === 'Custom') return 'supplier';
  if (t === 'NotAvailable') return 'unavailable';
  return 'stock';
}

function effectiveStock(p: any): number {
  return p.variants_exists_yn ? (p.variants_stock ?? 0) : (p.stock ?? 0);
}

function getStatus(stock: number, type: AvailType): StockStatus {
  if (type === 'supplier') return 'dodavatel';
  if (type === 'unavailable' || stock === 0) return 'vyprodano';
  if (stock <= 10) return 'malo';
  return 'skladem';
}

const czName = upgatesCzName;

function purchasePriceNoVat(p: any): number {
  const czPrices = ((p.prices as any[]) ?? []).find((x: any) => x.currency === 'CZK');
  if (!czPrices || !czPrices.price_purchase) return 0;
  return czPrices.price_purchase / (1 + (czPrices.vat ?? 21) / 100);
}

// ── Route ─────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const today = localIsoDate(new Date());
  const s = searchParams.get('from') ?? today;
  const e = searchParams.get('to')   ?? today;

  const d90 = new Date();
  d90.setDate(d90.getDate() - 90);
  const s90 = localIsoDate(d90);

  const rawProducts = await getUpgatesProducts();

  // name → type map (all products incl. inactive, for historical matching)
  // For products with variants, classify by majority of individual variant types
  // rather than the product-level variants_availability_type aggregate.
  const nameTypeMap = new Map<string, AvailType>();
  for (const p of rawProducts) {
    const name = czName(p);
    if (!name) continue;
    let type: AvailType;
    if (p.variants_exists_yn && Array.isArray(p.variants) && p.variants.length > 0) {
      const activeVariants = (p.variants as any[]).filter((v: any) => v.active_yn !== false);
      let stockCnt = 0, supplierCnt = 0, unavailCnt = 0;
      for (const v of activeVariants) {
        const vt = classifyType(v.availability_type, null);
        if (vt === 'stock') stockCnt++;
        else if (vt === 'supplier') supplierCnt++;
        else unavailCnt++;
      }
      if (supplierCnt > stockCnt && supplierCnt >= unavailCnt) type = 'supplier';
      else if (stockCnt === 0 && unavailCnt > 0) type = 'unavailable';
      else type = 'stock';
    } else {
      type = classifyType(p.availability_type, p.variants_availability_type);
    }
    nameTypeMap.set(name.toLowerCase().trim(), type);
  }

  // avg daily sales (qty) per product — last 90 days
  const qtyMap = new Map<string, number>();
  for (const r of productDataCZ) {
    if (r.date < s90) continue;
    qtyMap.set(r.name, (qtyMap.get(r.name) ?? 0) + r.amount);
  }
  const avgMap = new Map<string, number>();
  for (const [k, v] of qtyMap) avgMap.set(k, v / 90);

  // per-product totals in filtered period (qty, revenue, purchaseCost)
  const periodQty  = new Map<string, number>();
  const periodRev  = new Map<string, number>();
  const periodCost = new Map<string, number>();
  for (const r of productDataCZ) {
    if (r.date < s || r.date > e) continue;
    periodQty.set(r.name,  (periodQty.get(r.name)  ?? 0) + r.amount);
    periodRev.set(r.name,  (periodRev.get(r.name)  ?? 0) + r.revenue);
    periodCost.set(r.name, (periodCost.get(r.name) ?? 0) + r.purchaseCost);
  }

  // Active products for table
  const active = rawProducts.filter((p: any) => p.active_yn && !p.archived_yn);

  // purchase price no-VAT map for stock valuation
  const ppMap = new Map<string, number>();
  const ppVatMap = new Map<string, number>(); // purchase price WITH VAT
  for (const p of rawProducts) {
    const name = czName(p);
    if (!name) continue;
    ppMap.set(name, purchasePriceNoVat(p));
    const czPrices = ((p.prices as any[]) ?? []).find((x: any) => x.currency === 'CZK');
    ppVatMap.set(name, czPrices?.price_purchase ?? 0);
  }

  const products: StockProduct[] = active.map((p: any) => {
    const name  = czName(p);
    const stock = effectiveStock(p);
    const type  = classifyType(p.availability_type, p.variants_availability_type);
    const avg   = avgMap.get(name) ?? 0;
    const rev   = periodRev.get(name)  ?? 0;
    const cost  = periodCost.get(name) ?? 0;
    return {
      code:           p.code as string,
      name,
      manufacturer:   (p.manufacturer as string | null) ?? '',
      stock,
      stockValue:     Math.round(stock * (ppMap.get(name) ?? 0)),
      type,
      status:         getStatus(stock, type),
      avgDailySales:  Math.round(avg * 10) / 10,
      daysUntilEmpty: avg > 0 && type !== 'unavailable' ? Math.round(stock / avg) : null,
      soldQty:        periodQty.get(name) ?? 0,
      marginPct:      rev > 0 ? Math.round(((rev - cost) / rev) * 1000) / 10 : null,
    };
  }).sort((a, b) => a.name.localeCompare(b.name, 'cs'));

  // brand aggregation
  type BrandAcc = { stockQty: number; stockValue: number; soldQty: number; revenue: number; cost: number; avgDailySales: number };
  const brandMap = new Map<string, BrandAcc>();
  for (const p of products) {
    const brand = p.manufacturer || '(bez výrobce)';
    if (!brandMap.has(brand)) brandMap.set(brand, { stockQty: 0, stockValue: 0, soldQty: 0, revenue: 0, cost: 0, avgDailySales: 0 });
    const b = brandMap.get(brand)!;
    b.stockQty      += p.stock;
    b.stockValue    += p.stockValue;
    b.soldQty       += p.soldQty;
    b.revenue       += periodRev.get(p.name)  ?? 0;
    b.cost          += periodCost.get(p.name) ?? 0;
    b.avgDailySales += p.avgDailySales;
  }
  const brands: StockBrandRow[] = [...brandMap.entries()]
    .map(([brand, v]) => ({
      brand,
      stockQty:      v.stockQty,
      stockValue:    Math.round(v.stockValue),
      soldQty:       v.soldQty,
      marginCzk:     Math.round(v.revenue - v.cost),
      marginPct:     v.revenue > 0 ? Math.round(((v.revenue - v.cost) / v.revenue) * 1000) / 10 : null,
      avgDailySales: Math.round(v.avgDailySales * 10) / 10,
    }))
    .sort((a, b) => b.stockQty - a.stockQty);

  // Variant-aware KPI counts
  let kpiTotal = 0, kpiInStock = 0, kpiSupplier = 0, kpiOutOfStock = 0;
  let kpiUnits = 0, kpiStockValue = 0, kpiStockValueVat = 0;
  let kpiSkladem = 0, kpiMalo = 0, kpiDodavatel = 0, kpiVyprodano = 0;

  for (const p of active) {
    if (p.variants_exists_yn && Array.isArray(p.variants) && p.variants.length) {
      const activeVariants = (p.variants as any[]).filter((v: any) => v.active_yn !== false);
      for (const v of activeVariants) {
        const vStock  = (v.stock as number) ?? 0;
        const vType   = classifyType(v.availability_type, null);
        const czPv    = ((v.prices as any[]) ?? []).find((x: any) => x.currency === 'CZK');
        const vPP     = czPv?.price_purchase ? czPv.price_purchase / (1 + (czPv.vat ?? 21) / 100) : 0;
        const vPPVat  = czPv?.price_purchase ?? 0;
        const vStatus = getStatus(vStock, vType);
        kpiTotal++; kpiUnits += vStock; kpiStockValue += vStock * vPP; kpiStockValueVat += vStock * vPPVat;
        if      (vStatus === 'skladem')   { kpiInStock++;  kpiSkladem++;   }
        else if (vStatus === 'malo')      { kpiInStock++;  kpiMalo++;      }
        else if (vStatus === 'dodavatel') { kpiSupplier++; kpiDodavatel++; }
        else                             { kpiOutOfStock++; kpiVyprodano++; }
      }
    } else {
      const pStock  = effectiveStock(p);
      const pType   = classifyType(p.availability_type, p.variants_availability_type);
      const pPP     = ppMap.get(czName(p)) ?? 0;
      const pPPVat  = ppVatMap.get(czName(p)) ?? 0;
      const pStatus = getStatus(pStock, pType);
      kpiTotal++; kpiUnits += pStock; kpiStockValue += pStock * pPP; kpiStockValueVat += pStock * pPPVat;
      if      (pStatus === 'skladem')   { kpiInStock++;  kpiSkladem++;   }
      else if (pStatus === 'malo')      { kpiInStock++;  kpiMalo++;      }
      else if (pStatus === 'dodavatel') { kpiSupplier++; kpiDodavatel++; }
      else                             { kpiOutOfStock++; kpiVyprodano++; }
    }
  }

  // Daily sales by type (revenue chart)
  const dailyMap = new Map<string, { stock: number; supplier: number }>();
  for (const r of productDataCZ) {
    if (r.date < s || r.date > e) continue;
    const type = nameTypeMap.get(r.name.toLowerCase().trim()) ?? 'stock';
    if (!dailyMap.has(r.date)) dailyMap.set(r.date, { stock: 0, supplier: 0 });
    const cur = dailyMap.get(r.date)!;
    if (type === 'supplier') cur.supplier += r.revenue;
    else cur.stock += r.revenue;
  }

  const daily: StockDailyRow[] = [...dailyMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({ date, revenueStock: Math.round(v.stock), revenueSupplier: Math.round(v.supplier) }));

  // Availability backtrack: estimate stock on each past date as currentStock + salesFrom(date)
  // Build per-product daily sales over all history (not just selected period)
  const pDailySales = new Map<string, Map<string, number>>();
  for (const r of productDataCZ) {
    if (!pDailySales.has(r.name)) pDailySales.set(r.name, new Map());
    const dm = pDailySales.get(r.name)!;
    dm.set(r.date, (dm.get(r.date) ?? 0) + r.amount);
  }

  // Suffix sums per product: sums[i] = total sales from dates[i] to end of history
  const pSuffix = new Map<string, { dates: string[]; sums: number[] }>();
  for (const [name, dm] of pDailySales) {
    const entries = [...dm.entries()].sort(([a], [b]) => a.localeCompare(b));
    const n = entries.length;
    const dates = entries.map(([d]) => d);
    const sums = new Array<number>(n).fill(0);
    sums[n - 1] = entries[n - 1][1];
    for (let i = n - 2; i >= 0; i--) sums[i] = sums[i + 1] + entries[i][1];
    pSuffix.set(name, { dates, sums });
  }

  function salesFrom(name: string, fromDate: string): number {
    const d = pSuffix.get(name);
    if (!d) return 0;
    let lo = 0, hi = d.dates.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (d.dates[mid] < fromDate) lo = mid + 1; else hi = mid; }
    return lo < d.dates.length ? d.sums[lo] : 0;
  }

  // Generate every date in selected period
  const availDates: string[] = [];
  { const cur = new Date(s + 'T12:00:00'); while (localIsoDate(cur) <= e) { availDates.push(localIsoDate(cur)); cur.setDate(cur.getDate() + 1); } }

  const availDaily: StockAvailDailyRow[] = availDates.map(date => {
    let countSkladem = 0, countDodavatel = 0, countVyprodano = 0;
    for (const p of active) {
      const type = classifyType(p.availability_type, p.variants_availability_type);
      if (type === 'supplier')    { countDodavatel++; continue; }
      if (type === 'unavailable') { countVyprodano++; continue; }
      if (effectiveStock(p) + salesFrom(czName(p), date) > 0) countSkladem++;
      else countVyprodano++;
    }
    return { date, countSkladem, countDodavatel, countVyprodano };
  });

  let revenueStock = 0, revenueSupplier = 0;
  for (const d of daily) { revenueStock += d.revenueStock; revenueSupplier += d.revenueSupplier; }

  const response: StockResponse = {
    products,
    daily,
    availDaily,
    brands,
    kpi: {
      totalProducts: kpiTotal, inStock: kpiInStock, outOfStock: kpiOutOfStock,
      supplierCount: kpiSupplier, totalUnits: kpiUnits,
      totalStockValue: Math.round(kpiStockValue),
      totalStockValueVat: Math.round(kpiStockValueVat),
      countSkladem: kpiSkladem, countMalo: kpiMalo,
      countDodavatel: kpiDodavatel, countVyprodano: kpiVyprodano,
      revenueStock, revenueSupplier,
      revenueTotal: revenueStock + revenueSupplier,
    },
  };
  return NextResponse.json(response);
}
