'use client';

import { useMemo, useState } from 'react';
import { BookOpen, Search, Info, AlertTriangle, Target, Calculator, MapPin } from 'lucide-react';
import { formatCurrency, formatPercent, formatNumber, formatDate } from '@/lib/formatters';
import {
  METRICS, CATEGORY_LABELS, SEGMENT_DESCRIPTION, SEGMENT_LABEL, VALUE_LABEL, VALUE_SCOPE,
  type MetricCategory, type MetricDefinition, type ValueFormat, type Benchmark,
} from '@/lib/metricsGlossary';
import { useCurrentValues } from '@/lib/glossaryValues';

const CATEGORY_ORDER = Object.keys(CATEGORY_LABELS) as MetricCategory[];

function formatValue(v: number, format: ValueFormat): string {
  switch (format) {
    case 'currency': return formatCurrency(v, 'CZK');
    case 'percent':  return formatPercent(v);
    case 'number':   return formatNumber(Math.round(v));
    case 'ratio':    return `${v.toFixed(2).replace('.', ',')}×`;
    case 'days':     return `${Math.round(v)} dní`;
  }
}

type Verdict = 'good' | 'watch' | null;

function evaluate(b: Benchmark | undefined, v: number): Verdict {
  if (!b?.better) return null;
  const { min, max, better } = b;
  if (better === 'higher') return min !== undefined && v < min ? 'watch' : 'good';
  if (better === 'lower')  return max !== undefined && v > max ? 'watch' : 'good';
  if (min !== undefined && v < min) return 'watch';
  if (max !== undefined && v > max) return 'watch';
  return 'good';
}

// ─── Karta metriky ───────────────────────────────────────────────────────────

function MetricCard({ metric, value }: { metric: MetricDefinition; value: number | null | undefined }) {
  const hasValue = metric.current && value !== null && value !== undefined && Number.isFinite(value);
  const verdict = hasValue ? evaluate(metric.benchmark, value as number) : null;

  return (
    <article id={metric.id} className="bg-white rounded-2xl border-2 border-blue-800 shadow-sm flex flex-col overflow-hidden scroll-mt-24">
      <header className="px-5 pt-4 pb-3 bg-slate-50 border-b-2 border-blue-800 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-slate-800">{metric.name}</h3>
          {metric.where.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
              <MapPin size={12} className="text-slate-400" />
              {metric.where.map(w => (
                <span key={w} className="text-[11px] text-slate-600 bg-white border border-slate-200 rounded px-1.5 py-0.5">{w}</span>
              ))}
            </div>
          )}
        </div>
        {hasValue && metric.current && (
          <div className="text-right shrink-0">
            <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">{VALUE_LABEL}</p>
            <p className="text-lg font-bold text-slate-800 leading-tight tabular-nums">{formatValue(value as number, metric.current.format)}</p>
            {verdict && (
              <span className={`inline-block mt-1 text-[11px] font-semibold rounded px-1.5 py-0.5 ${
                verdict === 'good' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
              }`}>
                {verdict === 'good' ? 'v pořádku' : 'ke sledování'}
              </span>
            )}
          </div>
        )}
      </header>

      <div className="px-5 py-4 space-y-3 text-sm flex-1">
        <div className="rounded-lg border border-slate-200 px-3 py-2">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
            <Info size={12} /> Co vyjadřuje
          </p>
          <p className="text-slate-600 leading-relaxed">{metric.meaning}</p>
        </div>

        <div className="rounded-lg border border-slate-200 px-3 py-2">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
            <Calculator size={12} /> Výpočet
          </p>
          <pre className="text-[12.5px] leading-relaxed text-slate-700 bg-slate-50 rounded-md px-2.5 py-1.5 whitespace-pre-wrap font-mono">{metric.formula}</pre>
        </div>

        {metric.benchmark && (
          <div className="rounded-lg border border-blue-200 bg-blue-50/40 px-3 py-2">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-blue-700 mb-1">
              <Target size={12} /> Benchmark
            </p>
            <p className="text-slate-600 leading-relaxed">{metric.benchmark.text}</p>
          </div>
        )}

        {metric.note && (
          <p className="flex gap-2 text-[13px] text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 leading-relaxed">
            <AlertTriangle size={14} className="shrink-0 mt-0.5 text-amber-600" />
            <span>{metric.note}</span>
          </p>
        )}
      </div>
    </article>
  );
}

// ─── Stránka ─────────────────────────────────────────────────────────────────

export default function SlovnikPage() {
  const { values, start, end, loading } = useCurrentValues();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<MetricCategory | 'all'>('all');

  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('cs');
    return METRICS.filter(m =>
      (category === 'all' || m.category === category) &&
      (!q || `${m.name} ${m.meaning} ${m.formula}`.toLocaleLowerCase('cs').includes(q)),
    );
  }, [query, category]);

  const grouped = CATEGORY_ORDER
    .map(cat => ({ cat, items: filtered.filter(m => m.category === cat) }))
    .filter(g => g.items.length > 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
          <BookOpen size={22} className="text-blue-600" /> Slovník klíčových metrik
        </h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Co jednotlivé metriky v reportingu znamenají, jak se počítají a jaké hodnoty jsou v segmentu běžné
        </p>
      </div>

      {/* Kontext */}
      <div className="bg-white rounded-xl border border-slate-100 shadow-sm px-5 py-4 flex gap-3">
        <Info size={18} className="text-blue-600 shrink-0 mt-0.5" />
        <div className="text-sm text-slate-600 space-y-1.5 leading-relaxed">
          <p>{SEGMENT_DESCRIPTION}</p>
          <p className="text-slate-500">
            <strong className="font-semibold text-slate-600">Hodnota {VALUE_LABEL}</strong> u metrik = posledních 12 měsíců
            (od {formatDate(start)} do {formatDate(end)}), {VALUE_SCOPE} Metriky zákazníků (LTV, míra opakovaného nákupu)
            jsou za celou historii. <strong className="font-semibold text-slate-600">Benchmarky jsou orientační</strong> rozpětí
            z praxe e-shopů v segmentu {SEGMENT_LABEL}, ne oficiální statistika. Štítek „ke sledování“ neznamená chybu,
            jen že hodnota leží mimo běžné pásmo.
            {loading && <span className="ml-1 text-slate-400">Načítám aktuální hodnoty…</span>}
          </p>
        </div>
      </div>

      {/* Filtry */}
      <div className="flex flex-col md:flex-row md:items-center gap-3">
        <label className="relative md:w-72">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Hledat metriku…"
            className="w-full border border-slate-200 rounded-lg pl-9 pr-3 py-2 text-sm text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </label>
        <div className="flex flex-wrap gap-1.5">
          {(['all', ...CATEGORY_ORDER] as const).map(cat => (
            <button
              key={cat}
              onClick={() => setCategory(cat)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                category === cat
                  ? 'bg-blue-600 border-blue-600 text-white'
                  : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              {cat === 'all' ? 'Vše' : CATEGORY_LABELS[cat]}
            </button>
          ))}
        </div>
      </div>

      {/* Sekce */}
      {grouped.length === 0 && (
        <p className="text-sm text-slate-400">Žádná metrika neodpovídá hledání.</p>
      )}
      {grouped.map(({ cat, items }) => (
        <section key={cat}>
          <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">{CATEGORY_LABELS[cat]}</h2>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {items.map(m => (
              <MetricCard key={m.id} metric={m} value={m.current ? values[m.current.key] : null} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
