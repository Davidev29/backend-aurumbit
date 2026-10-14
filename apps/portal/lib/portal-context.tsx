"use client";

import { createContext, useContext, useState, type ReactNode, useCallback } from "react";
import { AuthProvider } from "@/hooks/useAuth";
import { ToastProvider } from "@/components/ui/Toast";

interface PortalContextType {
  authModalOpen: boolean;
  authMode: "login" | "register";
  authReturnTo: string | null;
  openAuthModal: (mode?: "login" | "register", opts?: { returnTo?: string }) => void;
  closeAuthModal: () => void;
  consumeReturnTo: () => string | null;
}

const PortalContext = createContext<PortalContextType | null>(null);

export function PortalProvider({ children }: { children: ReactNode }) {
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authReturnTo, setAuthReturnTo] = useState<string | null>(null);

  const openAuthModal = useCallback((mode: "login" | "register" = "login", opts?: { returnTo?: string }) => {
    setAuthMode(mode);
    setAuthReturnTo(opts?.returnTo ?? null);
    setAuthModalOpen(true);
  }, []);

  const closeAuthModal = useCallback(() => {
    setAuthModalOpen(false);
  }, []);

  const consumeReturnTo = useCallback(() => {
    const to = authReturnTo;
    setAuthReturnTo(null);
    // Só destinos internos relativos — nunca URL externa (open-redirect).
    if (to && to.startsWith("/") && !to.startsWith("//")) return to;
    return null;
  }, [authReturnTo]);

  return (
    <PortalContext.Provider value={{ authModalOpen, authMode, authReturnTo, openAuthModal, closeAuthModal, consumeReturnTo }}>
      <AuthProvider>
        <ToastProvider>
          {children}
        </ToastProvider>
      </AuthProvider>
    </PortalContext.Provider>
  );
}

export function usePortal() {
  const context = useContext(PortalContext);
  if (!context) {
    throw new Error("usePortal must be used within a PortalProvider");
  }
  return context;
}