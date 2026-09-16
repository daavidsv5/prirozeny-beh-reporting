import { DailyRecord, EUR_TO_CZK } from './types';
import { realDataCZ } from './realDataCZ';
import { realDataCZEshop } from './realDataCZEshop';
import { realDataCZProdejna } from './realDataCZProdejna';

function toDailyRecords(rows: typeof realDataCZ): DailyRecord[] {
  return rows.map(r => ({
    date: r.date, country: r.country, currency: 'CZK' as const,
    orders: r.orders, orders_cancelled: r.orders_cancelled, revenue_vat: r.revenue_vat, revenue: r.revenue, cost: r.cost,
  }));
}

// CZ: real data only
export const mockData: DailyRecord[] = toDailyRecords(realDataCZ);
export const mockDataEshop: DailyRecord[] = toDailyRecords(realDataCZEshop);
export const mockDataProdejna: DailyRecord[] = toDailyRecords(realDataCZProdejna);

// Daily marketing data with per-channel breakdown
export interface DailyMarketingRow {
  date: string;
  cost: number;
  cost_facebook: number;
  cost_google: number;
  cost_seznam: number;
  cost_zbozi: number;
  cost_heureka: number;
  cost_tanganica: number;
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
  _eurToCzk: number = EUR_TO_CZK,
  records: typeof realDataCZ = realDataCZ
): DailyMarketingRow[] {
  const byDate: Record<string, DailyMarketingRow> = {};

  const ensure = (date: string) => {
    if (!byDate[date]) {
      byDate[date] = {
        date, cost: 0,
        cost_facebook: 0, cost_google: 0, cost_seznam: 0, cost_zbozi: 0, cost_heureka: 0, cost_tanganica: 0,
        clicks_facebook: 0, clicks_google: 0, clicks_seznam: 0,
        orders: 0, revenue: 0,
      };
    }
  };

  for (const r of records.filter(d => d.date >= dateStart && d.date <= dateEnd)) {
    ensure(r.date);
    byDate[r.date].cost            += r.cost;
    byDate[r.date].cost_facebook   += r.cost_facebook;
    byDate[r.date].cost_google     += r.cost_google;
    byDate[r.date].cost_seznam     += (r as any).cost_seznam  || 0;
    byDate[r.date].cost_zbozi      += (r as any).cost_zbozi   || 0;
    byDate[r.date].cost_heureka    += (r as any).cost_heureka || 0;
    byDate[r.date].cost_tanganica  += (r as any).cost_tanganica || 0;
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
  /** Konverze reportované samotným kanálem (cost import / Tanganica export). */
  orders: number;
  /** Hodnota konverzí reportovaná kanálem — ne podíl na tržbách e-shopu. */
  revenue: number;
  pno: number;
  cpa: number;
}

export function getMarketingSourceData(
  dateStart: string,
  dateEnd: string,
  _countries: string[],
  _eurToCzk: number = EUR_TO_CZK,
  records: typeof realDataCZ = realDataCZ
): MarketingSource[] {
  const rows = records.filter(d => d.date >= dateStart && d.date <= dateEnd);

  const sum = (key: string) => rows.reduce((s, d) => s + ((d as any)[key] || 0), 0);

  const safeDiv = (a: number, b: number) => b > 0 ? a / b : 0;

  // Konverze i jejich hodnota jsou reportované přímo kanálem (cost import,
  // resp. export z Tanganiky) — ne dopočtené podílem na tržbách e-shopu.
  const makeSource = (source: string, key: string): MarketingSource => {
    const cost    = sum(`cost_${key}`);
    const clicks  = sum(`clicks_${key}`);
    const orders  = sum(`conv_${key}`);
    const revenue = sum(`convValue_${key}`);
    return {
      source, currency: 'CZK', cost, clicks,
      orders:  Math.round(orders * 100) / 100,
      revenue: Math.round(revenue),
      pno:     safeDiv(cost, revenue) * 100,
      cpa:     safeDiv(cost, orders),
    };
  };

  return [
    makeSource('Facebook Ads', 'facebook'),
    makeSource('Google Ads',   'google'),
    makeSource('Seznam Ads',   'seznam'),
    makeSource('Zboží.cz',     'zbozi'),
    makeSource('Heureka.cz',   'heureka'),
    makeSource('Tanganica',    'tanganica'),
  ].filter(s => s.cost > 0 || s.clicks > 0);
}
