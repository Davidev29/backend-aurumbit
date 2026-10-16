"use client";

/**
 * Atendimento admin — layout estilo WhatsApp Web, sem scroll de página.
 * - Esquerda: busca + toggle segmentado Landpage | Clientes + fila (scroll interno).
 * - Direita: conversa ativa (header, mensagens com fundo sutil, composer pill).
 * - Arquivados (só `support.manage` = admin/manager): gaveta lateral com a
 *   lixeira auditável — arquivar não apaga, só tira da fila; dá p/ ver e restaurar.
 * - Altura travada na viewport: só fila e mensagens rolam; a página nunca rola.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Check,
  CheckCheck,
  Globe,
  Headset,
  Inbox,
  Search,
  SendHorizonal,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { useAdminSupport } from "@/lib/support-client";
import { useCan, useMe } from "@/lib/auth/permissions";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import type { ChatConversation, ChatMessage } from "@/lib/support-types";

function timeOf(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(+d)) return "";
  try {
    return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function dateTimeOf(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(+d)) return "";
  try {
    return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function Ticks({ status }: { status: ChatMessage["status"] }) {
  if (status === "read") return <CheckCheck className="h-3.5 w-3.5 text-info" aria-label="Lida" />;
  if (status === "delivered") return <CheckCheck className="h-3.5 w-3.5 opacity-70" aria-label="Entregue" />;
  return <Check className="h-3.5 w-3.5 opacity-70" aria-label="Enviada" />;
}

type Segment = "landpage" | "portal";

const SEGMENTS: { id: Segment; label: string; hint: string }[] = [
  { id: "landpage", label: "Landpage", hint: "visitantes da vitrine" },
  { id: "portal", label: "Clientes", hint: "clientes logados" },
];

const STATUS_LABEL: Record<string, string> = {
  open: "aberta",
  pending: "pendente",
  active: "ativa",
  closed: "fechada",
};

function initialsOf(name: string): string {
  const t = name.trim();
  if (!t) return "•";
  const parts = t.split(/\s+/);
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

/**
 * Gaveta lateral de arquivados (lixeira auditável).
 * Lista → detalhe somente-leitura → restaurar. Nada aqui apaga de verdade.
 */
function ArchivedDrawer({
  open,
  onClose,
  items,
  onReload,
  onRestore,
  restoringId,
}: {
  open: boolean;
  onClose: () => void;
  items: ChatConversation[];
  onReload: () => void;
  onRestore: (id: string) => void;
  restoringId: string | null;
}) {
  const reduce = useReducedMotion();
  const [q, setQ] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<ChatMessage[]>([]);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const initRef = useRef(false);

  useEffect(() => {
    if (!open) {
      initRef.current = false;
      return;
    }
    // Uma vez por abertura: polls do pai recriam renders, mas não podem
    // resetar busca/seleção (era isso que fazia a gaveta "piscar").
    if (initRef.current) return;
    initRef.current = true;
    onReload();
    setQ("");
    setSelectedId(null);
    setMsgs([]);
    closeRef.current?.focus();
  }, [open, onReload]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open || !selectedId) {
      setMsgs([]);
      return;
    }
    let cancelled = false;
    setLoadingMsgs(true);
    fetch(`/api/support/conversations/${encodeURIComponent(selectedId)}/messages`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { data?: ChatMessage[] } | null) => {
        if (!cancelled && data && Array.isArray(data.data)) setMsgs(data.data);
      })
      .catch(() => null)
      .finally(() => {
        if (!cancelled) setLoadingMsgs(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, selectedId]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = needle
      ? items.filter((c) =>
          `${c.visitorName} ${c.visitorEmail ?? ""} ${c.triage?.label ?? ""}`.toLowerCase().includes(needle)
        )
      : items;
    return [...list];
  }, [items, q]);

  const selected = selectedId ? (items.find((c) => c.id === selectedId) ?? null) : null;

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50" role="presentation">
          <motion.div
            aria-hidden="true"
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={reduce ? undefined : { opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="absolute inset-0"
            style={{ background: "var(--scrim)" }}
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) onClose();
            }}
          />
          <motion.aside
            role="dialog"
            aria-modal="true"
            aria-label="Conversas arquivadas"
            initial={reduce ? false : { x: 360, opacity: 0.4 }}
            animate={{ x: 0, opacity: 1 }}
            exit={reduce ? undefined : { x: 360, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="absolute bottom-0 right-0 top-0 flex w-[min(420px,100vw)] flex-col border-l border-line1 bg-bg1 shadow-3"
          >
            <div className="flex shrink-0 items-center gap-2 border-b border-line1 px-4 py-3">
              {selected && (
                <button
                  type="button"
                  onClick={() => setSelectedId(null)}
                  aria-label="Voltar para a lista de arquivados"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-text2 hover:bg-bg0 hover:text-text1"
                >
                  <ArrowLeft size={19} aria-hidden="true" />
                </button>
              )}
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-base bg-accentsoft" aria-hidden="true">
                <Archive size={17} strokeWidth={1.75} className="text-accent" />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-headline text-text1">
                  {selected ? selected.visitorName : "Arquivados"}
                </h2>
                <p className="truncate text-caption text-text2">
                  {selected
                    ? `arquivada em ${dateTimeOf(selected.archivedAt) || "—"} · ${selected.origin === "landpage" ? "landpage" : "cliente"}`
                    : `${items.length} conversa(s) fora da fila · nada é apagado`}
                </p>
              </div>
              <button
                ref={closeRef}
                type="button"
                onClick={onClose}
                aria-label="Fechar arquivados"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-text2 hover:bg-bg0 hover:text-text1"
              >
                <X size={19} aria-hidden="true" />
              </button>
            </div>

            {!selected ? (
              <>
                <div className="shrink-0 p-3">
                  <div className="relative">
                    <Search size={15} aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-text3" />
                    <label htmlFor="arquivados-busca" className="sr-only">
                      Buscar nos arquivados
                    </label>
                    <input
                      id="arquivados-busca"
                      type="search"
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                      placeholder="Buscar nome, e-mail, assunto…"
                      maxLength={80}
                      autoComplete="off"
                      className="h-10 w-full rounded-full border border-line2 bg-bg0 pl-9 pr-3 text-body text-text1 placeholder:text-text3 focus:border-accent focus:outline-none"
                    />
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain" role="listbox" aria-label="Arquivados">
                  {filtered.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
                      <Inbox className="h-8 w-8 text-text3" aria-hidden="true" />
                      <p className="text-headline text-text1">Nada arquivado</p>
                      <p className="text-callout text-text2">
                        {q ? "Nenhum arquivado combina com a busca." : "Conversas sem sequência arquivadas aparecem aqui."}
                      </p>
                    </div>
                  ) : (
                    <ul className="flex flex-col" role="presentation">
                      {filtered.map((c) => (
                        <li key={c.id} role="presentation">
                          <button
                            type="button"
                            role="option"
                            aria-selected={false}
                            onClick={() => setSelectedId(c.id)}
                            className="flex w-full items-center gap-3 border-b border-line1 px-4 py-3 text-left transition-colors duration-150 hover:bg-bg2/60"
                          >
                            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accentsoft text-headline text-text1" aria-hidden="true">
                              {initialsOf(c.visitorName)}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-semibold text-text1">{c.visitorName}</span>
                              <span className="block truncate text-caption text-text2">
                                {c.origin === "landpage" ? "landpage" : "cliente"} · arquivada em {dateTimeOf(c.archivedAt) || "—"}
                              </span>
                            </span>
                            {c.unreadAgent > 0 && (
                              <span className="tnum inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-accent px-1.5 text-micro text-accentink" aria-label={`${c.unreadAgent} não lidas`}>
                                {c.unreadAgent > 99 ? "99+" : c.unreadAgent}
                              </span>
                            )}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4" role="log" aria-live="polite" aria-label={`Mensagens arquivadas de ${selected.visitorName}`}>
                  <div className="flex flex-col gap-1.5">
                    {loadingMsgs && <p className="self-center text-callout text-text2">Carregando histórico…</p>}
                    {!loadingMsgs && msgs.length === 0 && (
                      <p className="self-center text-callout text-text2">Sem mensagens preservadas.</p>
                    )}
                    {msgs.map((m) => {
                      const mine = m.sender === "agent";
                      return (
                        <div key={m.id} className={cn("flex w-full", mine ? "justify-end" : "justify-start")}>
                          <div className={cn(
                            "max-w-[85%] px-3 pb-1.5 pt-2 shadow-1",
                            mine
                              ? "rounded-2xl rounded-br-sm bg-accent text-accentink"
                              : "rounded-2xl rounded-bl-sm border border-line1 bg-bg2 text-text1"
                          )}>
                            {!mine && <p className="text-micro font-semibold text-accent">{m.authorName}</p>}
                            <p className="whitespace-pre-wrap break-words text-body">{m.body}</p>
                            <p className={cn("mt-1 text-right text-caption", mine ? "text-accentink/80" : "text-text3")}>
                              <time dateTime={m.createdAt}>{timeOf(m.createdAt)}</time>
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className="shrink-0 border-t border-line1 p-3">
                  <button
                    type="button"
                    onClick={() => onRestore(selected.id)}
                    disabled={restoringId !== null}
                    className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-base bg-accent text-body font-semibold text-accentink transition-transform duration-150 active:scale-[0.99] disabled:opacity-45"
                  >
                    <ArchiveRestore size={18} aria-hidden="true" />
                    {restoringId === selected.id ? "Restaurando…" : "Restaurar para a fila"}
                  </button>
                </div>
              </>
            )}
          </motion.aside>
        </div>
      )}
    </AnimatePresence>
  );
}

export default function AtendimentoAdminPage() {
  const { me } = useMe();
  const reduce = useReducedMotion();
  const chat = useAdminSupport();
  // Lixeira: só admin/manager (`support.manage`). Backend barra por role também.
  const canArchive = useCan("support.manage");

  const [segment, setSegment] = useState<Segment>("landpage");
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [mobileChat, setMobileChat] = useState(false);
  const [booted, setBooted] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const typingTimer = useRef<number | null>(null);

  const counts = useMemo(
    () => ({
      landpage: chat.conversations.filter((c) => c.origin === "landpage").length,
      portal: chat.conversations.filter((c) => c.origin !== "landpage").length,
    }),
    [chat.conversations]
  );

  const unreadBySegment = useMemo(
    () => ({
      landpage: chat.conversations
        .filter((c) => c.origin === "landpage")
        .reduce((a, c) => a + (c.unreadAgent || 0), 0),
      portal: chat.conversations
        .filter((c) => c.origin !== "landpage")
        .reduce((a, c) => a + (c.unreadAgent || 0), 0),
    }),
    [chat.conversations]
  );

  // Boot: escolhe o segmento com mais não-lidas (empate: mensagem mais recente).
  useEffect(() => {
    if (booted || chat.conversations.length === 0) return;
    const latest = (s: Segment) =>
      chat.conversations
        .filter((c) => (s === "landpage" ? c.origin === "landpage" : c.origin !== "landpage"))
        .reduce((max, c) => Math.max(max, +new Date(c.lastMessageAt) || 0), 0);
    const best: Segment =
      unreadBySegment.portal !== unreadBySegment.landpage
        ? unreadBySegment.portal > unreadBySegment.landpage
          ? "portal"
          : "landpage"
        : latest("portal") > latest("landpage")
          ? "portal"
          : "landpage";
    setSegment(best);
    const first = [...chat.conversations]
      .filter((c) => (best === "landpage" ? c.origin === "landpage" : c.origin !== "landpage"))
      .sort((a, b) => +new Date(b.lastMessageAt) - +new Date(a.lastMessageAt))[0];
    if (first) chat.setActiveId(first.id);
    setBooted(true);
  }, [chat.conversations.length]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const inSegment = chat.conversations.filter((c) =>
      segment === "landpage" ? c.origin === "landpage" : c.origin !== "landpage"
    );
    const filtered = q
      ? inSegment.filter((c) =>
          `${c.visitorName} ${c.visitorEmail ?? ""} ${c.triage?.label ?? ""}`.toLowerCase().includes(q)
        )
      : inSegment;
    return [...filtered].sort((a, b) => {
      const ua = (a.unreadAgent || 0) > 0 ? 1 : 0;
      const ub = (b.unreadAgent || 0) > 0 ? 1 : 0;
      if (ua !== ub) return ub - ua;
      if ((b.unreadAgent || 0) !== (a.unreadAgent || 0)) return (b.unreadAgent || 0) - (a.unreadAgent || 0);
      return +new Date(b.lastMessageAt) - +new Date(a.lastMessageAt);
    });
  }, [chat.conversations, segment, query]);

  const active = chat.activeId ? (visible.find((c) => c.id === chat.activeId) ?? null) : null;
  // Ativa pode estar fora do segmento (ex.: chegou via polling): resolve pelo id global.
  const activeGlobal = !active && chat.activeId
    ? (chat.conversations.find((c) => c.id === chat.activeId) ?? null)
    : active;
  const shown = active ?? activeGlobal;

  // Troca de segmento sempre reseleciona a primeira do novo segmento.
  const pickSegment = (s: Segment) => {
    if (s === segment) return;
    setSegment(s);
    setDraft("");
    setMobileChat(false);
    const q = query.trim().toLowerCase();
    const list = chat.conversations
      .filter((c) => (s === "landpage" ? c.origin === "landpage" : c.origin !== "landpage"))
      .filter((c) =>
        q ? `${c.visitorName} ${c.visitorEmail ?? ""} ${c.triage?.label ?? ""}`.toLowerCase().includes(q) : true
      )
      .sort((a, b) => {
        const ua = (a.unreadAgent || 0) > 0 ? 1 : 0;
        const ub = (b.unreadAgent || 0) > 0 ? 1 : 0;
        if (ua !== ub) return ub - ua;
        return +new Date(b.lastMessageAt) - +new Date(a.lastMessageAt);
      });
    chat.setActiveId(list[0]?.id ?? null);
  };

  const pickConversation = (id: string) => {
    chat.setActiveId(id);
    setDraft("");
    setMobileChat(true);
  };

  useEffect(() => {
    setDraft("");
  }, [chat.activeId]);

  // Scroll interno da conversa (nunca scrollIntoView da página).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    try {
      el.scrollTo({ top: el.scrollHeight, behavior: reduce ? "auto" : "smooth" });
    } catch {
      el.scrollTop = el.scrollHeight;
    }
  }, [chat.messages.length, chat.typingVisitor, chat.activeId, reduce]);

  useEffect(() => {
    if (chat.activeId) {
      const t = window.setTimeout(() => void chat.markRead(), 700);
      return () => window.clearTimeout(t);
    }
  }, [chat.activeId, chat.messages.length]);

  const notifyTyping = () => {
    void chat.sendTyping(true);
    if (typingTimer.current) window.clearTimeout(typingTimer.current);
    typingTimer.current = window.setTimeout(() => void chat.sendTyping(false), 1500);
  };

  const send = async () => {
    const text = draft.trim();
    if (!text || !chat.activeId || sending) return;
    setSending(true);
    try {
      await chat.send(text, me?.name || "Atendimento");
      setDraft("");
      void chat.sendTyping(false);
    } finally {
      setSending(false);
    }
  };

  const totalUnread = unreadBySegment.landpage + unreadBySegment.portal;

  const firstOfSegment = (s: Segment): string | null => {
    const list = chat.conversations
      .filter((c) => (s === "landpage" ? c.origin === "landpage" : c.origin !== "landpage"))
      .sort((a, b) => +new Date(b.lastMessageAt) - +new Date(a.lastMessageAt));
    return list[0]?.id ?? null;
  };

  const confirmArchiveConversation = async () => {
    const id = chat.activeId;
    if (!id || archiving) return;
    setArchiving(true);
    setArchiveError(null);
    try {
      const ok = await chat.setArchived(id, true);
      if (!ok) {
        setArchiveError("Não foi possível arquivar (sem permissão ou backend indisponível).");
        return;
      }
      setConfirmArchive(false);
      // A conversa saiu da fila: seleciona a próxima do segmento.
      chat.setActiveId(firstOfSegment(segment));
    } finally {
      setArchiving(false);
    }
  };

  const restoreConversation = useCallback(
    async (id: string) => {
      const item = chat.archived.find((c) => c.id === id) ?? null;
      setRestoringId(id);
      setArchiveError(null);
      try {
        const ok = await chat.setArchived(id, false);
        if (!ok) {
          setArchiveError("Não foi possível restaurar (sem permissão ou backend indisponível).");
          return;
        }
        setDrawerOpen(false);
        if (item) setSegment(item.origin === "landpage" ? "landpage" : "portal");
        chat.setActiveId(id);
        setMobileChat(true);
      } finally {
        setRestoringId(null);
      }
    },
    [chat.archived, chat.setArchived, chat.setActiveId]
  );

  // Callbacks estáveis p/ a gaveta: o pai re-renderiza a cada poll/SSE e
  // closures novas reiniciariam os efeitos dela (flicker + reset da seleção).
  // `chat.reloadArchived` já é estável no hook; `restoreConversation` acima
  // só muda quando a lista de arquivados muda (não entra em efeito da gaveta).
  const openArchiveDrawer = useCallback(() => {
    setArchiveError(null);
    setDrawerOpen(true);
  }, []);
  const closeArchiveDrawer = useCallback(() => setDrawerOpen(false), []);
  const reloadArchivedDrawer = useCallback(() => void chat.reloadArchived(), [chat.reloadArchived]);
  const restoreConversationCb = useCallback((id: string) => void restoreConversation(id), [restoreConversation]);

  return (
    <div className="flex h-[calc(100dvh-104px)] max-lg:h-[calc(100dvh-88px)] flex-col overflow-hidden">
      {/* Topo compacto — sem grupos de botões; só título + presença */}
      <div className="flex shrink-0 items-center gap-3 pb-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-base bg-accentsoft" aria-hidden="true">
          <Headset size={20} strokeWidth={1.75} className="text-accent" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-title-page text-text1">Atendimento</h1>
            {totalUnread > 0 && (
              <span
                className="tnum inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-micro text-accentink"
                aria-label={`${totalUnread} mensagens não lidas no total`}
              >
                {totalUnread > 99 ? "99+" : totalUnread}
              </span>
            )}
          </div>
          <p className="flex items-center gap-1.5 text-caption text-text2" role="status">
            <span className={cn("inline-block h-2 w-2 rounded-full", chat.connected ? "bg-ok" : "bg-warn")} aria-hidden="true" />
            {chat.connected ? "tempo real ativo" : "reconectando…"}
            <span aria-hidden="true" className="text-text3">·</span>
            <span className="truncate">
              {counts.landpage} landpage · {counts.portal} clientes
            </span>
          </p>
        </div>
        {canArchive && (
          <button
            type="button"
            onClick={openArchiveDrawer}
            aria-label={`Abrir arquivados, ${chat.archived.length} conversa(s)`}
            title="Arquivados — conversas fora da fila (só admin/manager)"
            className="inline-flex h-10 shrink-0 items-center gap-2 rounded-full border border-line2 px-3.5 text-callout text-text1 transition-colors duration-150 hover:bg-bg2"
          >
            <Archive size={16} strokeWidth={1.75} aria-hidden="true" />
            Arquivados
            {chat.archived.length > 0 && (
              <span className="tnum inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-accentsoft px-1.5 text-micro text-text1" aria-hidden="true">
                {chat.archived.length > 99 ? "99+" : chat.archived.length}
              </span>
            )}
          </button>
        )}
      </div>

      {archiveError && (
        <p role="alert" className="mb-3 shrink-0 rounded-base border border-line2 bg-bg1 px-3 py-2 text-callout text-danger">
          {archiveError}
        </p>
      )}

      {chat.degraded && (
        <p role="alert" className="mb-3 shrink-0 rounded-base border border-line2 bg-bg1 px-3 py-2 text-callout text-text2">
          Backend indisponível — exibindo fila local. Mensagens aqui ficam só nesta sessão.
        </p>
      )}

      {/* Moldura WhatsApp: altura travada, só colunas internas rolam */}
      <div className="grid min-h-0 flex-1 overflow-hidden rounded-card border border-line1 bg-bg1 shadow-1 lg:grid-cols-[340px_minmax(0,1fr)]">
        {/* ── Fila (esquerda) ─────────────────────────────────────────── */}
        <section
          aria-label="Conversas"
          className={cn("min-h-0 flex-col bg-bg1 lg:flex", mobileChat ? "hidden" : "flex")}
        >
          <div className="shrink-0 space-y-2.5 border-b border-line1 p-3">
            {/* Busca */}
            <div className="relative">
              <Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-text3" />
              <label htmlFor="fila-busca" className="sr-only">
                Buscar na fila
              </label>
              <input
                id="fila-busca"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setQuery("");
                }}
                placeholder="Buscar nome, e-mail, assunto…"
                maxLength={80}
                autoComplete="off"
                className="h-10 w-full rounded-full border border-line2 bg-bg0 pl-9 pr-9 text-body text-text1 placeholder:text-text3 focus:border-accent focus:outline-none"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  aria-label="Limpar busca"
                  className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-text2 hover:bg-bg1 hover:text-text1"
                >
                  <X size={15} aria-hidden="true" />
                </button>
              )}
            </div>

            {/* Toggle segmentado verdadeiro — troca de seção, não filtro */}
            <div
              role="radiogroup"
              aria-label="Origem do contato"
              className="relative grid grid-cols-2 gap-0 rounded-full border border-line1 bg-bg0 p-1"
              onKeyDown={(e) => {
                if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "Home" && e.key !== "End") return;
                e.preventDefault();
                const order: Segment[] = ["landpage", "portal"];
                let ix = order.indexOf(segment);
                if (e.key === "ArrowRight") ix = (ix + 1) % 2;
                if (e.key === "ArrowLeft") ix = (ix + 1) % 2;
                if (e.key === "Home") ix = 0;
                if (e.key === "End") ix = 1;
                pickSegment(order[ix]);
              }}
            >
              {SEGMENTS.map((s) => {
                const checked = segment === s.id;
                const Icon = s.id === "landpage" ? Globe : Users;
                const unread = unreadBySegment[s.id];
                return (
                  <button
                    key={s.id}
                    type="button"
                    role="radio"
                    aria-checked={checked}
                    aria-label={`${s.label}, ${counts[s.id]} conversas, ${unread} não lidas — ${s.hint}`}
                    tabIndex={checked ? 0 : -1}
                    onClick={() => pickSegment(s.id)}
                    className={cn(
                      "relative flex h-9 items-center justify-center gap-1.5 rounded-full text-callout outline-none transition-colors duration-150",
                      checked ? "font-semibold text-text1" : "font-normal text-text2 hover:text-text1"
                    )}
                  >
                    {checked && (
                      <motion.span
                        layoutId="atendimento-segment"
                        aria-hidden="true"
                        transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 480, damping: 36 }}
                        className="absolute inset-0 rounded-full bg-bg2 shadow-1 ring-1 ring-line1"
                      />
                    )}
                    <Icon size={15} strokeWidth={checked ? 2.25 : 1.75} aria-hidden="true" className="relative" />
                    <span className="relative">{s.label}</span>
                    <span className="tnum relative text-caption" aria-hidden="true">
                      {counts[s.id]}
                    </span>
                    {unread > 0 && (
                      <span
                        className="tnum relative inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-micro text-accentink"
                        aria-hidden="true"
                      >
                        {unread > 99 ? "99+" : unread}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Lista */}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain" role="listbox" aria-label={`Fila — ${segment === "landpage" ? "landpage" : "clientes"}`}>
            {visible.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
                <Inbox className="h-8 w-8 text-text3" aria-hidden="true" />
                <p className="text-headline text-text1">
                  {query ? `Nada para “${query.trim()}”` : "Nenhuma conversa"}
                </p>
                <p className="text-callout text-text2">
                  {query
                    ? `Nenhum contato de ${segment === "landpage" ? "landpage" : "clientes"} combina com a busca.`
                    : segment === "landpage"
                      ? "Novos contatos da landpage aparecem aqui na hora."
                      : "Contatos de clientes logados aparecem aqui na hora."}
                </p>
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    className="mt-1 inline-flex h-9 items-center rounded-full border border-line2 px-3 text-callout text-text1 hover:bg-bg2"
                  >
                    Limpar busca
                  </button>
                )}
              </div>
            ) : (
              <ul className="flex flex-col" role="presentation">
                <AnimatePresence initial={false}>
                  {visible.map((c) => {
                    const isActive = c.id === chat.activeId;
                    const t = timeOf(c.lastMessageAt);
                    return (
                      <motion.li
                        key={c.id}
                        role="presentation"
                        initial={reduce ? false : { opacity: 0, y: 5 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.15 }}
                      >
                        <button
                          type="button"
                          role="option"
                          aria-selected={isActive}
                          aria-label={`${c.visitorName}, ${c.unreadAgent > 0 ? `${c.unreadAgent} não lidas, ` : ""}${c.triage?.label ?? "sem triagem"}`}
                          onClick={() => pickConversation(c.id)}
                          className={cn(
                            "relative flex w-full items-center gap-3 border-b border-line1 px-3 py-3 text-left transition-colors duration-150",
                            isActive ? "bg-bg2" : "hover:bg-bg2/60"
                          )}
                        >
                          <span
                            aria-hidden="true"
                            className={cn(
                              "absolute inset-y-0 left-0 w-[3px] rounded-full transition-opacity",
                              isActive ? "bg-accent opacity-100" : "opacity-0"
                            )}
                          />
                          <span className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accentsoft text-headline text-text1" aria-hidden="true">
                            {initialsOf(c.visitorName)}
                            <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-bg1 bg-ok" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-baseline gap-2">
                              <span className={cn("min-w-0 flex-1 truncate", c.unreadAgent > 0 ? "font-bold text-text1" : "font-semibold text-text1")}>
                                {c.visitorName}
                              </span>
                              {t && (
                                <time className={cn("tnum shrink-0 text-caption", c.unreadAgent > 0 ? "font-semibold text-accent" : "text-text3")}>
                                  {t}
                                </time>
                              )}
                            </span>
                            <span className="mt-0.5 flex items-center gap-2">
                              <span className={cn("min-w-0 flex-1 truncate text-callout", c.unreadAgent > 0 ? "font-semibold text-text1" : "text-text2")}>
                                {c.triage ? `${c.triage.label} · ` : ""}
                                {c.visitorEmail || (segment === "landpage" ? "landpage" : "área do cliente")}
                              </span>
                              {c.unreadAgent > 0 && (
                                <span
                                  className="tnum inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-accent px-1.5 text-micro text-accentink"
                                  aria-label={`${c.unreadAgent} não lidas`}
                                >
                                  {c.unreadAgent > 99 ? "99+" : c.unreadAgent}
                                </span>
                              )}
                            </span>
                          </span>
                        </button>
                      </motion.li>
                    );
                  })}
                </AnimatePresence>
              </ul>
            )}
          </div>
        </section>

        {/* ── Conversa (direita) ──────────────────────────────────────── */}
        <section
          aria-label={shown ? `Conversa com ${shown.visitorName}` : "Conversa"}
          className={cn("relative min-h-0 min-w-0 flex-col bg-bg0", mobileChat ? "flex" : "hidden lg:flex")}
        >
          {!shown ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-accentsoft" aria-hidden="true">
                <Headset size={28} strokeWidth={1.5} className="text-accent" />
              </span>
              <p className="text-section text-text1">Suas conversas ficam aqui</p>
              <p className="max-w-sm text-callout text-text2">
                Escolha uma conversa de {segment === "landpage" ? "landpage" : "clientes"} na lista
                para responder em tempo real, com histórico e digitação ao vivo.
              </p>
            </div>
          ) : (
            <>
              {/* Header da conversa */}
              <header className="flex h-16 shrink-0 items-center gap-3 border-b border-line1 bg-bg1 px-3 sm:px-4">
                <button
                  type="button"
                  onClick={() => setMobileChat(false)}
                  aria-label="Voltar para a lista"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-text2 hover:bg-bg0 hover:text-text1 lg:hidden"
                >
                  <ArrowLeft size={20} aria-hidden="true" />
                </button>
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accentsoft text-headline text-text1" aria-hidden="true">
                  {initialsOf(shown.visitorName)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-headline text-text1">{shown.visitorName}</p>
                  <p className="truncate text-caption text-text2" role="status">
                    {chat.typingVisitor
                      ? "digitando…"
                      : `${shown.visitorEmail || "sem e-mail"} · ${shown.triage?.label ?? "sem triagem"} · ${shown.origin === "landpage" ? "landpage" : "cliente"}`}
                  </p>
                </div>
                <label className="sr-only" htmlFor="conversa-status">
                  Estado da conversa
                </label>
                {canArchive && (
                  <button
                    type="button"
                    onClick={() => {
                      setArchiveError(null);
                      setConfirmArchive(true);
                    }}
                    aria-label={`Arquivar conversa com ${shown.visitorName}`}
                    title="Arquivar — tira da fila, mantém p/ auditoria (só admin/manager)"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-text2 transition-colors duration-150 hover:bg-bg0 hover:text-danger"
                  >
                    <Trash2 size={17} strokeWidth={1.75} aria-hidden="true" />
                  </button>
                )}
                <select
                  id="conversa-status"
                  value={shown.status}
                  onChange={(e) => void chat.setStatus(e.target.value as typeof shown.status)}
                  aria-label="Estado da conversa"
                  title="Estado da conversa"
                  className="h-9 shrink-0 cursor-pointer rounded-full border border-line2 bg-bg0 px-2.5 text-callout capitalize text-text1 focus:border-accent focus:outline-none"
                >
                  {Object.entries(STATUS_LABEL).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </header>

              {/* Mensagens */}
              <div
                ref={scrollRef}
                role="log"
                aria-live="polite"
                aria-label={`Mensagens de ${shown.visitorName}`}
                className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4 sm:px-5 lg:px-8"
                style={{
                  backgroundImage: "radial-gradient(var(--border-1) 0.8px, transparent 0.8px)",
                  backgroundSize: "20px 20px",
                }}
              >
                <div className="mx-auto flex max-w-3xl flex-col gap-1.5">
                  <p className="mb-2 self-center rounded-full border border-line1 bg-bg1 px-3 py-1 text-center text-caption text-text2 shadow-1">
                    {shown.origin === "landpage" ? "Contato via landpage" : "Contato via área do cliente"} · tempo real
                  </p>
                  {chat.messages.map((m) => {
                    const mine = m.sender === "agent";
                    return (
                      <motion.div
                        key={m.id}
                        initial={reduce ? false : { opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.15 }}
                        className={cn("flex w-full", mine ? "justify-end" : "justify-start")}
                      >
                        <div
                          className={cn(
                            "min-w-[120px] max-w-[80%] px-3 pb-1.5 pt-2 shadow-1 sm:max-w-[75%]",
                            mine
                              ? "rounded-2xl rounded-br-sm bg-accent text-accentink"
                              : "rounded-2xl rounded-bl-sm border border-line1 bg-bg2 text-text1"
                          )}
                        >
                          {!mine && <p className="text-micro font-semibold text-accent">{m.authorName}</p>}
                          <p className="whitespace-pre-wrap break-words text-body">{m.body}</p>
                          <p className={cn("mt-1 flex items-center justify-end gap-1 text-caption", mine ? "text-accentink/80" : "text-text3")}>
                            <time dateTime={m.createdAt}>{timeOf(m.createdAt)}</time>
                            {mine && <Ticks status={m.status} />}
                          </p>
                        </div>
                      </motion.div>
                    );
                  })}
                  {chat.typingVisitor && (
                    <div className="flex justify-start" role="status" aria-label={`${shown.visitorName} está digitando`}>
                      <div className="flex items-center gap-1.5 rounded-2xl rounded-bl-sm border border-line1 bg-bg2 px-3.5 py-3 shadow-1">
                        {[0, 1, 2].map((i) => (
                          <motion.span
                            key={i}
                            aria-hidden="true"
                            className="h-1.5 w-1.5 rounded-full bg-text2"
                            animate={reduce ? undefined : { opacity: [0.3, 1, 0.3], y: [0, -3, 0] }}
                            transition={{ duration: 1.1, repeat: Infinity, delay: i * 0.18 }}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Composer */}
              <form
                className="shrink-0 border-t border-line1 bg-bg1 px-3 py-3 sm:px-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  void send();
                }}
              >
                <div className="mx-auto flex max-w-3xl items-center gap-2">
                  <label htmlFor="admin-chat-input" className="sr-only">
                    Responder {shown.visitorName}
                  </label>
                  <input
                    id="admin-chat-input"
                    value={draft}
                    onChange={(e) => {
                      setDraft(e.target.value);
                      notifyTyping();
                    }}
                    placeholder={`Responder ${shown.visitorName}…`}
                    maxLength={2000}
                    autoComplete="off"
                    className="h-11 min-w-0 flex-1 rounded-full border border-line2 bg-bg0 px-4 text-body text-text1 placeholder:text-text3 focus:border-accent focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={!draft.trim() || sending}
                    aria-label="Enviar resposta"
                    className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent text-accentink transition-transform duration-150 active:scale-95 disabled:opacity-40"
                  >
                    <SendHorizonal className="h-5 w-5" aria-hidden="true" />
                  </button>
                </div>
              </form>
            </>
          )}
        </section>
      </div>

      {canArchive && (
        <ArchivedDrawer
          open={drawerOpen}
          onClose={closeArchiveDrawer}
          items={chat.archived}
          onReload={reloadArchivedDrawer}
          onRestore={restoreConversationCb}
          restoringId={restoringId}
        />
      )}

      <Dialog
        open={confirmArchive && !!shown}
        onClose={() => {
          if (!archiving) setConfirmArchive(false);
        }}
        title="Arquivar conversa"
        size="sm"
        pending={archiving}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setConfirmArchive(false)}
              disabled={archiving}
              title={archiving ? "Aguarde…" : "Voltar"}
            >
              Voltar
            </Button>
            <Button
              variant="primary"
              onClick={() => void confirmArchiveConversation()}
              loading={archiving}
              loadingLabel="Arquivando…"
              title={archiving ? "Arquivando…" : "Arquivar conversa"}
            >
              Arquivar conversa
            </Button>
          </>
        }
      >
        <p className="m-0 text-body text-text2">
          {shown
            ? `“${shown.visitorName}” sai da fila, mas fica preservada nos Arquivados para auditoria — dá para ver e restaurar quando quiser.`
            : "A conversa sai da fila, mas fica preservada nos Arquivados."}
        </p>
      </Dialog>
    </div>
  );
}
