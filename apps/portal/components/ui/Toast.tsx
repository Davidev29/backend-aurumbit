"use client";

import { createContext, useContext, useState, type ReactNode, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, CheckCircle, AlertCircle, AlertTriangle, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Toast, ToastType } from "@/types";

interface ToastContextType {
  toasts: Toast[];
  addToast: (toast: Omit<Toast, "id">) => string;
  removeToast: (id: string) => void;
  clearToasts: () => void;
}

const ToastContext = createContext<ToastContextType | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((toast: Omit<Toast, "id">) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const newToast = { ...toast, id, duration: toast.duration ?? 5000 };
    setToasts((prev) => [...prev, newToast]);
    return id;
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const clearToasts = useCallback(() => {
    setToasts([]);
  }, []);

  const value = useMemo(() => ({ toasts, addToast, removeToast, clearToasts }), [
    toasts,
    addToast,
    removeToast,
    clearToasts,
  ]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}

function ToastContainer({ toasts, onRemove }: { toasts: Toast[]; onRemove: (id: string) => void }) {
  const icons: Record<ToastType, typeof CheckCircle> = {
    success: CheckCircle,
    error: AlertCircle,
    warning: AlertTriangle,
    info: Info,
  };

  const colors = {
    success: "bg-ok-soft border-ok/30 text-ok",
    error: "bg-danger-soft border-danger/30 text-danger",
    warning: "bg-warn-soft border-warn/30 text-warn",
    info: "bg-info-soft border-info/30 text-info",
  };

  return (
    <div className="fixed bottom-4 right-4 z-[70] flex flex-col gap-2 pointer-events-none" aria-live="polite">
      <AnimatePresence>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, x: 100, scale: 0.95 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 100, scale: 0.95 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className={cn(
              "pointer-events-auto glass-card border min-w-[300px] max-w-md shadow-3",
              colors[toast.type]
            )}
            role="alert"
          >
            <div className="flex items-start gap-3 p-4">
              <div className="flex-shrink-0 mt-0.5">
                {(() => {
                  const Icon = icons[toast.type];
                  return <Icon className="w-5 h-5" />;
                })()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-text1">{toast.title}</p>
                {toast.message && (
                  <p className="mt-0.5 text-body text-text2">{toast.message}</p>
                )}
              </div>
              <button
                onClick={() => onRemove(toast.id)}
                className="flex-shrink-0 p-1 rounded-base text-text3 hover:text-text1 hover:bg-bg2 transition-colors"
                aria-label="Fechar notificação"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {toast.action && (
              <div className="px-4 pb-4 pt-0 border-t border-line2/50">
                <button
                  onClick={() => {
                    toast.action?.onClick();
                    onRemove(toast.id);
                  }}
                  className="text-sm font-semibold text-accent hover:underline"
                >
                  {toast.action.label}
                </button>
              </div>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

// Helper hook for common toast patterns
export function useToastHelpers() {
  const { addToast } = useToast();

  return {
    success: (title: string, message?: string, action?: Toast["action"]) =>
      addToast({ type: "success", title, message, action }),
    error: (title: string, message?: string, action?: Toast["action"]) =>
      addToast({ type: "error", title, message, action }),
    warning: (title: string, message?: string, action?: Toast["action"]) =>
      addToast({ type: "warning", title, message, action }),
    info: (title: string, message?: string, action?: Toast["action"]) =>
      addToast({ type: "info", title, message, action }),
  };
}