'use client';

import { useEffect, useMemo, useState } from 'react';
import { mockData, mockDataEshop, mockDataProdejna } from '@/data/mockGenerator';
import { marginDataCZ } from '@/data/marginDataCZ';
import { marginDataCZEshop } from '@/data/marginDataCZEshop';
import { prodejnaMarginDataCZ } from '@/data/prodejnaMarginDataCZ';
import { useRocniPrehled } from '@/hooks/useRocniPrehled';
import { useStoreFilter, pickByStore } from '@/hooks/useStoreFilter';
import { aggregateMonthly, monthlyLtv } from '@/lib/hlavniDashboardData';
import { deriveKpi, type KpiMetrics } from '@/lib/kpiMetrics';
import {
  CURRENT_YEAR, CUTOFF_DATE, CUTOFF_LABEL, getYearInfos, ltvAtPeriodEnd, periodFilter, sumKpiRows,
  type YearPeriod,
} from '@/lib/rocniPrehled';
import {
  YearChartCard, buildYearPoints, DeviceSelect, type ChangeKind, type Device,
  fmtMoney, fmtCount, fmtPct, fmtPct2, fmtRatio, fmtAxisMoney, fmtAxisCount, fmtAxisPct, fmtAxisRatio,
} from '@/components/charts/YearChartCard';

type Ga4Year = { year: number; sessions: number; conversions: number };
type YearMetrics = KpiMetrics & { ltv: number };

const fmtCZK = fmtMoney('Kč');

export default function RocniPrehledPage() {
  const { yearInfos: allYearInfos, selectedYears } = useRocniPrehled();
  const { store } = useStoreFilter();
  const storeMockData     = pickByStore(store, mockData, mockDataEshop, mockDataProdejna);
  const storeMarginDataCZ = pickByStore(store, marginDataCZ, marginDataCZEshop, prodejnaMarginDataCZ);
  const [device, setDevice] = useState<Device>('all');
  const [ga4, setGa4] = useState<Ga4Year[] | null>(null);
  const [ga4PrevYtd, setGa4PrevYtd] = useState<Ga4Year | null>(null);

  // Neúplné roky podle zvoleného obchodu (e-shop / prodejna mohou začínat jindy)
  const yearInfos = useMemo(
    () => getYearInfos(storeMockData.filter(r => r.country === 'cz')),
    [storeMockData],
  );

  const metricsFor = useMemo(() => {
    const cache: Record<string, YearMetrics> = {};
    return (year: number, period: YearPeriod): YearMetrics => {
      const key = `${year}-${period}`;
      if (!cache[key]) {
        const row = sumKpiRows(aggregateMonthly(year, storeMockData, storeMarginDataCZ, periodFilter(period)));
        cache[key] = { ...deriveKpi(row), ltv: ltvAtPeriodEnd(monthlyLtv(year), year, period) };
      }
      return cache[key];
    };
  }, [storeMockData, storeMarginDataCZ]);

  const known = useMemo(() => new Set(allYearInfos.map(y => y.year)), [allYearInfos]);

  useEffect(() => {
    setGa4(null);
    const years = allYearInfos.map(y => y.year).join(',');
    fetch(`/api/analytics/yearly?years=${years}&cutoff=${CUTOFF_DATE}&period=full&device=${device}`)
      .then(r => r.json())
      .then(json => { if (Array.isArray(json.years)) setGa4(json.years); })
      .catch(() => {});
    fetch(`/api/analytics/yearly?years=${CURRENT_YEAR - 1}&cutoff=${CUTOFF_DATE}&period=ytd&device=${device}`)
      .then(r => r.json())
      .then(json => { if (Array.isArray(json.years) && json.years[0]) setGa4PrevYtd(json.years[0]); })
      .catch(() => {});
  }, [allYearInfos, device]);

  const ga4ByYear = useMemo(() => {
    const out: Record<number, Ga4Year> = {};
    for (const g of ga4 ?? []) out[g.year] = g;
    return out;
  }, [ga4]);

  const sessionsOf = (g?: Ga4Year | null) => (g && g.sessions > 0 ? g.sessions : null);
  const cvrOf = (g?: Ga4Year | null) => (g && g.sessions > 0 ? (g.conversions / g.sessions) * 100 : null);

  const kpi = (key: keyof YearMetrics, kind: ChangeKind) => buildYearPoints({
    selectedYears, yearInfos, kind,
    getValue: y => (known.has(y) ? metricsFor(y, 'full')[key] : null),
    prevYtdValue: known.has(CURRENT_YEAR - 1) ? metricsFor(CURRENT_YEAR - 1, 'ytd')[key] : null,
  });

  const ga4Points = (pick: (g?: Ga4Year | null) => number | null, kind: ChangeKind) => buildYearPoints({
    selectedYears, yearInfos, kind,
    getValue: y => pick(ga4ByYear[y]),
    prevYtdValue: pick(ga4PrevYtd),
  });

  const selectedPartial = yearInfos.filter(y => y.partial && selectedYears.includes(y.year));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-slate-900">Roční přehled</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Srovnání klíčových metrik po letech · minulé roky celé, {CURRENT_YEAR} od 1. 1. do {CUTOFF_LABEL}
        </p>
        <p className="text-xs text-slate-400 mt-1">
          Číslo nad sloupcem ukazuje změnu proti předchozímu roku, u minulých let celý rok proti celému roku. Rok {CURRENT_YEAR} se srovnává se stejným obdobím {CURRENT_YEAR - 1}, tedy 1. 1. až {CUTOFF_LABEL} (poslední kompletní den dat). U PNO, marže a konverzního poměru jde o rozdíl v procentních bodech.
        </p>
        {selectedPartial.map(y => {
          const [yy, mm, dd] = y.firstOrderDate.split('-').map(Number);
          return (
            <p key={y.year} className="text-xs text-amber-600 font-medium mt-1">
              ⚠ Rok {y.year} obsahuje objednávky až od {dd}. {mm}. {yy}, proto u něj ani u roku {y.year + 1} změnu nepočítáme.
            </p>
          );
        })}
      </div>

      {/* Charts grid */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <YearChartCard title="Tržby bez DPH" data={kpi('revenue', 'pct')}
          colorCurrent="#2563eb" colorOther="#93c5fd" changeKind="pct"
          axisFormatter={fmtAxisMoney} valueFormatter={fmtCZK} />
        <YearChartCard title="Hrubý zisk" data={kpi('grossProfit', 'pct')}
          colorCurrent="#16a34a" colorOther="#86efac" changeKind="pct"
          axisFormatter={fmtAxisMoney} valueFormatter={fmtCZK} />
        <YearChartCard title="Počet objednávek" data={kpi('orders', 'pct')}
          colorCurrent="#1e40af" colorOther="#93c5fd" changeKind="pct"
          axisFormatter={fmtAxisCount} valueFormatter={fmtCount} />
        <YearChartCard title="Marketingové investice" data={kpi('cost', 'pct')}
          colorCurrent="#dc2626" colorOther="#fca5a5" changeKind="pct" lowerIsBetter
          axisFormatter={fmtAxisMoney} valueFormatter={fmtCZK} />
        <YearChartCard title="PNO (%)" data={kpi('pno', 'pp')}
          colorCurrent="#0891b2" colorOther="#67e8f9" changeKind="pp" lowerIsBetter
          axisFormatter={fmtAxisPct} valueFormatter={fmtPct} />
        <YearChartCard title="AOV, průměrná hodnota objednávky" subtitle="Bez DPH" data={kpi('aov', 'pct')}
          colorCurrent="#4338ca" colorOther="#c4b5fd" changeKind="pct"
          axisFormatter={fmtAxisMoney} valueFormatter={fmtCZK} />
        <YearChartCard title="Marže (%)" data={kpi('marginPct', 'pp')}
          colorCurrent="#15803d" colorOther="#86efac" changeKind="pp"
          axisFormatter={fmtAxisPct} valueFormatter={fmtPct} />
        <YearChartCard title="Cena za objednávku (CPA)" data={kpi('cpa', 'pct')}
          colorCurrent="#7c3aed" colorOther="#c4b5fd" changeKind="pct" lowerIsBetter
          axisFormatter={fmtAxisMoney} valueFormatter={fmtCZK} />
        <YearChartCard title="POAS" subtitle="Marže / marketingové investice" data={kpi('poas', 'pct')}
          colorCurrent="#059669" colorOther="#6ee7b7" changeKind="pct"
          axisFormatter={fmtAxisRatio} valueFormatter={fmtRatio} />
        <YearChartCard title="LTV (bez DPH)" subtitle="Kumulativně ke konci období, tržby bez DPH / počet zákazníků" data={kpi('ltv', 'pct')}
          colorCurrent="#0284c7" colorOther="#7dd3fc" changeKind="pct"
          axisFormatter={fmtAxisMoney} valueFormatter={fmtCZK} />
        {ga4 && (
          <YearChartCard title="Návštěvnost webu" subtitle="Zdroj GA4, počet návštěv"
            data={ga4Points(sessionsOf, 'pct')}
            colorCurrent="#1d4ed8" colorOther="#93c5fd" changeKind="pct"
            axisFormatter={fmtAxisCount} valueFormatter={fmtCount}
            headerRight={<DeviceSelect value={device} onChange={setDevice} />} />
        )}
        {ga4 && (
          <YearChartCard title="Konverzní poměr" subtitle="Zdroj GA4, konverze / návštěvy"
            data={ga4Points(cvrOf, 'pp')}
            colorCurrent="#0e7490" colorOther="#a5f3fc" changeKind="pp"
            axisFormatter={fmtAxisPct} valueFormatter={fmtPct2}
            headerRight={<DeviceSelect value={device} onChange={setDevice} />} />
        )}
      </div>
    </div>
  );
}
