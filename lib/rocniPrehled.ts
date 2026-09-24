// Roční přehled: pomocné funkce pro agregaci KPI po kalendářních letech.
// Minulé roky se zobrazují celé, aktuální rok od 1. 1. do posledního kompletního dne (cutoff).
// Aktuální rok se srovnává se stejným obdobím loni (režim 'ytd').

import { lastUpdate } from '@/data/lastUpdate';
import { emptyKpiRow, type KpiRow } from '@/lib/kpiMetrics';

export type YearPeriod = 'ytd' | 'full';

/** Poslední kompletní den dat = den před poslední aktualizací ('YYYY-MM-DD'). */
export const CUTOFF_DATE = (() => {
  const d = new Date(lastUpdate);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
})();

export const CUTOFF_MMDD = CUTOFF_DATE.slice(5);
export const CURRENT_YEAR = +CUTOFF_DATE.slice(0, 4);

export const CUTOFF_LABEL = (() => {
  const [, m, d] = CUTOFF_DATE.split('-').map(Number);
  return `${d}. ${m}.`;
})();

export interface YearInfo {
  year: number;
  /** První den s objednávkou v daném roce */
  firstOrderDate: string;
  /** Rok nemá objednávky od 1. 1. (neúplná historie) */
  partial: boolean;
}

/** Roky, ve kterých existují objednávky (roky jen s náklady na reklamu se vynechávají). Vzestupně. */
export function getYearInfos(rows: { date: string; orders: number }[]): YearInfo[] {
  const first: Record<number, string> = {};
  for (const r of rows) {
    if (r.orders <= 0 || r.date > CUTOFF_DATE) continue;
    const y = +r.date.slice(0, 4);
    if (!first[y] || r.date < first[y]) first[y] = r.date;
  }
  return Object.keys(first).map(Number).sort((a, b) => a - b).map(year => ({
    year,
    firstOrderDate: first[year],
    partial: first[year].slice(5) !== '01-01',
  }));
}

/** Filtr dnů pro období: nikdy po cutoffu; 'ytd' navíc jen do stejného dne v roce jako cutoff. */
export function periodFilter(period: YearPeriod): (date: string) => boolean {
  return (date: string) => date <= CUTOFF_DATE && (period === 'full' || date.slice(5) <= CUTOFF_MMDD);
}

export function sumKpiRows(rows: KpiRow[]): KpiRow {
  const out = emptyKpiRow();
  for (const r of rows) {
    out.revenue      += r.revenue;
    out.orders       += r.orders;
    out.cost         += r.cost;
    out.purchaseCost += r.purchaseCost;
    out.marginRev    += r.marginRev;
  }
  return out;
}

/** LTV ke konci období z 12 měsíčních hodnot roku (měsíční granularita). */
export function ltvAtPeriodEnd(monthly: number[], year: number, period: YearPeriod): number {
  const idx = year === CURRENT_YEAR || period === 'ytd' ? +CUTOFF_MMDD.slice(0, 2) - 1 : 11;
  return monthly[idx] ?? 0;
}
