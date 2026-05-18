'use client';

import { useEffect, useState, useMemo } from 'react';
import { useFilters, getDateRange } from '@/hooks/useFilters';
import { formatCurrency, formatNumber, formatPercent, formatDate, localIsoDate } from '@/lib/formatters';
import { C } from '@/lib/chartColors';
import type { StockResponse, StockProduct, StockDailyRow, StockBrandRow } from '@/app/api/stock/route';
import {
  Package, PackageCheck, PackageX, Layers, Warehouse, TrendingUp, Search,
  ChevronUp, ChevronDown, ChevronsUpDown, Truck,
} from 'lucide-react';
import {
  ComposedChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer,
} from 'recharts';

// ── Helpers ───────────────────────────────────────────────────────────────────

const MONTHS_CS = ['Led','Úno','Bře','Dub','Kvě','Čvn','Čvc','Srp','Zář','Říj','Lis','Pro'];

function fmtAxis(v: number) {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000)     return `${Math.round(v / 1_000)}k`;
  return String(Math.round(v));
}

function fmtDate(d: string) {
  const [, m, day] = d.split('-');
  return `${parseInt(day)}.${parseInt(m)}.`;
}

function fmtMonth(d: string) {
  const [y, m] = d.split('-');
  return `${MONTHS_CS[parseInt(m) - 1]} ${y}`;
}

function fmtDays(days: number | null): string {
  if (days === null) return '–';
  if (days === 0) return 'dnes';
  return `${days} dní`;
}

function pctStr(val: number, total: number): string {
  if (!total) return '0 %';
  return `${Math.round((val / total) * 100)} %`;
}

function aggregateMonthly(daily: StockDailyRow[]) {
  const map = new Map<string, { stock: number; supplier: number }>();
  for (const r of daily) {
    const k = r.date.slice(0, 7);
    if (!map.has(k)) map.set(k, { stock: 0, supplier: 0 });
    const cur = map.get(k)!;
    cur.stock    += r.revenueStock;
    cur.supplier += r.revenueSupplier;
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => ({
    label:           fmtMonth(k + '-01'),
    revenueStock:    Math.round(v.stock),
    revenueSupplier: Math.round(v.supplier),
    total:           Math.round(v.stock + v.supplier),
  }));
}

// ── Status badge config ───────────────────────────────────────────────────────

const STATUS_CFG = {
  skladem:   { label: 'SKLADEM',   cls: 'bg-emerald-100 text-emerald-700' },
  malo:      { label: 'MÁLO',      cls: 'bg-amber-100 text-amber-700' },
  dodavatel: { label: 'DODAVATEL', cls: 'bg-blue-100 text-blue-700' },
  vyprodano: { label: 'VYPRODÁNO', cls: 'bg-rose-100 text-rose-600' },
} as const;

// ── Simple KPI card ───────────────────────────────────────────────────────────

interface SimpleKpiProps {
  title: string;
  value: string;
  icon: React.ReactNode;
  color?: 'blue' | 'green' | 'red' | 'teal';
  subtitle?: string;
  pct?: string;
}

const COLOR_MAP = {
  blue:  { border: 'border-blue-800',    icon: 'bg-blue-50 text-blue-600',       text: 'text-slate-800' },
  green: { border: 'border-emerald-700', icon: 'bg-emerald-50 text-emerald-700', text: 'text-emerald-700' },
  red:   { border: 'border-rose-600',    icon: 'bg-rose-50 text-rose-600',       text: 'text-rose-600' },
  teal:  { border: 'border-teal-600',    icon: 'bg-teal-50 text-teal-600',       text: 'text-teal-700' },
};

function SimpleKpi({ title, value, icon, color = 'blue', subtitle, pct }: SimpleKpiProps) {
  const c = COLOR_MAP[color];
  return (
    <div className={`bg-white rounded-2xl p-4 border-2 ${c.border} shadow-sm flex flex-col gap-3`}>
      <div className="flex items-center gap-2">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${c.icon}`}>{icon}</div>
        <p className="text-[11px] font-bold text-slate-600 uppercase tracking-wider leading-snug">{title}</p>
      </div>
      <p className={`text-2xl md:text-3xl font-bold leading-none ${c.text}`}>{value}</p>
      <div className="flex items-center justify-between">
        {subtitle && <p className="text-[11px] text-slate-400">{subtitle}</p>}
        {pct && <p className="text-xl font-bold text-slate-800">{pct} <span className="text-sm font-normal text-slate-500">z tržeb</span></p>}
      </div>
    </div>
  );
}

// ── Sort header ───────────────────────────────────────────────────────────────

type SortDir = 'asc' | 'desc';
type SortCol = 'name' | 'stock' | 'stockValue' | 'avgDailySales' | 'daysUntilEmpty' | 'status';
type BrandSortCol = 'brand' | 'stockQty' | 'stockValue' | 'avgDailySales';

interface SortState { col: SortCol; dir: SortDir }
interface BrandSortState { col: BrandSortCol; dir: SortDir }

function SortIcon({ col, sort }: { col: SortCol; sort: SortState }) {
  if (sort.col !== col) return <ChevronsUpDown size={12} className="text-slate-400 inline ml-1" />;
  return sort.dir === 'asc'
    ? <ChevronUp   size={12} className="text-white inline ml-1" />
    : <ChevronDown size={12} className="text-white inline ml-1" />;
}

function BrandSortIcon({ col, sort }: { col: BrandSortCol; sort: BrandSortState }) {
  if (sort.col !== col) return <ChevronsUpDown size={12} className="text-slate-400 inline ml-1" />;
  return sort.dir === 'asc'
    ? <ChevronUp   size={12} className="text-white inline ml-1" />
    : <ChevronDown size={12} className="text-white inline ml-1" />;
}

function ThSort({ col, label, sort, onSort, align = 'right' }: {
  col: SortCol; label: string; sort: SortState; onSort: (c: SortCol) => void; align?: 'left' | 'right' | 'center';
}) {
  return (
    <th
      className={`px-4 py-3 text-${align} font-medium cursor-pointer select-none hover:bg-slate-700 transition-colors`}
      onClick={() => onSort(col)}
    >
      {label}<SortIcon col={col} sort={sort} />
    </th>
  );
}

function ThBrandSort({ col, label, sort, onSort, align = 'right' }: {
  col: BrandSortCol; label: string; sort: BrandSortState; onSort: (c: BrandSortCol) => void; align?: 'left' | 'right' | 'center';
}) {
  return (
    <th
      className={`px-4 py-3 text-${align} font-medium cursor-pointer select-none hover:bg-slate-700 transition-colors`}
      onClick={() => onSort(col)}
    >
      {label}<BrandSortIcon col={col} sort={sort} />
    </th>
  );
}

// ── Margin badge ──────────────────────────────────────────────────────────────

function MarginBadge({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-slate-300">–</span>;
  const cls = pct >= 30 ? 'text-emerald-600' : pct >= 15 ? 'text-amber-600' : 'text-rose-500';
  return <span className={`font-semibold tabular-nums ${cls}`}>{pct.toFixed(1)} %</span>;
}

// ── Custom Tooltip ────────────────────────────────────────────────────────────

function ChartTooltip({ active, payload, label, total }: any) {
  if (!active || !payload?.length) return null;
  const stock    = payload.find((p: any) => p.dataKey === 'revenueStock')?.value    ?? 0;
  const supplier = payload.find((p: any) => p.dataKey === 'revenueSupplier')?.value ?? 0;
  const rowTotal = stock + supplier;
  const fc = (v: number) => formatCurrency(v, 'CZK');
  const pct = (v: number) => rowTotal > 0 ? ` (${Math.round((v / rowTotal) * 100)} %)` : '';
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-md p-3 text-xs space-y-1 min-w-[200px]">
      <p className="font-semibold text-slate-700 mb-1">{label}</p>
      <div className="flex justify-between gap-4">
        <span className="text-emerald-600">Skladové</span>
        <span className="font-medium">{fc(stock)}<span className="text-slate-400">{pct(stock)}</span></span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-blue-600">U dodavatele</span>
        <span className="font-medium">{fc(supplier)}<span className="text-slate-400">{pct(supplier)}</span></span>
      </div>
      <div className="border-t border-slate-100 pt-1 flex justify-between gap-4">
        <span className="text-slate-500">Celkem</span>
        <span className="font-semibold">{fc(rowTotal)}</span>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

const PAGE_SIZE = 20;

function sortProducts(products: StockProduct[], sort: SortState): StockProduct[] {
  return [...products].sort((a, b) => {
    let cmp = 0;
    switch (sort.col) {
      case 'name':          cmp = a.name.localeCompare(b.name, 'cs'); break;
      case 'stock':         cmp = a.stock - b.stock; break;
      case 'stockValue':    cmp = a.stockValue - b.stockValue; break;
      case 'avgDailySales': cmp = a.avgDailySales - b.avgDailySales; break;
      case 'daysUntilEmpty':cmp = (a.daysUntilEmpty ?? 99999) - (b.daysUntilEmpty ?? 99999); break;
      case 'status': {
        const order = { skladem: 0, malo: 1, dodavatel: 2, vyprodano: 3 };
        cmp = order[a.status] - order[b.status];
        break;
      }
    }
    return sort.dir === 'asc' ? cmp : -cmp;
  });
}

export default function StockPage() {
  const { filters } = useFilters();
  const [data, setData]           = useState<StockResponse | null>(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [search, setSearch]       = useState('');
  const [tablePage, setTablePage] = useState(0);
  const [sort, setSort]           = useState<SortState>({ col: 'name', dir: 'asc' });
  const [brandSort, setBrandSort] = useState<BrandSortState>({ col: 'stockQty', dir: 'desc' });

  useEffect(() => {
    setLoading(true);
    setError(null);
    const { start, end } = getDateRange(filters);
    fetch(`/api/stock?from=${localIsoDate(start)}&to=${localIsoDate(end)}`)
      .then(r => r.json())
      .then((json: StockResponse & { error?: string }) => {
        if (json.error) { setError(json.error); setData(null); }
        else setData(json);
      })
      .catch(() => setError('Nepodařilo se načíst data'))
      .finally(() => setLoading(false));
    setTablePage(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.timePeriod, filters.customStart, filters.customEnd]);

  const { start, end } = getDateRange(filters);
  const dayCount  = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  const isMonthly = dayCount > 60;

  const chartData = useMemo(() => {
    if (!data) return [];
    if (isMonthly) return aggregateMonthly(data.daily);
    return data.daily.map(r => ({
      label:           fmtDate(r.date),
      revenueStock:    r.revenueStock,
      revenueSupplier: r.revenueSupplier,
      total:           r.revenueStock + r.revenueSupplier,
    }));
  }, [data, isMonthly]);



  const filteredProducts = useMemo(() => {
    if (!data) return [];
    const q = search.toLowerCase().trim();
    const base = q
      ? data.products.filter(p => p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q))
      : data.products;
    return sortProducts(base, sort);
  }, [data, search, sort]);

  const pageProducts = filteredProducts.slice(tablePage * PAGE_SIZE, (tablePage + 1) * PAGE_SIZE);
  const totalPages   = Math.ceil(filteredProducts.length / PAGE_SIZE);

  const kpi      = data?.kpi;
  const subtitle = `${formatDate(start)} – ${formatDate(end)}`;
  const fc       = (v: number) => formatCurrency(v, 'CZK');

  const progressData = useMemo(() => {
    if (!data) return { dostatecne: 0, nizke: 0, dodavatel: 0, vyprodano: 0, total: 1 };
    const { countSkladem: dostatecne, countMalo: nizke, countDodavatel: dodavatel, countVyprodano: vyprodano, totalProducts: total } = data.kpi;
    return { dostatecne, nizke, dodavatel, vyprodano, total: total || 1 };
  }, [data]);

  const pct = (n: number) => `${Math.round((n / progressData.total) * 100)}%`;

  function handleSort(col: SortCol) {
    setSort(prev => ({ col, dir: prev.col === col && prev.dir === 'asc' ? 'desc' : 'asc' }));
    setTablePage(0);
  }

  function handleBrandSort(col: BrandSortCol) {
    setBrandSort(prev => ({ col, dir: prev.col === col && prev.dir === 'asc' ? 'desc' : 'asc' }));
  }

  const sortedBrands = useMemo((): StockBrandRow[] => {
    if (!data?.brands) return [];
    return [...data.brands].sort((a, b) => {
      let cmp = 0;
      switch (brandSort.col) {
        case 'brand':        cmp = a.brand.localeCompare(b.brand, 'cs'); break;
        case 'stockQty':     cmp = a.stockQty - b.stockQty; break;
        case 'stockValue':   cmp = a.stockValue - b.stockValue; break;
        case 'avgDailySales':cmp = a.avgDailySales - b.avgDailySales; break;
      }
      return brandSort.dir === 'asc' ? cmp : -cmp;
    });
  }, [data?.brands, brandSort]);

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Stav skladu</h1>
        <p className="text-sm text-slate-500 mt-0.5">Aktuální stav zásob z Upgates</p>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-24 text-slate-400 text-sm">
          Načítání dat ze skladu…
        </div>
      )}

      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-xl p-4 text-sm">
          Chyba: {error}
        </div>
      )}

      {!loading && !error && data && (
        <>
          {/* KPI row 1 — stock status */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <SimpleKpi title="Hodnota zboží" value={fc(kpi!.totalStockValue)} icon={<Warehouse size={18} />} color="green" subtitle="nákupní cena bez DPH" />
            <SimpleKpi title="Celkem variant" value={formatNumber(kpi!.totalProducts)} icon={<Package size={18} />} color="blue" subtitle="aktivních položek" />
            <SimpleKpi title="Skladem" value={formatNumber(kpi!.inStock)} icon={<PackageCheck size={18} />} color="green" subtitle="dostupných variant" />
            <SimpleKpi title="Skladem u dodavatele" value={formatNumber(kpi!.supplierCount)} icon={<Truck size={18} />} color="blue" subtitle="dostupnost 2–3 dny" />
            <SimpleKpi title="Vyprodáno" value={formatNumber(kpi!.outOfStock)} icon={<PackageX size={18} />} color="red" subtitle="není skladem" />
            <SimpleKpi title="Celkem kusů" value={formatNumber(kpi!.totalUnits)} icon={<Layers size={18} />} color="blue" subtitle="ve skladu celkem" />
          </div>

          {/* Progress bar */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-3">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>Dostupnost skladu</span>
              <span>
                <span className="text-emerald-600 font-medium">{progressData.dostatecne + progressData.nizke} skladem</span>
                {progressData.dodavatel > 0 && <span className="text-blue-600 font-medium"> · {progressData.dodavatel} u dodavatele</span>}
                <span className="text-rose-500 font-medium"> · {progressData.vyprodano} vyprodáno</span>
                {' · '}<span className="font-medium">{Math.round(((progressData.dostatecne + progressData.nizke + progressData.dodavatel) / progressData.total) * 100)} % dostupných</span>
              </span>
            </div>
            <div className="flex h-3 rounded-full overflow-hidden gap-px">
              {progressData.dostatecne > 0 && <div className="bg-emerald-500" style={{ width: pct(progressData.dostatecne) }} />}
              {progressData.nizke > 0      && <div className="bg-amber-400"   style={{ width: pct(progressData.nizke) }} />}
              {progressData.dodavatel > 0  && <div className="bg-blue-400"    style={{ width: pct(progressData.dodavatel) }} />}
              {progressData.vyprodano > 0  && <div className="bg-rose-400"    style={{ width: pct(progressData.vyprodano) }} />}
            </div>
            <div className="flex flex-wrap gap-4 text-xs text-slate-500">
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-emerald-500 inline-block" />Dostatečné (&gt;10 ks)</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-amber-400 inline-block" />Nízké (1–10 ks)</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-blue-400 inline-block" />U dodavatele</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-rose-400 inline-block" />Vyprodáno</span>
            </div>
          </div>

          {/* KPI row 2 — sales in period */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <SimpleKpi
              title="Prodeje — skladové položky"
              value={fc(kpi!.revenueStock)}
              icon={<Warehouse size={18} />}
              color="teal"
              pct={pctStr(kpi!.revenueStock, kpi!.revenueTotal)}
            />
            <SimpleKpi
              title="Prodeje — položky u dodavatele"
              value={fc(kpi!.revenueSupplier)}
              icon={<TrendingUp size={18} />}
              color="blue"
              pct={pctStr(kpi!.revenueSupplier, kpi!.revenueTotal)}
            />
          </div>

          {/* Chart */}
          {chartData.length > 0 && (
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
              <h2 className="text-sm font-semibold text-slate-700 mb-4">
                Prodeje v průběhu času — skladové vs. u dodavatele (tržby bez DPH)
              </h2>
              <ResponsiveContainer width="100%" height={280}>
                <ComposedChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} interval={isMonthly ? 0 : 'preserveStartEnd'} />
                  <YAxis tickFormatter={fmtAxis} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={52} />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
                  <Bar dataKey="revenueStock"    name="Skladové položky"     fill={C.margin}  radius={[3, 3, 0, 0]} barSize={isMonthly ? 28 : 8} />
                  <Bar dataKey="revenueSupplier" name="Položky u dodavatele" fill={C.primary} radius={[3, 3, 0, 0]} barSize={isMonthly ? 28 : 8} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Product table */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <h2 className="text-sm font-semibold text-slate-700">Přehled produktů</h2>
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Hledat..."
                  value={search}
                  onChange={e => { setSearch(e.target.value); setTablePage(0); }}
                  className="pl-8 pr-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 w-48"
                />
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-blue-900 text-white text-[11px] uppercase tracking-wider">
                    <th className="px-4 py-3 text-left font-medium text-slate-300 w-20">Kód</th>
                    <ThSort col="name"          label="Název"            sort={sort} onSort={handleSort} align="left" />
                    <ThSort col="stock"          label="Sklad (ks)"       sort={sort} onSort={handleSort} />
                    <ThSort col="stockValue"    label="Hodnota zboží"    sort={sort} onSort={handleSort} />
                    <ThSort col="avgDailySales" label="Obrátka/den"      sort={sort} onSort={handleSort} />
                    <ThSort col="daysUntilEmpty" label="Dojde za"        sort={sort} onSort={handleSort} />
                    <ThSort col="status"        label="Stav"             sort={sort} onSort={handleSort} align="center" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {pageProducts.map(p => {
                    const cfg = STATUS_CFG[p.status];
                    const stockColor =
                      p.stock > 10 ? 'text-emerald-600 font-semibold' :
                      p.stock > 0  ? 'text-amber-600 font-semibold' :
                                     'text-rose-500 font-semibold';
                    const daysColor =
                      p.daysUntilEmpty === null ? 'text-slate-400' :
                      p.daysUntilEmpty === 0    ? 'text-rose-500 font-semibold' :
                      p.daysUntilEmpty <= 14    ? 'text-amber-600 font-semibold' :
                                                  'text-slate-600';
                    return (
                      <tr key={p.code} className="hover:bg-slate-50 transition-colors">
                        <td className="px-4 py-2.5 text-slate-400 text-xs font-mono">{p.code}</td>
                        <td className="px-4 py-2.5 text-slate-700">{p.name}</td>
                        <td className={`px-4 py-2.5 text-right tabular-nums ${stockColor}`}>{p.stock}</td>
                        <td className="px-4 py-2.5 text-right text-slate-600 tabular-nums">
                          {p.stockValue > 0 ? fc(p.stockValue) : '–'}
                        </td>
                        <td className="px-4 py-2.5 text-right text-slate-500 tabular-nums">
                          {p.avgDailySales > 0 ? `${p.avgDailySales} ks` : '–'}
                        </td>
                        <td className={`px-4 py-2.5 text-right tabular-nums ${daysColor}`}>
                          {fmtDays(p.daysUntilEmpty)}
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          <span className={`inline-block text-[11px] font-bold px-2 py-0.5 rounded-full ${cfg.cls}`}>
                            {cfg.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                  {pageProducts.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-slate-400 text-sm">
                        Žádné produkty nenalezeny
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between px-5 py-3 border-t border-slate-100 text-sm text-slate-500">
                <span>{filteredProducts.length} produktů</span>
                <div className="flex items-center gap-2">
                  <button onClick={() => setTablePage(p => Math.max(0, p - 1))} disabled={tablePage === 0} className="px-3 py-1 rounded-lg border border-slate-200 disabled:opacity-40 hover:bg-slate-50">‹</button>
                  <span>{tablePage + 1} / {totalPages}</span>
                  <button onClick={() => setTablePage(p => Math.min(totalPages - 1, p + 1))} disabled={tablePage === totalPages - 1} className="px-3 py-1 rounded-lg border border-slate-200 disabled:opacity-40 hover:bg-slate-50">›</button>
                </div>
              </div>
            )}
          </div>

          {/* Brand table */}
          {sortedBrands.length > 0 && (
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100">
                <h2 className="text-sm font-semibold text-slate-700">Produkty podle výrobce</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-blue-900 text-white text-[11px] uppercase tracking-wider">
                      <ThBrandSort col="brand"         label="Výrobce"         sort={brandSort} onSort={handleBrandSort} align="left" />
                      <ThBrandSort col="stockQty"      label="Sklad (ks)"      sort={brandSort} onSort={handleBrandSort} />
                      <ThBrandSort col="stockValue"    label="Hodnota zboží"   sort={brandSort} onSort={handleBrandSort} />
                      <ThBrandSort col="avgDailySales" label="Obrátka/den"     sort={brandSort} onSort={handleBrandSort} />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {sortedBrands.map(b => (
                      <tr key={b.brand} className="hover:bg-slate-50 transition-colors">
                        <td className="px-4 py-2.5 text-slate-700 font-medium">{b.brand}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-slate-700">{formatNumber(b.stockQty)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{b.stockValue > 0 ? fc(b.stockValue) : '–'}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-slate-500">
                          {b.avgDailySales > 0 ? `${b.avgDailySales} ks` : '–'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
