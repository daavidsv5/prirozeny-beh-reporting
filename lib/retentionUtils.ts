import { CustomerRetentionRecord } from '@/data/retentionGenerator';

export interface RetentionKpis {
  totalCustomers: number;
  totalRevenue: number;
  avgOrderValue: number;
  repeatPurchaseRate: number;
  avgDaysBetween: number;
  ltvPerCustomer: number;
}

export interface YearCustomerMetrics {
  year: number;
  customers: number;
  newCustomers: number;
  returningCustomers: number;
  orders: number;
  avgOrderValue: number;
  avgFirstPurchase: number;
  avgRepeatPurchase: number;
  avgDaysBetween: number;
}

export interface YearRetentionMetrics {
  year: number;
  customers: number;
  rate1Plus: number;
  rate2Plus: number;
  rate3Plus: number;
}

export interface YearRevenueMetrics {
  year: number;
  totalRevenue: number;
  revShare1Plus: number;
  revShare2Plus: number;
  revShare3Plus: number;
}

export interface MonthlyChartPoint {
  date: string;   // "2024-03-01" — použij jako XAxis dataKey
  ltv: number;    // kumulativní LTV (celkový obrat / celkový počet zákazníků)
  aov: number;    // průměrná objednávka v daném měsíci
}

export interface PurchaseDistPoint {
  label: string;
  customers: number;
  customersPct: number;
  revenue: number;
  revenuePct: number;
}

export interface DaysBin {
  label: string;
  pct: number;
  count: number;
}

/** Avg days between consecutive purchases for a customer */
function avgDaysBetweenOrders(dates: string[]): number {
  if (dates.length < 2) return 0;
  let totalMs = 0;
  for (let i = 1; i < dates.length; i++) {
    totalMs += new Date(dates[i]).getTime() - new Date(dates[i - 1]).getTime();
  }
  return totalMs / (dates.length - 1) / 86400000;
}

export function computeRetentionKpis(data: CustomerRetentionRecord[]): RetentionKpis {
  const totalCustomers = data.length;
  let totalRevenue = 0;
  let totalOrders = 0;
  let repeatCount = 0;
  let daysBetweenSum = 0;
  let daysBetweenCount = 0;

  for (const c of data) {
    const orderCount = c.dates.length;
    totalOrders += orderCount;
    for (const rv of c.revsVat) totalRevenue += rv;

    if (orderCount > 1) {
      repeatCount++;
      daysBetweenSum += avgDaysBetweenOrders(c.dates);
      daysBetweenCount++;
    }
  }

  return {
    totalCustomers,
    totalRevenue,
    avgOrderValue:      totalOrders > 0 ? totalRevenue / totalOrders : 0,
    repeatPurchaseRate: totalCustomers > 0 ? (repeatCount / totalCustomers) * 100 : 0,
    avgDaysBetween:     daysBetweenCount > 0 ? daysBetweenSum / daysBetweenCount : 0,
    ltvPerCustomer:     totalCustomers > 0 ? totalRevenue / totalCustomers : 0,
  };
}

export function computeYearCustomerMetrics(data: CustomerRetentionRecord[]): YearCustomerMetrics[] {
  const yearsSet = new Set<number>();
  for (const c of data) {
    for (const d of c.dates) yearsSet.add(parseInt(d.substring(0, 4)));
  }
  const years = [...yearsSet].sort();
  const totalOrders = data.map(c => c.dates.length);

  return years.map(year => {
    const yearStr = year.toString();
    let customers = 0, newCustomers = 0, returningCustomers = 0;
    let orders = 0, revenueSum = 0;
    let firstPurchaseSum = 0, firstPurchaseCount = 0;
    let repeatPurchaseSum = 0, repeatPurchaseCount = 0;
    let daysBetweenSum = 0, daysBetweenCount = 0;

    for (let ci = 0; ci < data.length; ci++) {
      const c = data[ci];
      const inYearIndices: number[] = [];
      for (let i = 0; i < c.dates.length; i++) {
        if (c.dates[i].startsWith(yearStr)) inYearIndices.push(i);
      }
      if (inYearIndices.length === 0) continue;

      customers++;
      // isNew = first order EVER is in this year
      const isNew = c.dates[0].startsWith(yearStr);
      // isReturning = made at least one repeat purchase (2nd+ order ever) in this year
      // This includes within-year repeat buyers (e.g. first bought June 2025, returned Sept 2025)
      const hasRepeatInYear = inYearIndices.some(idx => idx > 0);

      if (isNew) {
        newCustomers++;
        firstPurchaseSum += c.revsVat[0];
        firstPurchaseCount++;
      }
      if (hasRepeatInYear) {
        returningCustomers++;
      }

      for (const idx of inYearIndices) {
        orders++;
        revenueSum += c.revsVat[idx];
        // idx > 0 = this is the customer's 2nd+ order ever → repeat purchase
        if (idx > 0) {
          repeatPurchaseSum += c.revsVat[idx];
          repeatPurchaseCount++;
        }
      }

      if (totalOrders[ci] > 1) {
        daysBetweenSum += avgDaysBetweenOrders(c.dates);
        daysBetweenCount++;
      }
    }

    return {
      year,
      customers,
      newCustomers,
      returningCustomers,
      orders,
      avgOrderValue:     orders > 0 ? revenueSum / orders : 0,
      avgFirstPurchase:  firstPurchaseCount > 0 ? firstPurchaseSum / firstPurchaseCount : 0,
      avgRepeatPurchase: repeatPurchaseCount > 0 ? repeatPurchaseSum / repeatPurchaseCount : 0,
      avgDaysBetween:    daysBetweenCount > 0 ? daysBetweenSum / daysBetweenCount : 0,
    };
  });
}

export function computeYearRetentionMetrics(data: CustomerRetentionRecord[]): YearRetentionMetrics[] {
  const yearsSet = new Set<number>();
  for (const c of data) {
    for (const d of c.dates) yearsSet.add(parseInt(d.substring(0, 4)));
  }
  const years = [...yearsSet].sort();

  return years.map(year => {
    const yearStr = year.toString();
    let customers = 0, count1Plus = 0, count2Plus = 0, count3Plus = 0;

    for (const c of data) {
      if (!c.dates.some(d => d.startsWith(yearStr))) continue;
      customers++;
      const total = c.dates.length;
      if (total > 1) count1Plus++;
      if (total > 2) count2Plus++;
      if (total > 3) count3Plus++;
    }

    return {
      year, customers,
      rate1Plus: customers > 0 ? (count1Plus / customers) * 100 : 0,
      rate2Plus: customers > 0 ? (count2Plus / customers) * 100 : 0,
      rate3Plus: customers > 0 ? (count3Plus / customers) * 100 : 0,
    };
  });
}

export function computeYearRevenueMetrics(data: CustomerRetentionRecord[]): YearRevenueMetrics[] {
  const yearsSet = new Set<number>();
  for (const c of data) {
    for (const d of c.dates) yearsSet.add(parseInt(d.substring(0, 4)));
  }
  const years = [...yearsSet].sort();
  const totalOrderCount = data.map(c => c.dates.length);

  return years.map(year => {
    const yearStr = year.toString();
    let totalRevenue = 0, rev1Plus = 0, rev2Plus = 0, rev3Plus = 0;

    for (let ci = 0; ci < data.length; ci++) {
      const c = data[ci];
      const tc = totalOrderCount[ci];
      for (let i = 0; i < c.dates.length; i++) {
        if (!c.dates[i].startsWith(yearStr)) continue;
        const rv = c.revsVat[i];
        totalRevenue += rv;
        if (tc > 1) rev1Plus += rv;
        if (tc > 2) rev2Plus += rv;
        if (tc > 3) rev3Plus += rv;
      }
    }

    return {
      year, totalRevenue,
      revShare1Plus: totalRevenue > 0 ? (rev1Plus / totalRevenue) * 100 : 0,
      revShare2Plus: totalRevenue > 0 ? (rev2Plus / totalRevenue) * 100 : 0,
      revShare3Plus: totalRevenue > 0 ? (rev3Plus / totalRevenue) * 100 : 0,
    };
  });
}

/** Měsíční LTV (kumulativní) a AOV pro line charts */
export function computeMonthlyChartData(data: CustomerRetentionRecord[]): MonthlyChartPoint[] {
  const byMonth: Record<string, { revenue: number; orders: number }> = {};
  const customerFirstMonth: string[] = data.map(c => c.dates[0]?.substring(0, 7) ?? '');

  for (const c of data) {
    for (let i = 0; i < c.dates.length; i++) {
      const m = c.dates[i].substring(0, 7);
      if (!byMonth[m]) byMonth[m] = { revenue: 0, orders: 0 };
      byMonth[m].revenue += c.revsVat[i];
      byMonth[m].orders++;
    }
  }

  const months = Object.keys(byMonth).sort();
  let cumRevenue = 0;

  return months.map(month => {
    const m = byMonth[month];
    cumRevenue += m.revenue;
    const cumCustomers = customerFirstMonth.filter(fm => fm <= month).length;
    return {
      date: month + '-01',
      ltv: cumCustomers > 0 ? cumRevenue / cumCustomers : 0,
      aov: m.orders > 0 ? m.revenue / m.orders : 0,
    };
  });
}

export interface MonthlyNewVsReturningPoint {
  date: string;       // 'YYYY-MM-01'
  noví: number;
  stávající: number;
}

/** Měsíční počty nových vs. stávajících zákazníků pro stacked bar chart */
export function computeMonthlyNewVsReturning(data: CustomerRetentionRecord[]): MonthlyNewVsReturningPoint[] {
  const byMonth: Record<string, { noví: number; stávající: number }> = {};

  for (const c of data) {
    const firstDate = c.dates[0];
    if (!firstDate) continue;
    const firstMonth = firstDate.substring(0, 7);

    // Track which months this customer placed orders in
    const orderMonths = new Set(c.dates.map(d => d.substring(0, 7)));

    for (const month of orderMonths) {
      if (!byMonth[month]) byMonth[month] = { noví: 0, stávající: 0 };
      if (month === firstMonth) {
        byMonth[month].noví++;
      } else {
        byMonth[month].stávající++;
      }
    }
  }

  return Object.keys(byMonth)
    .sort()
    .map(month => ({ date: month + '-01', ...byMonth[month] }));
}

export interface MonthlyNewVsReturningRevenuePoint {
  date: string;       // 'YYYY-MM-01'
  noví: number;
  stávající: number;
}

/** Měsíční tržby bez DPH nových vs. stávajících zákazníků pro grouped bar chart */
export function computeMonthlyNewVsReturningRevenue(data: CustomerRetentionRecord[]): MonthlyNewVsReturningRevenuePoint[] {
  const byMonth: Record<string, { noví: number; stávající: number }> = {};

  for (const c of data) {
    const firstDate = c.dates[0];
    if (!firstDate) continue;
    const firstMonth = firstDate.substring(0, 7);

    for (let i = 0; i < c.dates.length; i++) {
      const month = c.dates[i].substring(0, 7);
      if (!byMonth[month]) byMonth[month] = { noví: 0, stávající: 0 };
      if (month === firstMonth) {
        byMonth[month].noví += c.revenues[i];
      } else {
        byMonth[month].stávající += c.revenues[i];
      }
    }
  }

  return Object.keys(byMonth)
    .sort()
    .map(month => ({ date: month + '-01', ...byMonth[month] }));
}

/** 'YYYY-MM' aktuálního (probíhajícího) měsíce a poslední den, do kterého jsou data kompletní (včera) */
function getCurrentMonthCutoff(): { monthKey: string; cutoffDay: number } {
  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  // Pokud je dnes 1. v měsíci, včerejšek spadá do minulého měsíce → aktuální měsíc ještě nemá žádná data
  const cutoffDay = yesterday.getMonth() === now.getMonth() ? yesterday.getDate() : 0;
  return { monthKey, cutoffDay };
}

export interface CurrentMonthYoyCutoff {
  monthKey: string;              // 'YYYY-MM' probíhajícího měsíce
  cutoffDay: number;             // den v měsíci, do kterého jsou letošní data kompletní
  prevNoví: number;
  prevStávající: number;
  prevNovíRevenue: number;
  prevStávajícíRevenue: number;
}

/**
 * Meziroční srovnání pro AKTUÁLNÍ (nedokončený) měsíc — hodnoty loňského roku
 * počítané jen do stejného dne v měsíci jako letos (ne za celý loňský měsíc),
 * aby srovnání nebylo zkreslené neúplnými daty aktuálního měsíce.
 */
export function computeCurrentMonthYoyCutoff(data: CustomerRetentionRecord[]): CurrentMonthYoyCutoff | null {
  const { monthKey, cutoffDay } = getCurrentMonthCutoff();
  if (cutoffDay === 0) return null;

  const [yearStr, monthStr] = monthKey.split('-');
  const prevMonthKey = `${parseInt(yearStr) - 1}-${monthStr}`;
  const cutoffStr = String(cutoffDay).padStart(2, '0');

  let prevNoví = 0, prevStávající = 0, prevNovíRevenue = 0, prevStávajícíRevenue = 0;
  for (const c of data) {
    const firstDate = c.dates[0];
    if (!firstDate) continue;
    const firstMonth = firstDate.substring(0, 7);

    for (let i = 0; i < c.dates.length; i++) {
      const d = c.dates[i];
      if (!d.startsWith(prevMonthKey)) continue;
      if (d.substring(8, 10) > cutoffStr) continue;
      if (firstMonth === prevMonthKey) {
        prevNoví++;
        prevNovíRevenue += c.revenues[i];
      } else {
        prevStávající++;
        prevStávajícíRevenue += c.revenues[i];
      }
    }
  }

  return { monthKey, cutoffDay, prevNoví, prevStávající, prevNovíRevenue, prevStávajícíRevenue };
}

/** Distribuce zákazníků a obratu podle počtu nákupů (1, 2, 3, 4+) */
export function computePurchaseDistribution(data: CustomerRetentionRecord[]): PurchaseDistPoint[] {
  const counts = [0, 0, 0, 0];
  const revenues = [0, 0, 0, 0];

  for (const c of data) {
    const bin = Math.min(c.dates.length - 1, 3);
    counts[bin]++;
    revenues[bin] += c.revsVat.reduce((s, v) => s + v, 0);
  }

  const totalCustomers = data.length;
  const totalRevenue = revenues.reduce((s, v) => s + v, 0);
  const labels = ['1 nákup', '2 nákupy', '3 nákupy', '4+ nákupů'];

  return labels.map((label, i) => ({
    label,
    customers: counts[i],
    customersPct: totalCustomers > 0 ? (counts[i] / totalCustomers) * 100 : 0,
    revenue: revenues[i],
    revenuePct: totalRevenue > 0 ? (revenues[i] / totalRevenue) * 100 : 0,
  }));
}

// ── RFM Segmentation ─────────────────────────────────────────────────────────

export type RfmSegment = 'champions' | 'loyal' | 'at_risk' | 'new' | 'one_time' | 'lost';

export interface RfmSegmentData {
  segment: RfmSegment;
  label: string;
  description: string;
  action: string;
  color: string;
  textColor: string;
  borderColor: string;
  barColor: string;
  count: number;
  customersPct: number;
  revenue: number;
  revenuePct: number;
  avgRecency: number;
  avgFrequency: number;
  avgMonetary: number;
}

const RFM_META: Record<RfmSegment, { label: string; description: string; action: string; color: string; textColor: string; borderColor: string; barColor: string }> = {
  champions: {
    label: 'Šampioni',
    description: '≥ 3 nákupy · poslední ≤ 90 dní',
    action: 'Odměňte věrnostním programem. Požádejte o recenzi. Exkluzivní přístup k novinkám.',
    color: 'bg-emerald-50', textColor: 'text-emerald-700', borderColor: 'border-emerald-400', barColor: 'bg-emerald-500',
  },
  loyal: {
    label: 'Věrní zákazníci',
    description: '≥ 2 nákupy · poslední ≤ 180 dní',
    action: 'Up-sell do vyšší kategorie. Referral program. Exkluzivní slevy.',
    color: 'bg-blue-50', textColor: 'text-blue-700', borderColor: 'border-blue-400', barColor: 'bg-blue-500',
  },
  at_risk: {
    label: 'Ohrožení',
    description: '≥ 2 nákupy · poslední 180–365 dní',
    action: 'Reaktivační e-mail se slevovým kódem. Připomeňte oblíbené produkty.',
    color: 'bg-amber-50', textColor: 'text-amber-700', borderColor: 'border-amber-400', barColor: 'bg-amber-400',
  },
  new: {
    label: 'Noví zákazníci',
    description: '1 nákup · poslední ≤ 90 dní',
    action: 'Onboarding e-mail. Cross-sell příbuzných produktů. Nabídněte druhý nákup se slevou.',
    color: 'bg-sky-50', textColor: 'text-sky-700', borderColor: 'border-sky-400', barColor: 'bg-sky-400',
  },
  one_time: {
    label: 'Jednorázové',
    description: '1 nákup · poslední 90–365 dní',
    action: 'Win-back kampaň s urgencí. Připomeňte novou kolekci nebo sezónní nabídku.',
    color: 'bg-slate-50', textColor: 'text-slate-500', borderColor: 'border-slate-300', barColor: 'bg-slate-300',
  },
  lost: {
    label: 'Ztracení zákazníci',
    description: 'Poslední nákup > 365 dní',
    action: 'Kampaň "Chybíš nám" s velkou slevou nebo průzkum důvodu odchodu.',
    color: 'bg-rose-50', textColor: 'text-rose-700', borderColor: 'border-rose-400', barColor: 'bg-rose-400',
  },
};

const RFM_ORDER: RfmSegment[] = ['champions', 'loyal', 'at_risk', 'new', 'one_time', 'lost'];

export function computeRfmSegments(
  data: CustomerRetentionRecord[],
  refDate?: Date
): RfmSegmentData[] {
  // Reference date = most recent order in dataset (or provided date)
  let refTs: number;
  if (refDate) {
    refTs = refDate.getTime();
  } else {
    let maxDate = '';
    for (const c of data) {
      const last = c.dates[c.dates.length - 1];
      if (last > maxDate) maxDate = last;
    }
    refTs = maxDate ? new Date(maxDate + 'T12:00:00').getTime() : Date.now();
  }

  const agg: Record<RfmSegment, { count: number; revenue: number; rSum: number; fSum: number; mSum: number }> = {
    champions: { count: 0, revenue: 0, rSum: 0, fSum: 0, mSum: 0 },
    loyal:     { count: 0, revenue: 0, rSum: 0, fSum: 0, mSum: 0 },
    at_risk:   { count: 0, revenue: 0, rSum: 0, fSum: 0, mSum: 0 },
    new:       { count: 0, revenue: 0, rSum: 0, fSum: 0, mSum: 0 },
    one_time:  { count: 0, revenue: 0, rSum: 0, fSum: 0, mSum: 0 },
    lost:      { count: 0, revenue: 0, rSum: 0, fSum: 0, mSum: 0 },
  };

  let totalRevenue = 0;
  const totalCustomers = data.length;

  for (const c of data) {
    const recency   = Math.round((refTs - new Date(c.dates[c.dates.length - 1] + 'T12:00:00').getTime()) / 86400000);
    const frequency = c.dates.length;
    const monetary  = c.revenues.reduce((s, v) => s + v, 0);

    totalRevenue += monetary;

    let seg: RfmSegment;
    if      (recency > 365)                         seg = 'lost';
    else if (frequency >= 3 && recency <= 90)       seg = 'champions';
    else if (frequency >= 2 && recency <= 180)      seg = 'loyal';
    else if (frequency >= 2)                        seg = 'at_risk';
    else if (recency <= 90)                         seg = 'new';
    else                                            seg = 'one_time';

    agg[seg].count++;
    agg[seg].revenue += monetary;
    agg[seg].rSum    += recency;
    agg[seg].fSum    += frequency;
    agg[seg].mSum    += monetary;
  }

  return RFM_ORDER.map(seg => {
    const a = agg[seg];
    return {
      segment: seg,
      ...RFM_META[seg],
      count:        a.count,
      customersPct: totalCustomers > 0 ? (a.count   / totalCustomers) * 100 : 0,
      revenue:      a.revenue,
      revenuePct:   totalRevenue   > 0 ? (a.revenue / totalRevenue)   * 100 : 0,
      avgRecency:   a.count > 0 ? Math.round(a.rSum / a.count) : 0,
      avgFrequency: a.count > 0 ? Math.round((a.fSum / a.count) * 10) / 10 : 0,
      avgMonetary:  a.count > 0 ? Math.round(a.mSum / a.count) : 0,
    };
  });
}

/** Histogram prodlevy mezi nákupy */
export function computeDaysBetweenHistogram(data: CustomerRetentionRecord[]): DaysBin[] {
  const bins = [
    { label: '0–7 dní',    min: 0,   max: 7 },
    { label: '8–30 dní',   min: 8,   max: 30 },
    { label: '31–60 dní',  min: 31,  max: 60 },
    { label: '61–90 dní',  min: 61,  max: 90 },
    { label: '91–180 dní', min: 91,  max: 180 },
    { label: '181–365 dní',min: 181, max: 365 },
    { label: '365+ dní',   min: 366, max: Infinity },
  ];

  const counts = new Array(bins.length).fill(0);
  let total = 0;

  for (const c of data) {
    for (let i = 1; i < c.dates.length; i++) {
      const days = (new Date(c.dates[i]).getTime() - new Date(c.dates[i - 1]).getTime()) / 86400000;
      for (let b = 0; b < bins.length; b++) {
        if (days >= bins[b].min && days <= bins[b].max) {
          counts[b]++;
          total++;
          break;
        }
      }
    }
  }

  return bins.map((bin, i) => ({
    label: bin.label,
    count: counts[i],
    pct: total > 0 ? (counts[i] / total) * 100 : 0,
  }));
}
