"use client";

import { useEffect, useState } from "react";
import { CircleCheck, Info, TriangleAlert, X, XCircle } from "lucide-react";
import { useToast, type ToastTone } from "@/lib/toast";
import { cn } from "@/lib/cn";

const TONE_STYLE: Record<ToastTone, { bar: string; Icon: typeof Info }> = {
  success: { bar: "bg-ok", Icon: CircleCheck },
  info: { bar: "bg-info", Icon: Info },
  warn: { bar: "bg-warn", Icon: TriangleAlert },
  error: { bar: "bg-danger", Icon: XCircle },
};

/**
 * Viewport de toasts (único canal de alertas do admin).
 * Fixo inferior-direito, `role="status"` + `aria-live="polite"`, z canônico
 * de tooltip (70). Auto-dispensa em ~5,6s; fechar manual via botão 44px.
 */
export function Toaster() {
  const { toasts, dismiss } = useToast();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      aria-label="Alertas"
      className="pointer-events-none fixed bottom-4 right-4 z-tooltip flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
    >
      {toasts.map((t) => {
        const { bar, Icon } = TONE_STYLE[t.tone];
        return (
          <div
            key={t.id}
            role="status"
            className="pointer-events-auto flex items-start gap-3 rounded-card border border-line1 bg-bg1 p-3 shadow-3"
          >
            <span aria-hidden="true" className={cn("mt-1 h-8 w-1 shrink-0 rounded-full", bar)} />
            <span aria-hidden="true" className="mt-0.5 shrink-0 text-text1">
              <Icon size={20} strokeWidth={1.75} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-body font-semibold text-text1">{t.title}</span>
              {t.body && <span className="mt-0.5 block text-callout text-text2">{t.body}</span>}
            </span>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              aria-label="Dispensar alerta"
              title="Dispensar"
              className="focus-ring flex h-11 w-11 shrink-0 items-center justify-center rounded-base text-text2 hover:text-text1"
            >
              <X size={20} strokeWidth={1.75} aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
