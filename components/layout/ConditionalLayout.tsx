'use client';

import { createContext, useContext, useState } from 'react';
import { usePathname } from 'next/navigation';
import Sidebar from './Sidebar';
import TopBarWrapper from './TopBarWrapper';
import { HlavniDashboardProvider } from '@/hooks/useHlavniDashboard';
import { StoreFilterProvider } from '@/hooks/useStoreFilter';

interface SidebarCtx {
  isOpen: boolean;
  toggle: () => void;
  close: () => void;
}

const SidebarContext = createContext<SidebarCtx>({
  isOpen: false,
  toggle: () => {},
  close: () => {},
});

export function useSidebar() {
  return useContext(SidebarContext);
}

export default function ConditionalLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);

  if (pathname === '/login') {
    return <>{children}</>;
  }

  const toggle = () => setIsOpen(v => !v);
  const close = () => setIsOpen(false);

  return (
    <StoreFilterProvider>
    <HlavniDashboardProvider>
    <SidebarContext.Provider value={{ isOpen, toggle, close }}>
      <div className="flex h-screen">
        {/* Mobile overlay */}
        {isOpen && (
          <div
            className="fixed inset-0 bg-black/50 z-40 md:hidden"
            onClick={close}
          />
        )}

        <Sidebar />

        {/* Main content — on mobile no left margin (sidebar overlays) */}
        <div className="flex-1 flex flex-col overflow-hidden md:ml-60">
          <TopBarWrapper />
          <main className="flex-1 overflow-y-auto p-4 md:p-6 bg-gray-50">
            {children}
          </main>
        </div>
      </div>
    </SidebarContext.Provider>
    </HlavniDashboardProvider>
    </StoreFilterProvider>
  );
}
