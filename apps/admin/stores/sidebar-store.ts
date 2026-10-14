"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

interface SidebarState {
  /** Colapsada: w-16 (só ícones). Expandida: w-72. Colapso instant + crossfade (DS §6: nunca animar width). */
  collapsed: boolean;
  /** Drawer mobile (<1024px). */
  mobileOpen: boolean;
  toggleCollapsed: () => void;
  /** Alias exigido pelo contrato da store. */
  toggle: () => void;
  setCollapsed: (v: boolean) => void;
  setMobileOpen: (v: boolean) => void;
}

export const COOKIE_NAME = "ab_sidebar";

/** Persiste o colapso em `localStorage` (`aurum:sidebar-collapsed`) + cookie `ab_sidebar` (Sidebar sincroniza o cookie p/ SSR). */
export const useSidebarStore = create<SidebarState>()(
  persist(
    (set) => ({
      collapsed: false,
      mobileOpen: false,
      toggleCollapsed: () => set((s) => ({ collapsed: !s.collapsed })),
      toggle: () => set((s) => ({ collapsed: !s.collapsed })),
      setCollapsed: (v) => set({ collapsed: v }),
      setMobileOpen: (v) => set({ mobileOpen: v }),
    }),
    {
      name: "aurum:sidebar-collapsed",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ collapsed: s.collapsed }) as SidebarState,
    },
  ),
);
