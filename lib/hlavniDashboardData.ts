// Výpočty Měsíčního přehledu (/hlavni-dashboard), sdílené s Ročním přehledem (/rocni-prehled).

import { mockData } from '@/data/mockGenerator';
import { marginDataCZ } from '@/data/marginDataCZ';
import { retentionDataCZ } from '@/data/retentionDataCZ';
import { emptyKpiRow, type KpiRow } from '@/lib/kpiMetrics';

/** Měsíční součty KPI za rok. `dateFilter` omezí dny (Roční přehled: cutoff / stejné období loni). */
export function aggregateMonthly(
  year: number,
  data: typeof mockData,
  marginData: typeof marginDataCZ,
  dateFilter?: (date: string) => boolean,
): KpiRow[] {
  const months: KpiRow[] = Array.from({ length: 12 }, emptyKpiRow);

  for (const r of data) {
    if (r.country !== 'cz') continue;
    if (dateFilter && !dateFilter(r.date)) continue;
    const [y, m] = r.date.split('-').map(Number);
    if (y !== year) continue;
    const i = m - 1;
    months[i].revenue += r.revenue;
    months[i].orders  += r.orders;
    months[i].cost    += r.cost;
  }

  for (const r of marginData) {
    if (dateFilter && !dateFilter(r.date)) continue;
    const [y, m] = r.date.split('-').map(Number);
    if (y !== year) continue;
    months[m - 1].purchaseCost += r.purchaseCost;
    months[m - 1].marginRev    += r.revenue;
  }

  return months;
}

/** LTV (bez DPH) ke konci každého měsíce roku — kumulativní tržby bez DPH / kumulativní počet zákazníků
 *  (stejná definice jako box „LTV (bez DPH)" na /dashboard). Měsíce po posledních datech = 0. */
export function monthlyLtv(year: number): number[] {
  const customers = retentionDataCZ;
  const byMonth: Record<string, { revenue: number; newCustomers: number }> = {};
  for (const c of customers) {
    if (!c.dates[0]) continue;
    const first = c.dates[0].slice(0, 7);
    (byMonth[first] ??= { revenue: 0, newCustomers: 0 }).newCustomers++;
    c.dates.forEach((d, i) => { (byMonth[d.slice(0, 7)] ??= { revenue: 0, newCustomers: 0 }).revenue += c.revenues[i]; });
  }
  const months = Object.keys(byMonth).sort();
  if (months.length === 0) return Array(12).fill(0);
  const lastMonth = months[months.length - 1];
  let cumRevenue = 0, cumCustomers = 0, k = 0;
  return Array.from({ length: 12 }, (_, i) => {
    const month = `${year}-${String(i + 1).padStart(2, '0')}`;
    if (month > lastMonth) return 0;
    while (k < months.length && months[k] <= month) {
      cumRevenue   += byMonth[months[k]].revenue;
      cumCustomers += byMonth[months[k]].newCustomers;
      k++;
    }
    return cumCustomers > 0 ? cumRevenue / cumCustomers : 0;
  });
}
