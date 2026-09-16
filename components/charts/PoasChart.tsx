'use client';

import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { formatShortDate, formatMonthYear } from '@/lib/formatters';
import { C } from '@/lib/chartColors';

export interface PoasChartPoint {
  date: string;
  /** null = den bez letošních dat nebo bez marketingových nákladů */
  poas: number | null;
  poas_prev: number | null;
}

interface Props {
  data: PoasChartPoint[];
  hasPrevData?: boolean;
  isMonthly?: boolean;
  /** Upozornění pod nadpisem (např. neúplné SK nákupní ceny) */
  note?: string;
}

const fmtPoas = (v: number) => `${v.toFixed(2).replace('.', ',')}×`;

/** POAS = Marže / Marketingové investice. Referenční čára 1,0× = marketing spotřebuje celou marži. */
export default function PoasChart({ data, hasPrevData = true, isMonthly = false, note }: Props) {
  const tickFormatter = isMonthly ? formatMonthYear : formatShortDate;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="bg-white border border-slate-200 rounded-xl shadow-lg p-3 text-xs min-w-[170px]">
        <p className="font-semibold text-slate-600 mb-2 pb-1.5 border-b border-slate-100">{tickFormatter(label)}</p>
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        {payload.map((p: any) => p.value != null && (
          <div key={p.name} className="flex items-center justify-between gap-4 py-0.5">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: p.stroke }} />
              <span className="text-slate-500">{p.name}</span>
            </div>
            <span className="font-semibold text-slate-700">{fmtPoas(Number(p.value))}</span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
      <h2 className="text-sm font-semibold text-slate-700">{hasPrevData ? 'POAS (YoY)' : 'POAS'}</h2>
      <p className={`text-xs mt-0.5 mb-4 ${note ? 'text-amber-600 font-medium' : 'text-slate-400'}`}>
        {note ? `⚠ ${note}` : 'Marže / marketingové investice · čára 1,0× = marketing spotřebuje celou marži'}
      </p>
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="0" stroke="#f1f5f9" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={tickFormatter}
            tick={{ fontSize: 11, fill: '#94a3b8' }}
            axisLine={false}
            tickLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            tickFormatter={v => `${Number(v).toFixed(1).replace('.', ',')}×`}
            tick={{ fontSize: 11, fill: '#94a3b8' }}
            axisLine={false}
            tickLine={false}
            width={46}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#e2e8f0', strokeWidth: 1 }} />
          <Legend wrapperStyle={{ fontSize: 11, paddingTop: 14, color: '#64748b' }} iconType="circle" iconSize={8} />
          <ReferenceLine y={1} stroke="#94a3b8" strokeDasharray="4 4" />
          <Line type="monotone" dataKey="poas" name="POAS (aktuální)" stroke={C.margin} strokeWidth={2.5} dot={false} activeDot={{ r: 4, strokeWidth: 0 }} connectNulls />
          {hasPrevData && (
            <Line type="monotone" dataKey="poas_prev" name="POAS (loňský rok)" stroke={C.marginLight} strokeWidth={1.5} strokeDasharray="5 4" dot={false} activeDot={{ r: 3, strokeWidth: 0 }} connectNulls />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
