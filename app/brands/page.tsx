'use client';

import { useEffect, useState, useMemo, useRef } from 'react';
import { useFilters, getDateRange } from '@/hooks/useFilters';
import { formatCurrency, formatNumber, localIsoDate } from '@/lib/formatters';
import {
  Award, Download, TrendingUp, TrendingDown,
  ChevronUp, ChevronDown, ChevronsUpDown, Search, X, LineChart as LineChartIcon,
} from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer,
} from 'recharts';
import type { BrandApiRow, BrandDailyPoint, BrandsResponse } from '@/app/api/brands/route';

// ── Constants ─────────────────────────────────────────────────────────────────

const MONTHS_CS = ['Led','Úno','Bře','Dub','Kvě','Čvn','Čvc','Srp','Zář','Říj','Lis','Pro'];

const TREND_COLORS = [
  '#2563eb', '#16a34a', '#dc2626', '#d97706', '#7c3aed',
  '#0891b2', '#db2777', '#65a30d', '#ea580c', '#0284c7',
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtMonth(iso: string) {
  const [y, m] = iso.split('-');
  return `${MONTHS_CS[parseInt(m) - 1]} ${y}`;
}

function fmtDay(iso: string) {
  const [, m, d] = iso.split('-');
  return `${parseInt(d)}.${parseInt(m)}.`;
}

function yoyPct(current: number, prev: number): number | null {
  if (prev === 0) return null;
  return ((current - prev) / prev) * 100;
}

function YoyBadge({ current, prev }: { current: number; prev: number }) {
  const pct = yoyPct(current, prev);
  if (pct === null) return <span className="text-[11px] text-slate-400">—</span>;
  const positive = pct >= 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] font-bold px-1.5 py-0.5 rounded-lg ${
      positive ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-500'
    }`}>
      {positive ? <TrendingUp size={9} /> : <TrendingDown size={9} />}
      {positive ? '+' : ''}{pct.toFixed(1)} %
    </span>
  );
}

function YoyPpBadge({ current, prev }: { current: number | null; prev: number | null }) {
  if (current === null || prev === null) return null;
  const diff = current - prev;
  if (Math.abs(diff) < 0.05) return null;
  const positive = diff >= 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] font-bold px-1.5 py-0.5 rounded-lg ${
      positive ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-500'
    }`}>
      {positive ? <TrendingUp size={9} /> : <TrendingDown size={9} />}
      {positive ? '+' : ''}{diff.toFixed(1)} pp
    </span>
  );
}

function MarginCell({ revenue, purchaseCost, prevRevenue, prevPurchaseCost, hasPrevData }: {
  revenue: number; purchaseCost: number;
  prevRevenue: number; prevPurchaseCost: number;
  hasPrevData: boolean;
}) {
  const pct     = revenue     > 0 ? ((revenue - purchaseCost)         / revenue)     * 100 : null;
  const prevPct = prevRevenue > 0 ? ((prevRevenue - prevPurchaseCost) / prevRevenue) * 100 : null;
  const cls = pct === null ? 'text-slate-400' : pct >= 30 ? 'text-emerald-600' : pct >= 15 ? 'text-amber-600' : 'text-rose-500';
  return (
    <div className="flex flex-col items-end gap-0.5">
      <span className={`font-semibold tabular-nums ${cls}`}>{pct !== null ? pct.toFixed(1) + ' %' : '–'}</span>
      {hasPrevData && <YoyPpBadge current={pct} prev={prevPct} />}
    </div>
  );
}

function ShareBar({ pct }: { pct: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-slate-100 rounded-full min-w-[60px]">
        <div className="h-1.5 bg-blue-500 rounded-full" style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <span className="text-xs font-bold text-slate-600 w-10 text-right">{pct.toFixed(1)}%</span>
    </div>
  );
}

// ── Sort ──────────────────────────────────────────────────────────────────────

type SortCol = 'brand' | 'revenueVat' | 'revenue' | 'margin' | 'marginPct' | 'soldQty' | 'share';
type SortDir = 'asc' | 'desc';
type SortState = { col: SortCol; dir: SortDir };

function SortIcon({ col, sort }: { col: SortCol; sort: SortState }) {
  if (sort.col !== col) return <ChevronsUpDown size={12} className="text-slate-400 inline ml-1" />;
  return sort.dir === 'asc'
    ? <ChevronUp   size={12} className="text-white inline ml-1" />
    : <ChevronDown size={12} className="text-white inline ml-1" />;
}

// ── Trend chart ───────────────────────────────────────────────────────────────

function buildChartData(
  daily: BrandDailyPoint[],
  dailyPrev: BrandDailyPoint[],
  brands: string[],
  isMonthly: boolean,
  startStr: string,
  prevStartStr: string,
  hasPrevData: boolean,
): { label: string; [key: string]: number | string }[] {
  const offsetMs = new Date(startStr).getTime() - new Date(prevStartStr).getTime();
  const curYear  = new Date(startStr).getFullYear();
  const prevYear = new Date(prevStartStr).getFullYear();

  const buckets = new Map<string, Record<string, number>>();

  for (const r of daily) {
    if (!brands.includes(r.brand)) continue;
    const key = isMonthly ? r.date.slice(0, 7) : r.date;
    if (!buckets.has(key)) buckets.set(key, {});
    const b = buckets.get(key)!;
    b[`${r.brand}__cur`] = (b[`${r.brand}__cur`] ?? 0) + r.revenue;
  }

  if (hasPrevData) {
    for (const r of dailyPrev) {
      if (!brands.includes(r.brand)) continue;
      let shiftedKey: string;
      if (isMonthly) {
        const d = new Date(r.date + 'T00:00:00');
        d.setFullYear(d.getFullYear() + (curYear - prevYear));
        shiftedKey = d.toISOString().slice(0, 7);
      } else {
        shiftedKey = localIsoDate(new Date(new Date(r.date + 'T00:00:00').getTime() + offsetMs));
      }
      if (!buckets.has(shiftedKey)) buckets.set(shiftedKey, {});
      const b = buckets.get(shiftedKey)!;
      b[`${r.brand}__prev`] = (b[`${r.brand}__prev`] ?? 0) + r.revenue;
    }
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, vals]) => ({
      label: isMonthly ? fmtMonth(key + '-01') : fmtDay(key),
      ...vals,
    }));
}

function TrendChart({
  daily, dailyPrev, allBrands, isMonthly, hasPrevData, fc, startStr, prevStartStr,
}: {
  daily: BrandDailyPoint[];
  dailyPrev: BrandDailyPoint[];
  allBrands: string[];
  isMonthly: boolean;
  hasPrevData: boolean;
  fc: (v: number) => string;
  startStr: string;
  prevStartStr: string;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery]       = useState('');
  const [open, setOpen]         = useState(false);
  const inputRef    = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    const opts = q ? allBrands.filter(b => b.toLowerCase().includes(q)) : allBrands;
    return opts.slice(0, 60);
  }, [query, allBrands]);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
        inputRef.current    && !inputRef.current.contains(e.target as Node)
      ) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const add = (brand: string) => {
    if (!selected.includes(brand)) setSelected(p => [...p, brand]);
    setQuery(''); setOpen(false);
    inputRef.current?.focus();
  };
  const remove = (brand: string) => setSelected(p => p.filter(b => b !== brand));

  const chartData = useMemo(
    () => buildChartData(daily, dailyPrev, selected, isMonthly, startStr, prevStartStr, hasPrevData),
    [daily, dailyPrev, selected, isMonthly, startStr, prevStartStr, hasPrevData],
  );

  const fmtAxis = (v: number) =>
    v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 1_000 ? `${Math.round(v / 1_000)}k` : String(Math.round(v));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ChartTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const byBrand: Record<string, { cur?: number; prev?: number; color: string }> = {};
    for (const entry of payload) {
      const key   = entry.dataKey as string;
      const isCur = key.endsWith('__cur');
      const name  = key.replace(/__cur$|__prev$/, '');
      if (!byBrand[name]) byBrand[name] = { color: entry.stroke };
      if (isCur) byBrand[name].cur  = entry.value;
      else       byBrand[name].prev = entry.value;
    }
    return (
      <div className="bg-white border border-slate-200 rounded-xl shadow-md p-3 text-xs min-w-[200px] max-w-[280px]">
        <p className="font-semibold text-slate-600 mb-1.5">{label}</p>
        {Object.entries(byBrand).map(([name, vals]) => (
          <div key={name} className="mb-1 last:mb-0">
            <p style={{ color: vals.color }} className="font-medium truncate">{name}</p>
            <div className="flex gap-3 pl-0.5">
              {vals.cur  !== undefined && <span className="text-slate-700">Akt.: <b>{fc(vals.cur)}</b></span>}
              {vals.prev !== undefined && hasPrevData && <span className="text-slate-400">Min.: <b>{fc(vals.prev)}</b></span>}
            </div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
      <div className="flex items-center gap-2 mb-4">
        <LineChartIcon size={16} className="text-blue-600" />
        <h2 className="text-sm font-semibold text-slate-700">Vývoj tržeb — vybrané značky</h2>
        <span className="text-xs text-slate-400 hidden sm:inline">tržby bez DPH</span>
      </div>

      {/* Brand selector */}
      <div className="mb-4">
        {selected.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {selected.map((brand, idx) => (
              <span
                key={brand}
                className="inline-flex items-center gap-1 pl-2.5 pr-1.5 py-1 rounded-full text-xs font-medium text-white"
                style={{ backgroundColor: TREND_COLORS[idx % TREND_COLORS.length] }}
              >
                <span className="max-w-[180px] truncate">{brand}</span>
                <button
                  onClick={() => remove(brand)}
                  className="ml-0.5 rounded-full hover:bg-white/20 p-0.5 transition-colors"
                >
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="relative">
          <div className="relative flex items-center">
            <Search size={14} className="absolute left-3 text-slate-400 pointer-events-none" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={e => { setQuery(e.target.value); setOpen(true); }}
              onFocus={() => setOpen(true)}
              placeholder="Hledat značku…"
              className="w-full sm:w-96 pl-8 pr-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            />
          </div>

          {open && suggestions.length > 0 && (
            <div
              ref={dropdownRef}
              className="absolute z-20 mt-1 w-full sm:w-96 bg-white border border-slate-200 rounded-xl shadow-lg max-h-64 overflow-y-auto"
            >
              {suggestions.map(brand => {
                const isSel = selected.includes(brand);
                return (
                  <button
                    key={brand}
                    onMouseDown={e => { e.preventDefault(); if (!isSel) add(brand); }}
                    className={`w-full text-left px-3 py-2 text-xs hover:bg-blue-50 transition-colors flex items-center gap-2 ${
                      isSel ? 'text-slate-400 bg-slate-50 cursor-default' : 'text-slate-700'
                    }`}
                  >
                    {isSel && <span className="text-blue-400">✓</span>}
                    <span className="font-medium">{brand}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Chart */}
      {selected.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-44 text-slate-400 gap-2">
          <LineChartIcon size={32} className="opacity-30" />
          <p className="text-sm">Vyhledej a vyber značku pro zobrazení vývoje tržeb</p>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: '#94a3b8' }}
              axisLine={false}
              tickLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              tickFormatter={fmtAxis}
              tick={{ fontSize: 11, fill: '#94a3b8' }}
              axisLine={false}
              tickLine={false}
              width={52}
            />
            <Tooltip content={<ChartTooltip />} />
            <Legend
              formatter={(value: string) => {
                const isCur = value.endsWith('__cur');
                const name  = value.replace(/__cur$|__prev$/, '');
                const short = name.length > 28 ? name.slice(0, 28) + '…' : name;
                return (
                  <span className="text-xs text-slate-600">
                    {short}
                    {hasPrevData && <span className="text-slate-400"> ({isCur ? 'akt.' : 'min.'})</span>}
                  </span>
                );
              }}
              wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
              iconType="circle"
              iconSize={8}
            />
            {selected.map((brand, idx) => [
              <Line
                key={`${brand}__cur`}
                type="monotone"
                dataKey={`${brand}__cur`}
                name={`${brand}__cur`}
                stroke={TREND_COLORS[idx % TREND_COLORS.length]}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />,
              ...(hasPrevData ? [
                <Line
                  key={`${brand}__prev`}
                  type="monotone"
                  dataKey={`${brand}__prev`}
                  name={`${brand}__prev`}
                  stroke={TREND_COLORS[idx % TREND_COLORS.length]}
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                  strokeOpacity={0.45}
                  dot={false}
                  activeDot={{ r: 3 }}
                />,
              ] : []),
            ])}
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function BrandsPage() {
  const { filters } = useFilters();
  const { start, end, prevStart, prevEnd } = getDateRange(filters);
  const startStr     = localIsoDate(start);
  const endStr       = localIsoDate(end);
  const prevStartStr = localIsoDate(prevStart);
  const prevEndStr   = localIsoDate(prevEnd);

  const [data, setData]       = useState<BrandsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [sort, setSort]       = useState<SortState>({ col: 'revenueVat', dir: 'desc' });

  const dayCount  = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  const isMonthly = dayCount > 60;

  useEffect(() => {
    setLoading(true);
    fetch(`/api/brands?from=${startStr}&to=${endStr}&prevFrom=${prevStartStr}&prevTo=${prevEndStr}`)
      .then(r => r.json())
      .then((d: BrandsResponse) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [startStr, endStr, prevStartStr, prevEndStr]);

  const fc = (v: number) => formatCurrency(v, 'CZK');

  const sorted = useMemo(() => {
    if (!data?.brands) return [];
    return [...data.brands].sort((a, b) => {
      const mA = a.revenue > 0 ? (a.revenue - a.purchaseCost) / a.revenue * 100 : -Infinity;
      const mB = b.revenue > 0 ? (b.revenue - b.purchaseCost) / b.revenue * 100 : -Infinity;
      let cmp = 0;
      switch (sort.col) {
        case 'brand':      cmp = a.brand.localeCompare(b.brand, 'cs'); break;
        case 'revenueVat': cmp = a.revenueVat - b.revenueVat; break;
        case 'revenue':    cmp = a.revenue - b.revenue; break;
        case 'margin':     cmp = (a.revenue - a.purchaseCost) - (b.revenue - b.purchaseCost); break;
        case 'marginPct':  cmp = mA - mB; break;
        case 'soldQty':    cmp = a.soldQty - b.soldQty; break;
        case 'share':      cmp = a.share - b.share; break;
      }
      return sort.dir === 'asc' ? cmp : -cmp;
    });
  }, [data, sort]);

  const totals = useMemo(() => {
    if (!data?.brands) return null;
    return data.brands.reduce(
      (acc, r) => ({
        revenueVat:       acc.revenueVat       + r.revenueVat,
        prevRevenueVat:   acc.prevRevenueVat   + r.prevRevenueVat,
        revenue:          acc.revenue          + r.revenue,
        prevRevenue:      acc.prevRevenue      + r.prevRevenue,
        purchaseCost:     acc.purchaseCost     + r.purchaseCost,
        prevPurchaseCost: acc.prevPurchaseCost + r.prevPurchaseCost,
        soldQty:          acc.soldQty          + r.soldQty,
        prevSoldQty:      acc.prevSoldQty      + r.prevSoldQty,
      }),
      { revenueVat: 0, prevRevenueVat: 0, revenue: 0, prevRevenue: 0, purchaseCost: 0, prevPurchaseCost: 0, soldQty: 0, prevSoldQty: 0 },
    );
  }, [data]);

  const allBrands = useMemo(
    () => (data?.brands ?? []).map(r => r.brand).sort((a, b) => a.localeCompare(b, 'cs')),
    [data],
  );

  function toggleSort(col: SortCol) {
    setSort(s =>
      s.col === col
        ? { col, dir: s.dir === 'asc' ? 'desc' : 'asc' }
        : { col, dir: col === 'brand' ? 'asc' : 'desc' },
    );
  }

  function exportCsv() {
    if (!data) return;
    const header = ['Značka', 'Tržby s DPH (Kč)', 'Tržby s DPH min. ob. (Kč)', 'Tržby bez DPH (Kč)', 'Tržby bez DPH min. ob. (Kč)', 'Marže (Kč)', 'Marže min. ob. (Kč)', 'Marže %', 'Marže % (min. ob.)', 'Počet ks', 'Počet ks (min. ob.)', 'Podíl %'];
    const rows = sorted.map(r => {
      const mPct     = r.revenue     > 0 ? ((r.revenue - r.purchaseCost)         / r.revenue     * 100).toFixed(2) : '';
      const prevMPct = r.prevRevenue > 0 ? ((r.prevRevenue - r.prevPurchaseCost) / r.prevRevenue * 100).toFixed(2) : '';
      return [
        `"${r.brand.replace(/"/g, '""')}"`,
        r.revenueVat, r.prevRevenueVat,
        r.revenue, r.prevRevenue,
        r.revenue - r.purchaseCost, r.prevRevenue - r.prevPurchaseCost,
        mPct, prevMPct,
        r.soldQty, r.prevSoldQty,
        r.share.toFixed(2),
      ];
    });
    const content = [header, ...rows].map(row => row.join(',')).join('\n');
    const blob = new Blob(['﻿' + content], { type: 'text/csv;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = `znacky_${startStr}_${endStr}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const hasPrev = data?.hasPrevData ?? false;

  const thCls = 'px-5 py-3 text-[11px] font-semibold text-white uppercase tracking-wider cursor-pointer select-none hover:bg-slate-700 transition-colors whitespace-nowrap';

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 bg-blue-50 rounded-lg">
          <Award size={18} className="text-blue-600" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-800">Analýza značek</h1>
          <p className="text-sm text-slate-500">Tržby dle výrobce / značky · CZK</p>
        </div>
      </div>

      {/* Trend chart */}
      {!loading && data && (
        <TrendChart
          daily={data.daily}
          dailyPrev={data.dailyPrev}
          allBrands={allBrands}
          isMonthly={isMonthly}
          hasPrevData={data.hasPrevData}
          fc={fc}
          startStr={startStr}
          prevStartStr={prevStartStr}
        />
      )}

      {/* Table */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="flex justify-end px-5 py-3 border-b border-slate-100">
          <button
            onClick={exportCsv}
            disabled={!data}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors disabled:opacity-40"
          >
            <Download size={13} />
            Exportovat CSV
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20 text-slate-400 text-sm">Načítám data…</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-blue-900">
                  <th className={`${thCls} text-left`}     onClick={() => toggleSort('brand')}>     Značka<SortIcon col="brand" sort={sort} /></th>
                  <th className={`${thCls} text-right`}    onClick={() => toggleSort('revenueVat')}> Tržby s DPH<SortIcon col="revenueVat" sort={sort} /></th>
                  <th className={`${thCls} text-right`}    onClick={() => toggleSort('revenue')}>   Tržby bez DPH<SortIcon col="revenue" sort={sort} /></th>
                  <th className={`${thCls} text-right`}    onClick={() => toggleSort('margin')}>    Marže (abs.)<SortIcon col="margin" sort={sort} /></th>
                  <th className={`${thCls} text-right`}    onClick={() => toggleSort('marginPct')}> Marže %<SortIcon col="marginPct" sort={sort} /></th>
                  <th className={`${thCls} text-right`}    onClick={() => toggleSort('soldQty')}>   Počet ks<SortIcon col="soldQty" sort={sort} /></th>
                  <th className={`${thCls} text-right min-w-[160px]`} onClick={() => toggleSort('share')}> Podíl (tržby bez DPH)<SortIcon col="share" sort={sort} /></th>
                </tr>
              </thead>
              <tbody>
                {sorted.map(row => (
                  <tr key={row.brand} className="border-t border-slate-50 hover:bg-slate-50/50 transition-colors">
                    <td className="px-5 py-3.5 text-left">
                      <span className="font-semibold text-slate-800">{row.brand}</span>
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <div className="flex flex-col items-end gap-0.5">
                        <span className="font-semibold text-slate-800 tabular-nums">{fc(row.revenueVat)}</span>
                        {hasPrev && <YoyBadge current={row.revenueVat} prev={row.prevRevenueVat} />}
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <div className="flex flex-col items-end gap-0.5">
                        <span className="font-semibold text-slate-800 tabular-nums">{fc(row.revenue)}</span>
                        {hasPrev && <YoyBadge current={row.revenue} prev={row.prevRevenue} />}
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <div className="flex flex-col items-end gap-0.5">
                        <span className="font-semibold text-slate-800 tabular-nums">{fc(row.revenue - row.purchaseCost)}</span>
                        {hasPrev && <YoyBadge current={row.revenue - row.purchaseCost} prev={row.prevRevenue - row.prevPurchaseCost} />}
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <MarginCell
                        revenue={row.revenue} purchaseCost={row.purchaseCost}
                        prevRevenue={row.prevRevenue} prevPurchaseCost={row.prevPurchaseCost}
                        hasPrevData={hasPrev}
                      />
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <div className="flex flex-col items-end gap-0.5">
                        <span className="font-semibold text-slate-800 tabular-nums">{formatNumber(row.soldQty)}</span>
                        {hasPrev && <YoyBadge current={row.soldQty} prev={row.prevSoldQty} />}
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <ShareBar pct={row.share} />
                    </td>
                  </tr>
                ))}
              </tbody>
              {totals && (
                <tfoot>
                  <tr className="border-t-2 border-slate-200 bg-slate-50">
                    <td className="px-5 py-3.5 font-bold text-slate-700 text-left">Celkem</td>
                    <td className="px-5 py-3.5 text-right">
                      <div className="flex flex-col items-end gap-0.5">
                        <span className="font-bold text-slate-800 tabular-nums">{fc(totals.revenueVat)}</span>
                        {hasPrev && <YoyBadge current={totals.revenueVat} prev={totals.prevRevenueVat} />}
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <div className="flex flex-col items-end gap-0.5">
                        <span className="font-bold text-slate-800 tabular-nums">{fc(totals.revenue)}</span>
                        {hasPrev && <YoyBadge current={totals.revenue} prev={totals.prevRevenue} />}
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <div className="flex flex-col items-end gap-0.5">
                        <span className="font-bold text-slate-800 tabular-nums">{fc(totals.revenue - totals.purchaseCost)}</span>
                        {hasPrev && <YoyBadge current={totals.revenue - totals.purchaseCost} prev={totals.prevRevenue - totals.prevPurchaseCost} />}
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <MarginCell
                        revenue={totals.revenue} purchaseCost={totals.purchaseCost}
                        prevRevenue={totals.prevRevenue} prevPurchaseCost={totals.prevPurchaseCost}
                        hasPrevData={hasPrev}
                      />
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <div className="flex flex-col items-end gap-0.5">
                        <span className="font-bold text-slate-800 tabular-nums">{formatNumber(totals.soldQty)}</span>
                        {hasPrev && <YoyBadge current={totals.soldQty} prev={totals.prevSoldQty} />}
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 bg-blue-200 rounded-full min-w-[60px]" />
                        <span className="text-xs font-bold text-slate-600 w-10 text-right">100%</span>
                      </div>
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}

        {!loading && sorted.length === 0 && (
          <div className="text-center py-16 text-slate-400">
            <Award size={32} className="mx-auto mb-3 opacity-30" />
            <p className="text-sm">Žádná data pro vybrané období</p>
          </div>
        )}
      </div>
    </div>
  );
}
