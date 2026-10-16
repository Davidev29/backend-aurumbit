"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  Bell,
  Box,
  ChevronsLeft,
  ChevronsRight,
  Headset,
  KeyRound,
  Landmark,
  LayoutDashboard,
  ListOrdered,
  Package,
  ReceiptText,
  ScrollText,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useCan, useMe } from "@/lib/auth/permissions";
import { COOKIE_NAME, useSidebarStore } from "@/stores/sidebar-store";
import { useProfileStore } from "@/stores/profile-store";
import { cn } from "@/lib/cn";

export interface NavBadge {
  count: number;
  /** Texto de contexto p/ aria-label (ex.: "12 vencidas"). */
  context: string;
  tone: "accent" | "danger";
}

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  perm?: string;
  badge?: NavBadge;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

/**
 * Rotas em pt-BR por permissão backend (default deny).
 * Hrefs preservados: /dashboard /clientes /usuarios /cobrancas /assinaturas /auditoria /financeiro /filas.
 */
const GROUPS: NavGroup[] = [
  {
    label: "Principal",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/clientes", label: "Clientes", icon: Users, perm: "customer.read" },
      { href: "/cobrancas", label: "Cobranças", icon: ReceiptText, perm: "billing.read" },
      // Ponte portal ↔ admin: fila em tempo real (leitura aberta como Produtos;
      // o backend protege mutações por sessão; sem `perm` p/ aparecer no mock).
      { href: "/atendimento", label: "Atendimento", icon: Headset },
    ],
  },
  {
    label: "Operação",
    items: [
      { href: "/financeiro", label: "Financeiro", icon: Landmark, perm: "finance.read" },
      { href: "/notificacoes", label: "Notificações", icon: Bell, perm: "finance.read" },
      { href: "/filas", label: "Filas", icon: ListOrdered, perm: "billing.manage" },
      { href: "/assinaturas", label: "Assinaturas", icon: Package, perm: "billing.read" },
      // Leitura aberta como o catálogo (sem `perm`); mutações exigem `product.manage`.
      { href: "/produtos", label: "Produtos", icon: Box },
    ],
  },
  {
    label: "Sistema",
    items: [
      { href: "/auditoria", label: "Auditoria", icon: ScrollText, perm: "billing.read" },
      { href: "/usuarios", label: "Usuários", icon: KeyRound, perm: "user.read" },
    ],
  },
];

export function isActiveRoute(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function formatCount(n: number): string {
  return n > 99 ? "99+" : String(n);
}

/** Ícone canônico: lucide 20px, stroke 1.75, currentColor (DS §4). */
function ItemIcon({ icon: Icon, active }: { icon: LucideIcon; active: boolean }) {
  return (
    <Icon
      size={20}
      strokeWidth={active ? 2.25 : 1.75}
      aria-hidden="true"
      focusable="false"
      className="shrink-0"
    />
  );
}

/** Menu lateral filtrado por permissões do backend (default deny). */
export function Sidebar() {
  const collapsed = useSidebarStore((s) => s.collapsed);
  const toggleCollapsed = useSidebarStore((s) => s.toggleCollapsed);
  const setCollapsed = useSidebarStore((s) => s.setCollapsed);
  const { me } = useMe();
  const fotoPreviewUrl = useProfileStore((s) => s.fotoPreviewUrl);
  const nomeExibicao = useProfileStore((s) => s.nomeExibicao);

  // Colapso persistido: cookie `ab_sidebar` (SSR/leitura rápida) + localStorage (store).
  useEffect(() => {
    try {
      const m = document.cookie.match(/(?:^|;\s*)ab_sidebar=([^;]*)/);
      if (m) setCollapsed(m[1] === "collapsed");
    } catch {
      /* noop */
    }
  }, [setCollapsed]);
  useEffect(() => {
    try {
      document.cookie = `${COOKIE_NAME}=${collapsed ? "collapsed" : "expanded"}; path=/; max-age=31536000; SameSite=Lax`;
    } catch {
      /* noop */
    }
  }, [collapsed]);

  const displayName = nomeExibicao || me?.name || "Conta";
  const initials = displayName.trim().charAt(0).toUpperCase() || "A";

  return (
    <aside
      data-collapsed={collapsed}
      className={cn(
        "glass-chrome sticky top-0 z-30 flex h-dvh shrink-0 flex-col rounded-none border-0 border-r border-line1 max-lg:hidden",
        collapsed ? "w-16" : "w-72",
      )}
    >
      {/* Brand 64px — logomarca oficial Aurum Bit */}
      <div
        className={cn(
          "flex h-16 shrink-0 items-center gap-3 border-b border-line1 px-4",
          collapsed && "justify-center px-2",
        )}
      >
        {collapsed ? (
          <span title="Aurum Admin" className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-base bg-accentsoft">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/logo.png" alt="" aria-hidden="true" className="h-8 w-8 object-contain" />
          </span>
        ) : (
          <span className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-base bg-accentsoft">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/logo.png" alt="Aurum Bit" className="h-10 w-10 object-contain" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-headline text-text1">Aurum Admin</span>
              <span className="block truncate text-micro font-normal normal-case tracking-normal text-text2">
                Terminal administrativo
              </span>
            </span>
          </span>
        )}
      </div>

      <nav aria-label="Navegação principal" className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 pt-3">
        <NavLinks collapsed={collapsed} />
      </nav>

      <div className={cn("shrink-0 p-3", collapsed && "flex justify-center")}>
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label={collapsed ? "Expandir menu" : "Recolher menu"}
          aria-expanded={!collapsed}
          title={collapsed ? "Expandir" : "Recolher"}
          className="focus-ring flex h-11 w-11 items-center justify-center rounded-base border border-line2 text-text2 hover:text-text1"
        >
          {collapsed ? (
            <ChevronsRight size={20} strokeWidth={1.75} aria-hidden="true" />
          ) : (
            <ChevronsLeft size={20} strokeWidth={1.75} aria-hidden="true" />
          )}
        </button>
      </div>

      {/* Rodapé do usuário: min-h 64px, avatar 32px + nome headline truncado → abre /perfil */}
      <Link
        href="/perfil"
        title="Abrir meu perfil"
        aria-label="Abrir meu perfil"
        className="focus-ring flex min-h-16 shrink-0 items-center gap-3 border-t border-line1 p-3 no-underline hover:bg-bg2"
      >
        <span
          aria-hidden="true"
          title={collapsed ? displayName : undefined}
          className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-accentsoft text-headline text-text1"
        >
          {fotoPreviewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={fotoPreviewUrl} alt="" aria-hidden="true" className="h-full w-full object-cover" />
          ) : (
            initials
          )}
        </span>
        {!collapsed && (
          <span className="min-w-0 flex-1">
            <span className="block truncate text-headline text-text1">{displayName}</span>
            <span className="block truncate text-caption text-text2">{me?.email ?? ""}</span>
          </span>
        )}
      </Link>
    </aside>
  );
}

export function NavLinks({
  pathname: pathnameProp,
  onNavigate,
  collapsed = false,
  tall = false,
}: {
  pathname?: string;
  onNavigate?: () => void;
  collapsed?: boolean;
  /** Drawer mobile: item 44px (dedo > mouse). Desktop: 40px + 4px gap = pitch 44px. */
  tall?: boolean;
}) {
  const fallbackPathname = usePathname();
  const pathname = pathnameProp ?? fallbackPathname ?? "";
  const reduceMotion = useReducedMotion();
  const navRef = useRef<HTMLDivElement>(null);

  const canCustomer = useCan("customer.read");
  const canUser = useCan("user.read");
  const canFinance = useCan("finance.read");
  const canBilling = useCan("billing.read");
  const canManageBilling = useCan("billing.manage");

  const allowed = (item: NavItem): boolean => {
    if (item.perm === "customer.read") return canCustomer;
    if (item.perm === "user.read") return canUser;
    if (item.perm === "finance.read") return canFinance;
    if (item.perm === "billing.manage") return canManageBilling;
    if (item.perm === "billing.read") return canBilling;
    return true;
  };

  const visible = useMemo(
    () =>
      GROUPS.map((g) => ({ ...g, items: g.items.filter(allowed) })).filter((g) => g.items.length > 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canCustomer, canUser, canFinance, canBilling, canManageBilling],
  );
  const flat = useMemo(() => visible.flatMap((g) => g.items), [visible]);

  // Roving tabindex: 1 parada de Tab na nav; setas/Home/End movem; Esc desfoca (DS §8).
  const [focusIx, setFocusIx] = useState(() => {
    const ix = flat.findIndex((i) => isActiveRoute(pathname, i.href));
    return ix >= 0 ? ix : 0;
  });
  useEffect(() => {
    setFocusIx((prev) => Math.min(prev, Math.max(flat.length - 1, 0)));
  }, [flat.length]);

  let cursor = -1;
  const onKeyDown = (e: React.KeyboardEvent) => {
    const links = Array.from(navRef.current?.querySelectorAll<HTMLAnchorElement>("a") ?? []);
    if (links.length === 0) return;
    const current = links.indexOf(document.activeElement as HTMLAnchorElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Home" || e.key === "End") {
      e.preventDefault();
      const next =
        e.key === "Home"
          ? 0
          : e.key === "End"
            ? links.length - 1
            : (current + (e.key === "ArrowDown" ? 1 : -1) + links.length) % links.length;
      setFocusIx(next);
      links[next]?.focus();
      links[next]?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Escape") {
      (document.activeElement as HTMLElement | null)?.blur?.();
    }
  };

  return (
    <div ref={navRef} onKeyDown={onKeyDown} className="flex flex-col gap-5">
      {visible.map((group, gi) => (
        <section key={group.label} aria-label={group.label}>
          {collapsed ? (
            gi > 0 && (
              <div className="flex justify-center py-1" aria-hidden="true">
                <span className="h-px w-6 bg-line2" />
              </div>
            )
          ) : (
            <p aria-hidden="true" className="m-0 px-3 pb-1 pt-1 text-micro font-bold uppercase tracking-wider text-text2">
              {group.label}
            </p>
          )}
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {group.items.map((item) => {
              cursor += 1;
              const ix = cursor;
              const active = isActiveRoute(pathname, item.href);
              const badgeText =
                item.badge && item.badge.count > 0
                  ? `${formatCount(item.badge.count)} ${item.badge.context}`
                  : null;
              return (
                <li key={item.href} className="m-0 p-0">
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    aria-label={badgeText ? `${item.label}, ${badgeText}` : undefined}
                    title={collapsed ? (badgeText ? `${item.label} — ${badgeText}` : item.label) : undefined}
                    tabIndex={ix === focusIx ? 0 : -1}
                    onFocus={() => setFocusIx(ix)}
                    onClick={onNavigate}
                    className={cn(
                      "focus-ring relative flex items-center gap-3 rounded-base px-3 text-body no-underline transition-colors duration-100",
                      tall ? "h-11" : "h-10",
                      collapsed && "justify-center px-0",
                      active
                        ? "font-semibold text-text1"
                        : "font-normal text-text2 hover:bg-bg2 hover:text-text1",
                    )}
                  >
                    {active &&
                      (reduceMotion ? (
                        <span aria-hidden="true" className="absolute inset-0 rounded-base bg-accentsoft" />
                      ) : (
                        <motion.span
                          layoutId="sidebar-active-pill"
                          aria-hidden="true"
                          transition={{ type: "spring", stiffness: 500, damping: 35 }}
                          className="absolute inset-0 rounded-base bg-accentsoft"
                        />
                      ))}
                    {active && (
                      <span
                        aria-hidden="true"
                        className="absolute bottom-2 left-0 top-2 w-[3px] rounded-full bg-accent"
                      />
                    )}
                    <span className="relative flex shrink-0 items-center">
                      <ItemIcon icon={item.icon} active={active} />
                      {collapsed && badgeText && (
                        <span
                          aria-hidden="true"
                          className={cn(
                            "absolute -right-1 -top-1 h-2 w-2 rounded-full",
                            item.badge?.tone === "danger" ? "bg-danger" : "bg-accent",
                          )}
                        />
                      )}
                    </span>
                    {!collapsed && (
                      <>
                        <span className="relative flex-1 truncate">{item.label}</span>
                        {badgeText && (
                          <span
                            aria-hidden="true"
                            className={cn(
                              "tnum relative inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-micro",
                              item.badge?.tone === "danger"
                                ? "bg-dangersoft text-danger"
                                : "bg-accentsoft text-accent",
                            )}
                          >
                            {formatCount(item.badge!.count)}
                          </span>
                        )}
                      </>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
