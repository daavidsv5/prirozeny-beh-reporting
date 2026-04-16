import { DailyRecord, EUR_TO_CZK } from './types';
import { realDataCZ } from './realDataCZ';

// CZ: real data only
const realCZ: DailyRecord[] = realDataCZ.map(r => ({
  date: r.date, country: r.country, currency: 'CZK' as const,
  orders: r.orders, orders_cancelled: r.orders_cancelled, revenue_vat: r.revenue_vat, revenue: r.revenue, cost: r.cost,
}));

export const mockData: DailyRecord[] = [...realCZ];

// Daily marketing data with per-channel breakdown
export interface DailyMarketingRow {
  date: string;
  cost: number;
  cost_facebook: number;
  cost_google: number;
  cost_seznam: number;
  cost_zbozi: number;
  cost_heureka: number;
  clicks_facebook: number;
  clicks_google: number;
  clicks_seznam: number;
  orders: number;
  revenue: number;
}

export function getDailyMarketingData(
  dateStart: string,
  dateEnd: string,
  _countries: string[],
  _eurToCzk: number = EUR_TO_CZK
): DailyMarketingRow[] {
  const byDate: Record<string, DailyMarketingRow> = {};

  const ensure = (date: string) => {
    if (!byDate[date]) {
      byDate[date] = {
        date, cost: 0,
        cost_facebook: 0, cost_google: 0, cost_seznam: 0, cost_zbozi: 0, cost_heureka: 0,
        clicks_facebook: 0, clicks_google: 0, clicks_seznam: 0,
        orders: 0, revenue: 0,
      };
    }
  };

  for (const r of realDataCZ.filter(d => d.date >= dateStart && d.date <= dateEnd)) {
    ensure(r.date);
    byDate[r.date].cost            += r.cost;
    byDate[r.date].cost_facebook   += r.cost_facebook;
    byDate[r.date].cost_google     += r.cost_google;
    byDate[r.date].cost_seznam     += (r as any).cost_seznam  || 0;
    byDate[r.date].cost_zbozi      += (r as any).cost_zbozi   || 0;
    byDate[r.date].cost_heureka    += (r as any).cost_heureka || 0;
    byDate[r.date].clicks_facebook += r.clicks_facebook;
    byDate[r.date].clicks_google   += r.clicks_google;
    byDate[r.date].clicks_seznam   += (r as any).clicks_seznam || 0;
    byDate[r.date].orders          += r.orders;
    byDate[r.date].revenue         += r.revenue;
  }

  return Object.values(byDate).sort((a, b) => b.date.localeCompare(a.date));
}

// Source breakdown for marketing page
export interface MarketingSource {
  source: string;
  cost: number;
  currency: 'CZK' | 'EUR';
  clicks: number;
  orders: number;
  revenue: number;
  pno: number;
  cpa: number;
}

export function getMarketingSourceData(
  dateStart: string,
  dateEnd: string,
  _countries: string[],
  _eurToCzk: number = EUR_TO_CZK
): MarketingSource[] {
  const rows = realDataCZ.filter(d => d.date >= dateStart && d.date <= dateEnd);

  const sum = (key: string) => rows.reduce((s, d) => s + ((d as any)[key] || 0), 0);

  const fbCost      = sum('cost_facebook');
  const gCost       = sum('cost_google');
  const szCost      = sum('cost_seznam');
  const zbCost      = sum('cost_zbozi');
  const hkCost      = sum('cost_heureka');
  const fbClicks    = sum('clicks_facebook');
  const gClicks     = sum('clicks_google');
  const szClicks    = sum('clicks_seznam');
  const totalRevenue = sum('revenue');
  const totalOrders  = sum('orders');

  const totalCost = fbCost + gCost + szCost + zbCost + hkCost;
  const mkShare   = (c: number) => totalCost > 0 ? c / totalCost : 0;
  const safeDiv   = (a: number, b: number) => b > 0 ? a / b : 0;

  const makeSource = (source: string, cost: number, clicks: number): MarketingSource => ({
    source, currency: 'CZK', cost, clicks,
    orders:  Math.round(totalOrders  * mkShare(cost)),
    revenue: Math.round(totalRevenue * mkShare(cost)),
    pno:     safeDiv(cost, totalRevenue * mkShare(cost)) * 100,
    cpa:     safeDiv(cost, totalOrders  * mkShare(cost)),
  });

  return [
    makeSource('Facebook Ads', fbCost, fbClicks),
    makeSource('Google Ads',   gCost,  gClicks),
    makeSource('Seznam Ads',   szCost, szClicks),
    makeSource('Zboží.cz',     zbCost, 0),
    makeSource('Heureka.cz',   hkCost, 0),
  ].filter(s => s.cost > 0 || s.clicks > 0);
}
