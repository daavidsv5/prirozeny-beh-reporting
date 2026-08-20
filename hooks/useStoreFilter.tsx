'use client';

import React, { createContext, useContext, useState } from 'react';

export type StoreScope = 'all' | 'eshop' | 'prodejna';

interface StoreFilterCtx {
  store: StoreScope;
  setStore: (s: StoreScope) => void;
}

const Ctx = createContext<StoreFilterCtx | null>(null);

export function StoreFilterProvider({ children }: { children: React.ReactNode }) {
  const [store, setStore] = useState<StoreScope>('all');

  return (
    <Ctx.Provider value={{ store, setStore }}>
      {children}
    </Ctx.Provider>
  );
}

export function useStoreFilter(): StoreFilterCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useStoreFilter must be used within StoreFilterProvider');
  return ctx;
}

/** Routes where the Vše / E-shop / Prodejna selector appears in the TopBar. */
export const STORE_FILTER_ROUTES = [
  '/hlavni-dashboard',
  '/dashboard',
  '/marketing',
  '/orders',
  '/margin',
  '/products',
  '/brands',
  '/behavior',
];

/** Small helper: pick the right dataset variant for the current store scope. */
export function pickByStore<T>(store: StoreScope, all: T, eshop: T, prodejna: T): T {
  if (store === 'eshop') return eshop;
  if (store === 'prodejna') return prodejna;
  return all;
}
