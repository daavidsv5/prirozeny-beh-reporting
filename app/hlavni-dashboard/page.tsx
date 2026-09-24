'use client';

import type { ReactNode } from 'react';

import { useMemo, useState, useEffect } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer,
} from 'recharts';
import { mockData, mockDataEshop, mockDataProdejna } from '@/data/mockGenerator';
import { marginDataCZ } from '@/data/marginDataCZ';
import { marginDataCZEshop } from '@/data/marginDataCZEshop';
import { prodejnaMarginDataCZ } from '@/data/prodejnaMarginDataCZ';
import { useHlavniDashboard } from '@/hooks/useHlavniDashboard';
import { aggregateMonthly, monthlyLtv } from '@/lib/hlavniDashboardData';
import { deriveKpi } from '@/lib/kpiMetrics';
import { useStoreFilter, pickByStore } from '@/hooks/useStoreFilter';

// ─── Constants ───────────────────────────────────────────────────────────────

const MONTHS_CS = ['Led', 'Úno', 'Bře', 'Dub', 'Kvě', 'Čvn', 'Čvc', 'Srp', 'Zář', 'Říj', 'Lis', 'Pro'];

// ─── Formatters ──────────────────────────────────────────────────────────────

function fmtCZK(v: number): string {
  return `${Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0')}\u00a0Kč`;
}

function fmtAxisCZK(v: number): string {
  if (v === 0) return '0';
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1).replace('.', ',')}M`;
  if (Math.abs(v) >= 1_000) return `${Math.round(v / 1_000)}k`;
  return String(Math.round(v));
}

function fmtAxisPct(v: number): string {
  return `${v.toFixed(1).replace('.', ',')} %`;
}

function fmtAxisRatio(v: number): string {
  return `${v.toFixed(1).replace('.', ',')}×`;
}

function fmtAxisCount(v: number): string {
  if (v >= 1000) return `${Math.round(v / 1000)}k`;
  return String(Math.round(v));
}

// ─── Device filter ───────────────────────────────────────────────────────────

type Device = 'all' | 'desktop' | 'mobile' | 'tablet';

const DEVICE_OPTIONS: { value: Device; label: string }[] = [
  { value: 'all',     label: 'Všechna zařízení' },
  { value: 'desktop', label: 'Desktop' },
  { value: 'mobile',  label: 'Mobil' },
  { value: 'tablet',  label: 'Tablet' },
];

function DeviceSelect({ value, onChange }: { value: Device; onChange: (d: Device) => void }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value as Device)}
      aria-label="Filtr zařízení"
      className="shrink-0 text-xs text-slate-600 bg-white border border-slate-200 rounded-md px-1.5 py-1 cursor-pointer hover:border-slate-300 focus:outline-none focus:ring-1 focus:ring-slate-300"
    >
      {DEVICE_OPTIONS.map(o => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

// ─── Chart component ─────────────────────────────────────────────────────────

interface ChartCardProps {
  title: string;
  subtitle?: string;
  data: { month: string; a: number; b: number }[];
  colorA: string;   // newer year — darker
  colorB: string;   // older year — lighter
  yearA: number;
  yearB: number;
  axisFormatter: (v: number) => string;
  tooltipFormatter: (v: number) => string;
  headerRight?: ReactNode;
  /** Zvýrazní podnadpis jako upozornění */
  subtitleWarning?: boolean;
}

function ChartCard({ title, subtitle, data, colorA, colorB, yearA, yearB, axisFormatter, tooltipFormatter, headerRight, subtitleWarning }: ChartCardProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="bg-white border border-slate-200 rounded-lg p-2.5 text-xs shadow-sm">
        <p className="font-medium text-slate-600 mb-1">{label}</p>
        {payload.map((entry: any) => (
          <p key={entry.name} style={{ color: entry.fill }}>
            {entry.name}: <span className="font-semibold">{tooltipFormatter(entry.value)}</span>
          </p>
        ))}
      </div>
    );
  };

  return (
    <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-4">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
          {subtitle && <p className={`text-xs mt-0.5 ${subtitleWarning ? 'text-amber-600 font-medium' : 'text-slate-400'}`}>{subtitle}</p>}
        </div>
        {headerRight}
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }} barGap={2} barCategoryGap="25%">
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
          <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
          <YAxis tickFormatter={axisFormatter} tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={46} />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: '#f8fafc' }} />
          <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} iconType="square" iconSize={10} />
          <Bar dataKey="b" name={String(yearB)} fill={colorB} radius={[2, 2, 0, 0]} maxBarSize={28} />
          <Bar dataKey="a" name={String(yearA)} fill={colorA} radius={[2, 2, 0, 0]} maxBarSize={28} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function HlavniDashboardPage() {
  const { yearA, yearB } = useHlavniDashboard();
  const { store } = useStoreFilter();
  const storeMockData     = pickByStore(store, mockData, mockDataEshop, mockDataProdejna);
  const storeMarginDataCZ = pickByStore(store, marginDataCZ, marginDataCZEshop, prodejnaMarginDataCZ);

  const monthsA = useMemo(() => aggregateMonthly(yearA, storeMockData, storeMarginDataCZ), [yearA, storeMockData, storeMarginDataCZ]);
  const monthsB = useMemo(() => aggregateMonthly(yearB, storeMockData, storeMarginDataCZ), [yearB, storeMockData, storeMarginDataCZ]);
  const ltvA = useMemo(() => monthlyLtv(yearA), [yearA]);
  const ltvB = useMemo(() => monthlyLtv(yearB), [yearB]);

  const [cvrData, setCvrData] = useState<{ month: string; a: number; b: number }[] | null>(null);
  const [sessionsData, setSessionsData] = useState<{ month: string; a: number; b: number }[] | null>(null);
  const [device, setDevice] = useState<Device>('all');

  useEffect(() => {
    setCvrData(null);
    setSessionsData(null);
    fetch(`/api/analytics/monthly-cvr?yearA=${yearA}&yearB=${yearB}&device=${device}`)
      .then(r => r.json())
      .then(d => {
        if (Array.isArray(d.cvrA)) {
          setCvrData(MONTHS_CS.map((month, i) => ({ month, a: d.cvrA[i] ?? 0, b: d.cvrB[i] ?? 0 })));
        }
        if (Array.isArray(d.sessionsA)) {
          setSessionsData(MONTHS_CS.map((month, i) => ({ month, a: d.sessionsA[i] ?? 0, b: d.sessionsB[i] ?? 0 })));
        }
      })
      .catch(() => {});
  }, [yearA, yearB, device]);

  const chartData = useMemo(() => MONTHS_CS.map((month, i) => {
    const a = deriveKpi(monthsA[i]);
    const b = deriveKpi(monthsB[i]);
    const pair = (k: keyof typeof a) => ({ a: a[k], b: b[k] });
    return {
      month,
      revenue:     pair('revenue'),
      grossProfit: pair('grossProfit'),
      orders:      pair('orders'),
      cost:        pair('cost'),
      pno:         pair('pno'),
      aov:         pair('aov'),
      marginPct:   pair('marginPct'),
      cpa:         pair('cpa'),
      poas:        pair('poas'),
      ltv:         { a: ltvA[i], b: ltvB[i] },
    };
  }), [monthsA, monthsB, ltvA, ltvB]);

  // Nákupní ceny chybí u starších dat → POAS za taková období je nadhodnocený
  const poasNote = undefined as string | undefined;

  function makeData(key: keyof typeof chartData[0]): { month: string; a: number; b: number }[] {
    return chartData.map(d => ({ month: d.month, ...(d[key] as { a: number; b: number }) }));
  }

  const pctFmt = (v: number) => `${v.toFixed(1).replace('.', ',')} %`;
  const ratioFmt = (v: number) => `${v.toFixed(2).replace('.', ',')}×`;
  const countFmt = (v: number) => Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-slate-900">Měsíční přehled</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Měsíční přehled klíčových metrik · srovnání s předchozím rokem
        </p>
      </div>

      {/* Charts grid */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <ChartCard title="Tržby bez DPH"
          data={makeData('revenue')}
          colorA="#2563eb" colorB="#93c5fd"
          yearA={yearA} yearB={yearB}
          axisFormatter={fmtAxisCZK} tooltipFormatter={fmtCZK}
        />
        <ChartCard title="Hrubý zisk"
          data={makeData('grossProfit')}
          colorA="#16a34a" colorB="#86efac"
          yearA={yearA} yearB={yearB}
          axisFormatter={fmtAxisCZK} tooltipFormatter={fmtCZK}
        />
        <ChartCard title="Počet objednávek"
          data={makeData('orders')}
          colorA="#1e40af" colorB="#93c5fd"
          yearA={yearA} yearB={yearB}
          axisFormatter={fmtAxisCount} tooltipFormatter={v => String(Math.round(v))}
        />
        <ChartCard title="Marketingové investice"
          data={makeData('cost')}
          colorA="#dc2626" colorB="#fca5a5"
          yearA={yearA} yearB={yearB}
          axisFormatter={fmtAxisCZK} tooltipFormatter={fmtCZK}
        />
        <ChartCard title="PNO (%)"
          data={makeData('pno')}
          colorA="#0891b2" colorB="#67e8f9"
          yearA={yearA} yearB={yearB}
          axisFormatter={fmtAxisPct} tooltipFormatter={pctFmt}
        />
        <ChartCard title="AOV – Průměrná hodnota objednávky"
          data={makeData('aov')}
          colorA="#4338ca" colorB="#c4b5fd"
          yearA={yearA} yearB={yearB}
          axisFormatter={fmtAxisCZK} tooltipFormatter={fmtCZK}
        />
        <ChartCard title="Marže (%)"
          data={makeData('marginPct')}
          colorA="#15803d" colorB="#86efac"
          yearA={yearA} yearB={yearB}
          axisFormatter={fmtAxisPct} tooltipFormatter={pctFmt}
        />
        <ChartCard title="Cena za objednávku (CPA)"
          data={makeData('cpa')}
          colorA="#7c3aed" colorB="#c4b5fd"
          yearA={yearA} yearB={yearB}
          axisFormatter={fmtAxisCZK} tooltipFormatter={fmtCZK}
        />
        <ChartCard title="POAS"
          subtitle={poasNote ?? 'Marže / marketingové investice'}
          subtitleWarning={!!poasNote}
          data={makeData('poas')}
          colorA="#059669" colorB="#6ee7b7"
          yearA={yearA} yearB={yearB}
          axisFormatter={fmtAxisRatio} tooltipFormatter={ratioFmt}
        />
        <ChartCard title="LTV (bez DPH)"
          subtitle="Kumulativně ke konci měsíce: tržby bez DPH / počet zákazníků"
          data={makeData('ltv')}
          colorA="#0284c7" colorB="#7dd3fc"
          yearA={yearA} yearB={yearB}
          axisFormatter={fmtAxisCZK} tooltipFormatter={fmtCZK}
        />
        {sessionsData && (
          <ChartCard title="Návštěvnost webu"
            subtitle="Zdroj: GA4 · pouze CZ"
            data={sessionsData}
            colorA="#1d4ed8" colorB="#93c5fd"
            yearA={yearA} yearB={yearB}
            axisFormatter={fmtAxisCount} tooltipFormatter={countFmt}
            headerRight={<DeviceSelect value={device} onChange={setDevice} />}
          />
        )}
        {cvrData && (
          <ChartCard title="Konverzní poměr"
            subtitle="Zdroj: GA4 · pouze CZ"
            data={cvrData}
            colorA="#0e7490" colorB="#a5f3fc"
            yearA={yearA} yearB={yearB}
            axisFormatter={fmtAxisPct} tooltipFormatter={pctFmt}
            headerRight={<DeviceSelect value={device} onChange={setDevice} />}
          />
        )}
      </div>
    </div>
  );
}
