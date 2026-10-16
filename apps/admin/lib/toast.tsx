"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { toUserError, type UserFacingError } from "./errors";

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
  /**
   * Erro instrutivo via Toast (canal único de falhas de mutação).
   * Traduz com `toUserError` (tom + cor por tipo) e devolve o `UserFacingError`
   * p/ registro inline persistente no diálogo (sem `role=alert` duplicado —
   * o anúncio acessível é o do toast).
   */
  notifyError: (err: unknown, fallback?: string) => UserFacingError;
}

const ToastContext = createContext<ToastContextValue>({
  toasts: [],
  push: () => "",
  dismiss: () => {},
  notify: () => "",
  notifyError: () => ({ tone: "error", title: "Algo deu errado", body: "" }),
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

  const notifyError = useCallback(
    (err: unknown, fallback?: string) => {
      const u = toUserError(err, fallback);
      push({ tone: u.tone, title: u.title, body: u.body });
      return u;
    },
    [push],
  );

  const value = useMemo(
    () => ({ toasts, push, dismiss, notify, notifyError }),
    [toasts, push, dismiss, notify, notifyError],
  );

  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

export function useToast(): ToastContextValue {
  return useContext(ToastContext);
}
