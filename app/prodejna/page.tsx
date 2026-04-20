'use client';

import { useMemo, useState } from 'react';
import { useFilters, getDateRange } from '@/hooks/useFilters';
import { prodejnaDataCZ } from '@/data/prodejnaDataCZ';
import { prodejnaMarginDataCZ } from '@/data/prodejnaMarginDataCZ';
import KpiCard from '@/components/kpi/KpiCard';
import { formatCurrency, formatPercent, formatNumber, formatDate, formatShortDate, localIsoDate } from '@/lib/formatters';
import { Wallet, Banknote, ShoppingCart, BarChart2, TrendingUp, Percent, Store, ChevronLeft, ChevronRight } from 'lucide-react';
import { C } from '@/lib/chartColors';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer, LineChart,
} from 'recharts';

const PAGE_SIZE = 20;

const MONTHS_CS = ['Led', 'Úno', 'Bře', 'Dub', 'Kvě', 'Čvn', 'Čvc', 'Srp', 'Zář', 'Říj', 'Lis', 'Pro'];
function fmtShortDate(d: string) {
  const parts = d.split('-');
  return `${parseInt(parts[2])}.${parseInt(parts[1])}.`;
}
function fmtMonthYear(d: string) {
  const [y, m] = d.split('-');
  return `${MONTHS_CS[parseInt(m) - 1]} ${y}`;
}
function fmtAxis(v: number) {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000)     return `${Math.round(v / 1_000)}k`;
  return String(Math.round(v));
}

export default function ProdejnaPage() {
  const { filters } = useFilters();
  const { start, end, prevStart, prevEnd } = getDateRange(filters);
  const [tablePage, setTablePage] = useState(0);

  const s  = localIsoDate(start);
  const e  = localIsoDate(end);
  const ps = localIsoDate(prevStart);
  const pe = localIsoDate(prevEnd);

  const dayCount  = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  const isMonthly = dayCount > 60;

  const subtitle = `${formatDate(start)} – ${formatDate(end)}`;
  const fc = (v: number) => formatCurrency(v, 'CZK');

  // ── Aggregate KPIs ──────────────────────────────────────────────────────────
  const totals = useMemo(() => {
    let orders = 0, revVat = 0, rev = 0;
    let prevOrders = 0, prevRevVat = 0, prevRev = 0;
    let pc = 0, mr = 0, prevPc = 0, prevMr = 0;
    for (const r of prodejnaDataCZ) {
      if (r.date >= s && r.date <= e)  { orders += r.orders; revVat += r.revenue_vat; rev += r.revenue; }
      if (r.date >= ps && r.date <= pe){ prevOrders += r.orders; prevRevVat += r.revenue_vat; prevRev += r.revenue; }
    }
    for (const r of prodejnaMarginDataCZ) {
      if (r.date >= s && r.date <= e)  { pc += r.purchaseCost; mr += r.revenue; }
      if (r.date >= ps && r.date <= pe){ prevPc += r.purchaseCost; prevMr += r.revenue; }
    }
    return { orders, revVat, rev, prevOrders, prevRevVat, prevRev, pc, mr, prevPc, prevMr };
  }, [s, e, ps, pe]);

  const hasPrevData = totals.prevOrders > 0;

  const aov          = totals.orders > 0 ? totals.rev / totals.orders : 0;
  const prevAov      = totals.prevOrders > 0 ? totals.prevRev / totals.prevOrders : 0;
  const margin       = totals.mr - totals.pc;
  const marginPct    = totals.mr > 0 ? (margin / totals.mr) * 100 : 0;
  const prevMargin   = totals.prevMr - totals.prevPc;
  const prevMarginPct = totals.prevMr > 0 ? (prevMargin / totals.prevMr) * 100 : 0;
  const gross        = margin;
  const grossPct     = totals.mr > 0 ? (gross / totals.mr) * 100 : 0;
  const prevGross    = prevMargin;
  const prevGrossPct = totals.prevMr > 0 ? (prevGross / totals.prevMr) * 100 : 0;
  const grossPerOrder    = totals.orders > 0 ? gross / totals.orders : 0;
  const prevGrossPerOrder = totals.prevOrders > 0 ? prevGross / totals.prevOrders : 0;

  function yoy(curr: number, prev: number) {
    return hasPrevData && prev !== 0 ? ((curr - prev) / Math.abs(prev)) * 100 : null;
  }

  // ── Chart data — daily merged ───────────────────────────────────────────────
  const chartData = useMemo(() => {
    const marginByDate: Record<string, number> = {};
    const pcByDate: Record<string, number>     = {};
    for (const r of prodejnaMarginDataCZ) {
      if (r.date >= s && r.date <= e) {
        marginByDate[r.date] = (marginByDate[r.date] || 0) + r.revenue;
        pcByDate[r.date]     = (pcByDate[r.date] || 0)     + r.purchaseCost;
      }
    }
    return prodejnaDataCZ
      .filter(r => r.date >= s && r.date <= e)
      .map(r => {
        const mr  = marginByDate[r.date] || 0;
        const pc  = pcByDate[r.date]     || 0;
        const gp  = mr - pc;
        const aovDay = r.orders > 0 ? r.revenue / r.orders : 0;
        return {
          date:       r.date,
          label:      isMonthly ? fmtMonthYear(r.date) : fmtShortDate(r.date),
          revVat:     r.revenue_vat,
          rev:        r.revenue,
          orders:     r.orders,
          aov:        Math.round(aovDay),
          grossProfit: gp,
        };
      });
  }, [s, e, isMonthly]);

  // ── Daily table ─────────────────────────────────────────────────────────────
  const tableRows = useMemo(() => {
    const marginByDate: Record<string, number> = {};
    const pcByDate: Record<string, number>     = {};
    for (const r of prodejnaMarginDataCZ) {
      if (r.date >= s && r.date <= e) {
        marginByDate[r.date] = (marginByDate[r.date] || 0) + r.revenue;
        pcByDate[r.date]     = (pcByDate[r.date] || 0)     + r.purchaseCost;
      }
    }
    return prodejnaDataCZ
      .filter(r => r.date >= s && r.date <= e && r.orders > 0)
      .map(r => {
        const mr = marginByDate[r.date] || 0;
        const pc = pcByDate[r.date]     || 0;
        const gp = mr - pc;
        return {
          date:        r.date,
          orders:      r.orders,
          revVat:      r.revenue_vat,
          rev:         r.revenue,
          aov:         r.orders > 0 ? r.revenue / r.orders : 0,
          purchaseCost: pc,
          grossProfit: gp,
          grossPct:    mr > 0 ? (gp / mr) * 100 : 0,
        };
      })
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [s, e]);

  const totalPages = Math.ceil(tableRows.length / PAGE_SIZE);
  const pageRows   = tableRows.slice(tablePage * PAGE_SIZE, (tablePage + 1) * PAGE_SIZE);

  const noData = totals.orders === 0;

  // ── Tooltip ─────────────────────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function RevenueTooltip({ active, payload, label }: any) {
    if (!active || !payload?.length) return null;
    return (
      <div className="bg-white border border-slate-200 rounded-xl shadow-lg p-3 text-xs min-w-[180px]">
        <p className="font-semibold text-slate-600 mb-2 pb-1.5 border-b border-slate-100">{label}</p>
        {payload.map((p: any) => (
          <div key={p.dataKey} className="flex items-center justify-between gap-4 py-0.5">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: p.fill || p.stroke }} />
              <span className="text-slate-500">{p.name}</span>
            </div>
            <span className="font-semibold text-slate-700">
              {p.dataKey === 'orders' ? formatNumber(p.value) : fc(p.value)}
            </span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2">
          <Store size={20} className="text-slate-600" />
          <h1 className="text-xl font-bold text-slate-900">Prodejna</h1>
        </div>
        <p className="text-sm text-slate-500 mt-0.5">{subtitle} · objednávky Obchod – Vydáno + Obchod – Objednávka</p>
      </div>

      {noData && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 text-sm text-amber-700">
          Žádné prodejní objednávky za vybrané období.
        </div>
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4">
        <KpiCard title="Tržby s DPH"        value={fc(totals.revVat)}                    yoy={yoy(totals.revVat, totals.prevRevVat)}     icon={<Wallet size={16} />}       hasPrevData={hasPrevData} />
        <KpiCard title="Tržby bez DPH"      value={fc(totals.rev)}                       yoy={yoy(totals.rev, totals.prevRev)}           icon={<Banknote size={16} />}     hasPrevData={hasPrevData} />
        <KpiCard title="Počet objednávek"   value={formatNumber(totals.orders)}          yoy={yoy(totals.orders, totals.prevOrders)}     icon={<ShoppingCart size={16} />} hasPrevData={hasPrevData} />
        <KpiCard title="AOV"                value={fc(aov)}                              yoy={yoy(aov, prevAov)}                         icon={<BarChart2 size={16} />}    hasPrevData={hasPrevData} />
        <KpiCard title="Marže"              value={fc(margin)}                           yoy={yoy(margin, prevMargin)}                   icon={<Banknote size={16} />}     hasPrevData={hasPrevData} />
        <KpiCard title="Marže %"            value={formatPercent(marginPct)}             yoy={yoy(marginPct, prevMarginPct)}             icon={<Percent size={16} />}      hasPrevData={hasPrevData} />
        <KpiCard title="Hrubý zisk na obj." value={totals.orders > 0 ? fc(grossPerOrder) : '–'} yoy={yoy(grossPerOrder, prevGrossPerOrder)} icon={<Banknote size={16} />} hasPrevData={hasPrevData} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
        <KpiCard title="Hrubý zisk"   value={fc(gross)}               yoy={yoy(gross, prevGross)}       icon={<TrendingUp size={16} />} variant="green" hasPrevData={hasPrevData} />
        <KpiCard title="Hrubý zisk %" value={formatPercent(grossPct)} yoy={yoy(grossPct, prevGrossPct)} icon={<BarChart2 size={16} />}  variant="green" hasPrevData={hasPrevData} />
      </div>

      {/* Tržby + objednávky chart */}
      {chartData.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
          <h2 className="text-sm font-semibold text-slate-700 mb-1">Tržby a objednávky</h2>
          <p className="text-xs text-slate-400 mb-4">Denní přehled tržeb bez DPH a počtu objednávek</p>
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={chartData} margin={{ top: 5, right: 16, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9ca3af' }} interval="preserveStartEnd" axisLine={false} tickLine={false} />
              <YAxis yAxisId="rev" tickFormatter={fmtAxis} tick={{ fontSize: 11, fill: '#9ca3af' }} width={52} axisLine={false} tickLine={false} />
              <YAxis yAxisId="ord" orientation="right" tick={{ fontSize: 11, fill: '#9ca3af' }} width={32} axisLine={false} tickLine={false} />
              <Tooltip content={<RevenueTooltip />} cursor={{ fill: '#f8fafc' }} />
              <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
              <Bar yAxisId="rev" dataKey="rev" name="Tržby bez DPH" fill={C.primary} radius={[3, 3, 0, 0]} barSize={isMonthly ? 28 : 8} />
              <Line yAxisId="ord" type="monotone" dataKey="orders" name="Objednávky" stroke={C.secondary} strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* AOV + Hrubý zisk charts */}
      {chartData.length > 0 && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {/* AOV */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
            <h2 className="text-sm font-semibold text-slate-700 mb-1">Průměrná hodnota objednávky (AOV)</h2>
            <p className="text-xs text-slate-400 mb-4">Tržby bez DPH / počet objednávek</p>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={chartData} margin={{ top: 5, right: 16, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9ca3af' }} interval="preserveStartEnd" axisLine={false} tickLine={false} />
                <YAxis tickFormatter={fmtAxis} tick={{ fontSize: 11, fill: '#9ca3af' }} width={52} axisLine={false} tickLine={false} />
                <Tooltip
                  formatter={(v: unknown) => [fc(Number(v)), 'AOV']}
                  labelFormatter={(l) => String(l)}
                  contentStyle={{ fontSize: 12, borderRadius: 8 }}
                />
                <Line type="monotone" dataKey="aov" name="AOV" stroke={C.aov} strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Hrubý zisk */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
            <h2 className="text-sm font-semibold text-slate-700 mb-1">Hrubý zisk</h2>
            <p className="text-xs text-slate-400 mb-4">Tržby bez DPH minus nákupní ceny</p>
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={chartData} margin={{ top: 5, right: 16, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9ca3af' }} interval="preserveStartEnd" axisLine={false} tickLine={false} />
                <YAxis tickFormatter={fmtAxis} tick={{ fontSize: 11, fill: '#9ca3af' }} width={52} axisLine={false} tickLine={false} />
                <Tooltip
                  formatter={(v: unknown) => [fc(Number(v)), 'Hrubý zisk']}
                  labelFormatter={(l) => String(l)}
                  contentStyle={{ fontSize: 12, borderRadius: 8 }}
                />
                <Bar dataKey="grossProfit" name="Hrubý zisk" fill={C.margin} radius={[3, 3, 0, 0]} barSize={isMonthly ? 28 : 8} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Daily table */}
      {tableRows.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="text-sm font-semibold text-slate-700">Denní přehled</h2>
            <p className="text-xs text-slate-400 mt-0.5">Pouze dny s alespoň 1 prodejna objednávkou</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-blue-900 text-white">
                  <th className="px-4 py-2.5 text-left   text-[11px] font-semibold uppercase tracking-wider">Datum</th>
                  <th className="px-4 py-2.5 text-right  text-[11px] font-semibold uppercase tracking-wider">Obj.</th>
                  <th className="px-4 py-2.5 text-right  text-[11px] font-semibold uppercase tracking-wider">Tržby s DPH</th>
                  <th className="px-4 py-2.5 text-right  text-[11px] font-semibold uppercase tracking-wider">Tržby bez DPH</th>
                  <th className="px-4 py-2.5 text-right  text-[11px] font-semibold uppercase tracking-wider">AOV</th>
                  <th className="px-4 py-2.5 text-right  text-[11px] font-semibold uppercase tracking-wider">Hrubý zisk</th>
                  <th className="px-4 py-2.5 text-right  text-[11px] font-semibold uppercase tracking-wider">Marže %</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r, i) => (
                  <tr key={r.date} className={`border-b border-slate-50 hover:bg-slate-50 ${i % 2 === 0 ? 'bg-white' : 'bg-slate-50/30'}`}>
                    <td className="px-4 py-2.5 text-slate-700 font-medium">{formatShortDate(r.date)} {r.date.substring(0, 4)}</td>
                    <td className="px-4 py-2.5 text-right text-slate-600">{formatNumber(r.orders)}</td>
                    <td className="px-4 py-2.5 text-right text-slate-600">{fc(r.revVat)}</td>
                    <td className="px-4 py-2.5 text-right font-semibold text-slate-800">{fc(r.rev)}</td>
                    <td className="px-4 py-2.5 text-right text-slate-500">{fc(r.aov)}</td>
                    <td className={`px-4 py-2.5 text-right font-semibold ${r.grossProfit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{fc(r.grossProfit)}</td>
                    <td className="px-4 py-2.5 text-right text-slate-500">{formatPercent(r.grossPct, 1)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-blue-50 border-t-2 border-blue-100 font-semibold">
                  <td className="px-4 py-3 text-blue-600 text-xs">Celkem</td>
                  <td className="px-4 py-3 text-right text-xs text-slate-600">{formatNumber(totals.orders)}</td>
                  <td className="px-4 py-3 text-right text-slate-700">{fc(totals.revVat)}</td>
                  <td className="px-4 py-3 text-right text-slate-700">{fc(totals.rev)}</td>
                  <td className="px-4 py-3 text-right text-slate-500">{fc(aov)}</td>
                  <td className={`px-4 py-3 text-right font-bold ${gross >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{fc(gross)}</td>
                  <td className="px-4 py-3 text-right text-slate-500">{formatPercent(grossPct, 1)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
              <span>Strana {tablePage + 1} / {totalPages}</span>
              <div className="flex gap-1">
                <button onClick={() => setTablePage(p => Math.max(0, p - 1))} disabled={tablePage === 0}
                  className="p-1.5 rounded-lg border border-slate-200 disabled:opacity-30 hover:bg-slate-50">
                  <ChevronLeft size={14} />
                </button>
                <button onClick={() => setTablePage(p => Math.min(totalPages - 1, p + 1))} disabled={tablePage === totalPages - 1}
                  className="p-1.5 rounded-lg border border-slate-200 disabled:opacity-30 hover:bg-slate-50">
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
