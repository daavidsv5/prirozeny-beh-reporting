// Sdílené vzorce KPI pro Měsíční přehled (měsíce) a Roční přehled (roky).
// Poměrové metriky se počítají vždy ze součtů za období, nikdy průměrem dílčích hodnot.

export interface KpiRow {
  revenue: number;       // tržby bez DPH
  orders: number;
  cost: number;          // marketingové investice
  purchaseCost: number;  // nákupní cena (marginData)
  marginRev: number;     // tržby bez DPH z marginData
}

export const emptyKpiRow = (): KpiRow => ({ revenue: 0, orders: 0, cost: 0, purchaseCost: 0, marginRev: 0 });

export interface KpiMetrics {
  revenue: number;
  grossProfit: number;
  orders: number;
  cost: number;
  pno: number;
  aov: number;
  marginPct: number;
  cpa: number;
  poas: number;
}

export function deriveKpi(r: KpiRow): KpiMetrics {
  return {
    revenue:     r.revenue,
    grossProfit: r.marginRev - r.purchaseCost - r.cost,
    orders:      r.orders,
    cost:        r.cost,
    pno:         r.revenue > 0 ? (r.cost / r.revenue) * 100 : 0,
    aov:         r.orders > 0 ? r.revenue / r.orders : 0,
    marginPct:   r.marginRev > 0 ? ((r.marginRev - r.purchaseCost) / r.marginRev) * 100 : 0,
    cpa:         r.orders > 0 ? r.cost / r.orders : 0,
    poas:        r.cost > 0 ? (r.marginRev - r.purchaseCost) / r.cost : 0,
  };
}
