"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

interface OrgState {
  orgId: string | null;
  setOrgId: (id: string) => void;
}

export const useOrgStore = create<OrgState>()(
  persist(
    (set) => ({
      orgId: null,
      setOrgId: (id) => set({ orgId: id }),
    }),
    {
      name: "aurum-org",
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
