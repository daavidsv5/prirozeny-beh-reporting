import { auth } from '@/auth';
import { NextRequest, NextResponse } from 'next/server';
import { productDataCZ } from '@/data/productDataCZ';
import { localIsoDate } from '@/lib/formatters';
import { getProducts, czName } from '@/lib/upgatesProducts';

export interface BrandApiRow {
  brand: string;
  revenueVat: number;
  prevRevenueVat: number;
  revenue: number;
  prevRevenue: number;
  purchaseCost: number;
  prevPurchaseCost: number;
  soldQty: number;
  prevSoldQty: number;
  share: number;
}

export interface BrandDailyPoint {
  date: string;
  brand: string;
  revenue: number;
}

export interface BrandsResponse {
  brands: BrandApiRow[];
  hasPrevData: boolean;
  daily: BrandDailyPoint[];
  dailyPrev: BrandDailyPoint[];
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const today = localIsoDate(new Date());
  const s  = searchParams.get('from')     ?? today;
  const e  = searchParams.get('to')       ?? today;
  const ps = searchParams.get('prevFrom') ?? '';
  const pe = searchParams.get('prevTo')   ?? '';

  const rawProducts = await getProducts();

  // product name → manufacturer map
  const nameManufMap = new Map<string, string>();
  for (const p of rawProducts) {
    const name = czName(p);
    if (name) nameManufMap.set(name, (p.manufacturer as string | null) || '(bez výrobce)');
  }

  type Acc = { revenueVat: number; revenue: number; purchaseCost: number; soldQty: number };

  function add(map: Map<string, Acc>, brand: string, revenueVat: number, revenue: number, cost: number, qty: number) {
    if (!map.has(brand)) map.set(brand, { revenueVat: 0, revenue: 0, purchaseCost: 0, soldQty: 0 });
    const b = map.get(brand)!;
    b.revenueVat   += revenueVat;
    b.revenue      += revenue;
    b.purchaseCost += cost;
    b.soldQty      += qty;
  }

  const cur  = new Map<string, Acc>();
  const prev = new Map<string, Acc>();
  const dailyMap     = new Map<string, Map<string, number>>(); // brand → date → revenue (current)
  const dailyPrevMap = new Map<string, Map<string, number>>(); // brand → date → revenue (prev)

  for (const r of productDataCZ) {
    const brand = nameManufMap.get(r.name) ?? '(bez výrobce)';

    if (r.date >= s && r.date <= e) {
      add(cur, brand, r.revenue_vat, r.revenue, r.purchaseCost, r.amount);
      if (!dailyMap.has(brand)) dailyMap.set(brand, new Map());
      const dm = dailyMap.get(brand)!;
      dm.set(r.date, (dm.get(r.date) ?? 0) + r.revenue);
    }

    if (ps && pe && r.date >= ps && r.date <= pe) {
      add(prev, brand, r.revenue_vat, r.revenue, r.purchaseCost, r.amount);
      if (!dailyPrevMap.has(brand)) dailyPrevMap.set(brand, new Map());
      const dp = dailyPrevMap.get(brand)!;
      dp.set(r.date, (dp.get(r.date) ?? 0) + r.revenue);
    }
  }

  const totalRev     = [...cur.values()].reduce((acc, v) => acc + v.revenue, 0);
  const prevTotalRev = [...prev.values()].reduce((acc, v) => acc + v.revenue, 0);

  const allBrands = new Set([...cur.keys(), ...prev.keys()]);
  const brands: BrandApiRow[] = [];

  for (const brand of allBrands) {
    const c = cur.get(brand)  ?? { revenueVat: 0, revenue: 0, purchaseCost: 0, soldQty: 0 };
    const p = prev.get(brand) ?? { revenueVat: 0, revenue: 0, purchaseCost: 0, soldQty: 0 };
    if (c.revenue === 0 && p.revenue === 0) continue;
    brands.push({
      brand,
      revenueVat:       Math.round(c.revenueVat),
      prevRevenueVat:   Math.round(p.revenueVat),
      revenue:          Math.round(c.revenue),
      prevRevenue:      Math.round(p.revenue),
      purchaseCost:     Math.round(c.purchaseCost),
      prevPurchaseCost: Math.round(p.purchaseCost),
      soldQty:          c.soldQty,
      prevSoldQty:      p.soldQty,
      share:            totalRev > 0 ? Math.round((c.revenue / totalRev) * 1000) / 10 : 0,
    });
  }

  brands.sort((a, b) => b.revenue - a.revenue);

  // Daily brand points for trend chart
  const daily: BrandDailyPoint[] = [];
  for (const [brand, dm] of dailyMap) {
    for (const [date, revenue] of dm) daily.push({ date, brand, revenue: Math.round(revenue) });
  }
  daily.sort((a, b) => a.date.localeCompare(b.date));

  const dailyPrev: BrandDailyPoint[] = [];
  for (const [brand, dm] of dailyPrevMap) {
    for (const [date, revenue] of dm) dailyPrev.push({ date, brand, revenue: Math.round(revenue) });
  }
  dailyPrev.sort((a, b) => a.date.localeCompare(b.date));

  return NextResponse.json({ brands, hasPrevData: prevTotalRev > 0, daily, dailyPrev } satisfies BrandsResponse);
}
