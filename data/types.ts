export type Country = 'cz' | 'sk';
export type Currency = 'CZK' | 'EUR';

export interface DailyRecord {
  date: string; // ISO date "2026-03-13"
  country: Country;
  currency: Currency;         // CZK for CZ, EUR for SK
  revenue: number;            // bez DPH (in native currency)
  revenue_vat: number;        // s DPH (in native currency)
  orders: number;
  orders_cancelled: number;   // stornované objednávky za den
  cost: number;               // marketing cost (in native currency)
}

/** Exchange rate used when combining CZK + EUR in a single view */
export const EUR_TO_CZK = 25;

/** SK e-shop launch date — data before this date are test orders and should be excluded */
export const SK_LAUNCH_DATE = '2024-06-01';

export interface KpiData {
  revenuevat: number;
  revenue: number;
  orders: number;
  aov: number;
  cost: number;
  pno: number;
  cpa: number;
  ordersCancelled: number;
  cancelRate: number; // % stornovaných z celku (cancelled / (orders + cancelled) * 100)
}

export type TimePeriod = 'current_year' | 'current_month' | 'last_month' | 'last_14_days' | 'last_7_days' | 'yesterday' | 'last_year' | 'all_time' | 'custom';

export interface FilterState {
  countries: Country[];
  timePeriod: TimePeriod;
  customStart?: Date;
  customEnd?: Date;
}

/** Returns the display currency for the current filter selection.
 *  Pure SK → EUR. CZ or mixed → CZK. */
export function getDisplayCurrency(countries: Country[]): Currency {
  if (countries.length === 1 && countries[0] === 'sk') return 'EUR';
  return 'CZK';
}
