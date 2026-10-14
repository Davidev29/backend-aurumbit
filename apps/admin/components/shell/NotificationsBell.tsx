"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import { listNotifications, markNotificationRead, type FinanceNotificationView } from "@/lib/finance";
import { useToast } from "@/lib/toast";

const SEVERITY_DOT: Record<FinanceNotificationView["severity"], string> = {
  INFO: "bg-accent",
  WARN: "bg-[#b7791f]",
  ERROR: "bg-danger",
};

/**
 * Sino de notificações do financeiro (atalho p/ a central).
 * - Envio em tempo real: EXCLUSIVAMENTE por toast (`useToast`); o sino nunca
 *   dispara `alert()` nem banner solto.
 * - Histórico permanente: rota própria `/notificacoes` (aba da central).
 * - Aqui: badge de não lidas + prévia com link "Ver todas".
 * Falha silenciosa → sino honesto ("sem fonte"), nunca quebra o shell.
 */
export function NotificationsBell() {
  const { notify } = useToast();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<FinanceNotificationView[]>([]);
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const seenRef = useRef<Set<string>>(new Set());

  const load = useCallback(
    async (announce: boolean) => {
      try {
        const res = await listNotifications(false);
        setItems(res.data.slice(0, 8));
        setUnread(res.unread);
        setError(false);
        if (announce) {
          for (const n of res.data.slice(0, 8)) {
            if (!n.read && !seenRef.current.has(n.id)) {
              seenRef.current.add(n.id);
              // Novas não lidas chegam por toast — canal exclusivo de envio.
              notify(n.severity === "ERROR" ? "error" : n.severity === "WARN" ? "warn" : "info", n.title, n.body);
            }
          }
          // Limita memória do dedupe.
          if (seenRef.current.size > 60) {
            seenRef.current = new Set(res.data.slice(0, 8).map((n) => n.id));
          }
        } else {
          for (const n of res.data.slice(0, 8)) seenRef.current.add(n.id);
        }
      } catch {
        setError(true);
      }
    },
    [notify],
  );

  useEffect(() => {
    void load(false);
    const t = setInterval(() => void load(true), 60_000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (!open) return;
    void load(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    const onDown = (e: PointerEvent) => {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target as Node) &&
        !triggerRef.current?.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [open, load]);

  async function handleRead(n: FinanceNotificationView) {
    if (n.read) return;
    try {
      await markNotificationRead(n.id);
      setItems((prev) => prev.map((i) => (i.id === n.id ? { ...i, read: true } : i)));
      setUnread((u) => Math.max(0, u - 1));
    } catch {
      // Mantém não lida; próxima abertura retenta.
    }
  }

  return (
    <div className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        aria-label={unread > 0 ? `Notificações (${unread} não lidas). Abrir prévia` : "Notificações. Abrir prévia"}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : setOpen(true))}
        className="focus-ring relative flex h-11 w-11 items-center justify-center rounded-base border border-line2 text-text1"
      >
        <Bell size={20} strokeWidth={1.75} aria-hidden="true" />
        {unread > 0 && (
          <span
            aria-hidden="true"
            className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1 text-[11px] font-bold text-white"
          >
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Prévia de notificações"
          className="absolute right-0 top-full z-40 mt-1 w-80 border border-line1 bg-bg2 p-2 shadow-2"
          style={{ borderRadius: 12 }}
        >
          {error && items.length === 0 ? (
            <p className="m-0 px-3 py-2 text-callout text-text2">Sem notificações no momento.</p>
          ) : items.length === 0 ? (
            <p className="m-0 px-3 py-2 text-callout text-text2">Sem notificações no momento.</p>
          ) : (
            <ul className="m-0 max-h-80 list-none overflow-auto p-0">
              {items.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => void handleRead(n)}
                    title={n.read ? n.title : "Marcar como lida"}
                    className="focus-ring flex w-full items-start gap-2 rounded-base px-3 py-2 text-left hover:bg-bg1"
                  >
                    <span aria-hidden="true" className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${SEVERITY_DOT[n.severity]}`} />
                    <span>
                      <span className={`block text-body ${n.read ? "text-text2" : "font-semibold text-text1"}`}>
                        {n.title}
                      </span>
                      <span className="block text-callout text-text2">{n.body}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Link
            href="/notificacoes"
            onClick={() => setOpen(false)}
            className="focus-ring mt-1 flex min-h-[44px] items-center justify-center rounded-base border border-line2 text-body font-semibold text-text1 no-underline hover:bg-bg1"
          >
            Ver todas na central
          </Link>
        </div>
      )}
    </div>
  );
}
