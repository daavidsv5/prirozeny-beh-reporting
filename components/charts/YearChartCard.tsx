'use client';

// Sloupcový graf Ročního přehledu: jeden sloupec na rok, nad sloupcem změna proti předchozímu roku.

import type { ReactNode } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, LabelList,
} from 'recharts';
import { CURRENT_YEAR, CUTOFF_LABEL, type YearInfo } from '@/lib/rocniPrehled';

/** Změna proti předchozímu roku: 'pct' = relativní změna v %, 'pp' = rozdíl v procentních bodech */
export type ChangeKind = 'pct' | 'pp';

export interface YearPoint {
  year: string;
  value: number | null;
  change: number | null;
  changeLabel: string;
  /** Popis srovnávaného období v tooltipu, např. „vs. 2025 (1. 1. až 15. 9.)“ */
  compareLabel: string;
}

function computeChange(cur: number | null, prev: number | null, kind: ChangeKind): number | null {
  if (cur === null || prev === null) return null;
  if (kind === 'pp') return cur - prev;
  return prev !== 0 ? ((cur - prev) / Math.abs(prev)) * 100 : null;
}

export function fmtChange(v: number, kind: ChangeKind): string {
  const sign = v > 0 ? '+' : v < 0 ? '−' : '';
  return `${sign}${Math.abs(v).toFixed(1).replace('.', ',')} ${kind === 'pp' ? 'p. b.' : '%'}`;
}

/**
 * Body grafu pro vybrané roky. Minulé roky = celý rok proti celému předchozímu roku,
 * aktuální rok proti stejnému období loni (`prevYtdValue`). Změna se nepočítá u neúplných roků
 * ani proti neúplnému roku.
 */
export function buildYearPoints(opts: {
  selectedYears: number[];
  yearInfos: YearInfo[];
  getValue: (year: number) => number | null;
  prevYtdValue: number | null;
  kind: ChangeKind;
}): YearPoint[] {
  const { selectedYears, yearInfos, getValue, prevYtdValue, kind } = opts;
  const partial = new Set(yearInfos.filter(y => y.partial).map(y => y.year));
  const known = new Set(yearInfos.map(y => y.year));
  return selectedYears.map(year => {
    const value = getValue(year);
    const isCurrent = year === CURRENT_YEAR;
    const prev = isCurrent ? prevYtdValue : getValue(year - 1);
    const usable = known.has(year - 1) && !partial.has(year - 1) && !partial.has(year);
    const change = usable ? computeChange(value, prev, kind) : null;
    return {
      year: String(year),
      value,
      change,
      changeLabel: change === null ? '' : fmtChange(change, kind),
      compareLabel: isCurrent ? `vs. ${year - 1} (1. 1. až ${CUTOFF_LABEL})` : `vs. ${year - 1} (celý rok)`,
    };
  });
}

export function yearPeriodLabel(year: number): string {
  return year === CURRENT_YEAR ? `1. 1. až ${CUTOFF_LABEL} (rok zatím běží)` : 'celý rok';
}

interface YearChartCardProps {
  title: string;
  subtitle?: string;
  subtitleWarning?: boolean;
  data: YearPoint[];
  colorCurrent: string;  // poslední vybraný rok
  colorOther: string;    // ostatní roky
  changeKind: ChangeKind;
  /** Nižší hodnota je lepší (PNO, CPA, náklady) → obrácené barvy změny */
  lowerIsBetter?: boolean;
  axisFormatter: (v: number) => string;
  valueFormatter: (v: number) => string;
  headerRight?: ReactNode;
}

function changeColor(change: number, lowerIsBetter?: boolean): string {
  if (change === 0) return '#64748b';
  const good = lowerIsBetter ? change < 0 : change > 0;
  return good ? '#059669' : '#e11d48';
}

export function YearChartCard({
  title, subtitle, subtitleWarning, data, colorCurrent, colorOther, changeKind, lowerIsBetter,
  axisFormatter, valueFormatter, headerRight,
}: YearChartCardProps) {
  const lastIdx = data.length - 1;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const p: YearPoint = payload[0].payload;
    return (
      <div className="bg-white border border-slate-200 rounded-lg p-2.5 text-xs shadow-sm">
        <p className="font-medium text-slate-600">{p.year}</p>
        <p className="text-slate-400 mb-1">{yearPeriodLabel(+p.year)}</p>
        <p className="text-slate-700">
          {p.value === null ? 'bez dat' : <span className="font-semibold">{valueFormatter(p.value)}</span>}
        </p>
        {p.change !== null && (
          <p className="mt-1 pt-1 border-t border-slate-100 font-semibold" style={{ color: changeColor(p.change, lowerIsBetter) }}>
            {p.compareLabel}: {fmtChange(p.change, changeKind)}
          </p>
        )}
      </div>
    );
  };

  return (
    <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-700 mb-0.5">{title}</h3>
          {subtitle && <p className={`text-xs mb-2 ${subtitleWarning ? 'text-amber-600 font-medium' : 'text-slate-400'}`}>{subtitle}</p>}
        </div>
        {headerRight}
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} margin={{ top: 22, right: 8, left: 0, bottom: 0 }} barCategoryGap="30%">
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
          <XAxis dataKey="year" tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} />
          <YAxis tickFormatter={axisFormatter} tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={46} />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: '#f8fafc' }} />
          <Bar dataKey="value" radius={[3, 3, 0, 0]} maxBarSize={64} isAnimationActive={false}>
            {data.map((d, i) => (
              <Cell key={d.year} fill={i === lastIdx ? colorCurrent : colorOther} />
            ))}
            <LabelList
              dataKey="changeLabel"
              position="top"
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              content={(props: any) => {
                const { x, y, width, index } = props;
                const d = data[index];
                if (!d || d.change === null) return null;
                return (
                  <text x={x + width / 2} y={y - 6} textAnchor="middle" fontSize={11} fontWeight={600} fill={changeColor(d.change, lowerIsBetter)}>
                    {d.changeLabel}
                  </text>
                );
              }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── Formátování ─────────────────────────────────────────────────────────────

const thousands = (v: number) => Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
export const fmtCount = (v: number) => thousands(v);
export const fmtMoney = (cur: string) => (v: number) => `${thousands(v)} ${cur}`;
export const fmtPct = (v: number) => `${v.toFixed(1).replace('.', ',')} %`;
export const fmtPct2 = (v: number) => `${v.toFixed(2).replace('.', ',')} %`;
export const fmtRatio = (v: number) => `${v.toFixed(2).replace('.', ',')}×`;

export function fmtAxisMoney(v: number): string {
  if (v === 0) return '0';
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1).replace('.', ',')}M`;
  if (Math.abs(v) >= 1_000) return `${Math.round(v / 1_000)}k`;
  return String(Math.round(v));
}
export const fmtAxisCount = (v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(Math.round(v)));
export const fmtAxisPct = (v: number) => `${v.toFixed(0)} %`;
export const fmtAxisRatio = (v: number) => `${v.toFixed(1).replace('.', ',')}×`;

// ─── Filtr zařízení (GA4) ────────────────────────────────────────────────────

export type Device = 'all' | 'desktop' | 'mobile' | 'tablet';

const DEVICE_OPTIONS: { value: Device; label: string }[] = [
  { value: 'all',     label: 'Všechna zařízení' },
  { value: 'desktop', label: 'Desktop' },
  { value: 'mobile',  label: 'Mobil' },
  { value: 'tablet',  label: 'Tablet' },
];

export function DeviceSelect({ value, onChange }: { value: Device; onChange: (d: Device) => void }) {
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
