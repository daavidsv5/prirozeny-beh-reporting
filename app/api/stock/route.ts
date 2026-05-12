import { auth } from '@/auth';
import { NextRequest, NextResponse } from 'next/server';
import { productDataCZ } from '@/data/productDataCZ';
import { localIsoDate } from '@/lib/formatters';

// ── Types ─────────────────────────────────────────────────────────────────────

export type AvailType = 'stock' | 'supplier' | 'unavailable';
export type StockStatus = 'skladem' | 'malo' | 'dodavatel' | 'vyprodano';

export interface StockProduct {
  code: string;
  name: string;
  stock: number;
  type: AvailType;
  status: StockStatus;
  avgDailySales: number;
  daysUntilEmpty: number | null;
  soldQty: number;
  marginPct: number | null;
}

export interface StockDailyRow {
  date: string;
  revenueStock: number;
  revenueSupplier: number;
}

export interface StockKpi {
  totalProducts: number;
  inStock: number;
  outOfStock: number;
  supplierCount: number;
  totalUnits: number;
  revenueStock: number;
  revenueSupplier: number;
  revenueTotal: number;
}

export interface StockResponse {
  products: StockProduct[];
  daily: StockDailyRow[];
  kpi: StockKpi;
}

// ── In-process cache (1 h TTL) ────────────────────────────────────────────────

let _cache: { products: any[]; fetchedAt: number } | null = null;
const CACHE_TTL = 3_600_000;

// ── Helpers ───────────────────────────────────────────────────────────────────

function authHeader() {
  const key = (process.env.UPGATES_API_KEY ?? '').replace(/^["']|["']$/g, '');
  return 'Basic ' + Buffer.from(`${process.env.UPGATES_LOGIN}:${key}`).toString('base64');
}

async function fetchPage(page: number) {
  const url = `${process.env.UPGATES_API_URL!.replace(/\/$/, '')}/products?page=${page}`;
  const res = await fetch(url, { headers: { Authorization: authHeader(), Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Upgates /products HTTP ${res.status}`);
  return res.json();
}

async function getProducts(): Promise<any[]> {
  if (_cache && Date.now() - _cache.fetchedAt < CACHE_TTL) return _cache.products;
  const first = await fetchPage(1);
  const pages: number = first.number_of_pages;
  let all: any[] = [...first.products];
  for (let p = 2; p <= pages; p++) {
    await new Promise(r => setTimeout(r, 300));
    const d = await fetchPage(p);
    all = all.concat(d.products);
  }
  _cache = { products: all, fetchedAt: Date.now() };
  return all;
}

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

function czName(p: any): string {
  return ((p.descriptions as any[]) ?? []).find((d: any) => d.language === 'cs')?.title ?? p.code;
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

  const rawProducts = await getProducts();

  // name → type map (all products incl. inactive, for historical matching)
  const nameTypeMap = new Map<string, AvailType>();
  for (const p of rawProducts) {
    const name = czName(p);
    if (name) nameTypeMap.set(name.toLowerCase().trim(), classifyType(p.availability_type, p.variants_availability_type));
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
      stock,
      type,
      status:         getStatus(stock, type),
      avgDailySales:  Math.round(avg * 10) / 10,
      daysUntilEmpty: avg > 0 && type !== 'unavailable' ? Math.round(stock / avg) : null,
      soldQty:        periodQty.get(name) ?? 0,
      marginPct:      rev > 0 ? Math.round(((rev - cost) / rev) * 1000) / 10 : null,
    };
  }).sort((a, b) => a.name.localeCompare(b.name, 'cs'));

  // KPI counts
  const inStock       = active.filter((p: any) => { const t = classifyType(p.availability_type, p.variants_availability_type); const st = effectiveStock(p); return t === 'stock' && st > 0; }).length;
  const supplierCount = active.filter((p: any) => classifyType(p.availability_type, p.variants_availability_type) === 'supplier').length;
  const outOfStock    = active.filter((p: any) => { const t = classifyType(p.availability_type, p.variants_availability_type); const st = effectiveStock(p); return t === 'unavailable' || (t === 'stock' && st === 0); }).length;
  const totalUnits    = active.reduce((sum: number, p: any) => sum + effectiveStock(p), 0);

  // Daily sales by type
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

  let revenueStock = 0, revenueSupplier = 0;
  for (const d of daily) { revenueStock += d.revenueStock; revenueSupplier += d.revenueSupplier; }

  const response: StockResponse = {
    products,
    daily,
    kpi: {
      totalProducts: active.length, inStock, outOfStock, supplierCount,
      totalUnits, revenueStock, revenueSupplier,
      revenueTotal: revenueStock + revenueSupplier,
    },
  };
  return NextResponse.json(response);
}
