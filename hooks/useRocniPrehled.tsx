'use client';

import React, { createContext, useContext, useState, useMemo } from 'react';
import { mockData } from '@/data/mockGenerator';
import { getYearInfos, type YearInfo } from '@/lib/rocniPrehled';

interface RocniPrehledCtx {
  yearInfos: YearInfo[];
  /** Vybrané roky, vzestupně */
  selectedYears: number[];
  toggleYear: (y: number) => void;
}

const Ctx = createContext<RocniPrehledCtx | null>(null);

export function RocniPrehledProvider({ children }: { children: React.ReactNode }) {
  const yearInfos = useMemo(() => getYearInfos(mockData), []);
  // Výchozí výběr: roky s kompletní historií od 1. 1. (neúplné roky jdou přidat ručně)
  const [selected, setSelected] = useState<number[]>(() => {
    const full = yearInfos.filter(y => !y.partial).map(y => y.year);
    return full.length > 0 ? full : yearInfos.map(y => y.year);
  });

  const toggleYear = (y: number) => setSelected(prev => {
    if (prev.includes(y)) return prev.length > 1 ? prev.filter(x => x !== y) : prev;
    return [...prev, y].sort((a, b) => a - b);
  });

  return (
    <Ctx.Provider value={{ yearInfos, selectedYears: selected, toggleYear }}>
      {children}
    </Ctx.Provider>
  );
}

export function useRocniPrehled(): RocniPrehledCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useRocniPrehled must be used within RocniPrehledProvider');
  return ctx;
}
