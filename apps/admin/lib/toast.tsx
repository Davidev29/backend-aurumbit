"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

export type ToastTone = "success" | "info" | "warn" | "error";

export interface ToastItem {
  id: string;
  tone: ToastTone;
  title: string;
  body?: string;
}

interface ToastContextValue {
  toasts: ToastItem[];
  push: (t: Omit<ToastItem, "id">) => string;
  dismiss: (id: string) => void;
  notify: (tone: ToastTone, title: string, body?: string) => string;
}

const ToastContext = createContext<ToastContextValue>({
  toasts: [],
  push: () => "",
  dismiss: () => {},
  notify: () => "",
});

let seq = 0;

/**
 * Provedor único de alertas do terminal.
 * Regra do módulo administrativo: alertas e notificações operacionais são
 * enviados EXCLUSIVAMENTE por toast (sem `alert()`/`confirm()` nativo e sem
 * banners inline concorrentes). O histórico permanente vive em /notificacoes.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const tm = timers.current.get(id);
    if (tm) {
      clearTimeout(tm);
      timers.current.delete(id);
    }
  }, []);

  const push = useCallback(
    (t: Omit<ToastItem, "id">) => {
      seq += 1;
      const id = `toast-${Date.now().toString(36)}-${seq}`;
      const item: ToastItem = { ...t, id };
      setToasts((prev) => [...prev.slice(-3), item]);
      const tm = setTimeout(() => dismiss(id), 5600);
      timers.current.set(id, tm);
      return id;
    },
    [dismiss],
  );

  const notify = useCallback(
    (tone: ToastTone, title: string, body?: string) => push({ tone, title, body }),
    [push],
  );

  const value = useMemo(() => ({ toasts, push, dismiss, notify }), [toasts, push, dismiss, notify]);

  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

export function useToast(): ToastContextValue {
  return useContext(ToastContext);
}
