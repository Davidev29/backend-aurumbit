"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  LayoutDashboard,
  Monitor,
  Receipt,
  ShoppingCart,
  User,
  LogOut,
  Menu,
  X,
  LifeBuoy,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PortalProvider } from "@/lib/portal-context";
import { getMe, logout } from "@/lib/api";
import type { MeResponse } from "@/types";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

const navGroups: NavGroup[] = [
  {
    title: "Geral",
    items: [
      { href: "/dashboard", label: "Visão geral", icon: LayoutDashboard, exact: true },
      { href: "/dashboard/sistemas", label: "Meus sistemas", icon: Monitor },
    ],
  },
  {
    title: "Financeiro",
    items: [
      { href: "/dashboard/faturas", label: "Faturas", icon: Receipt },
      { href: "/dashboard/comprar", label: "Comprar", icon: ShoppingCart },
    ],
  },
  {
    title: "Conta",
    items: [{ href: "/dashboard/perfil", label: "Perfil", icon: User }],
  },
];

function isActive(pathname: string, item: NavItem): boolean {
  return item.exact ? pathname === item.href : pathname.startsWith(item.href);
}

function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [me, setMe] = useState<MeResponse | null>(null);

  useEffect(() => {
    getMe()
      .then(setMe)
      .catch(() => router.replace("/?login=1"));
  }, [router]);

  // Fecha o drawer com Escape e trava o scroll enquanto aberto.
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [mobileOpen]);

  const handleLogout = async () => {
    await logout().catch(() => null);
    router.replace("/");
  };

  const sidebar = (
    <div className="flex flex-col h-full">
      <Link href="/" className="flex items-center gap-2 px-6 py-5 border-b border-line2" aria-label="AurumBit - Início">
        <span className="font-display font-extrabold text-title-page text-gradient-gold">
          Aurum<span className="font-accent italic text-accent">Bit</span>
        </span>
      </Link>

      <nav className="flex-1 px-3 py-4 space-y-5 overflow-y-auto" aria-label="Área do cliente">
        {navGroups.map((group) => (
          <div key={group.title}>
            <p className="px-3 mb-1.5 text-micro uppercase tracking-widest text-text3">{group.title}</p>
            <ul className="space-y-1">
              {group.items.map((item) => {
                const active = isActive(pathname, item);
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={() => setMobileOpen(false)}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "relative flex items-center gap-3 px-3 py-2.5 rounded-base text-body font-medium transition-colors",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                        active
                          ? "bg-accent/10 text-accent"
                          : "text-text2 hover:text-text1 hover:bg-bg2"
                      )}
                    >
                      <span
                        aria-hidden="true"
                        className={cn(
                          "absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 rounded-full bg-gradient-gold transition-opacity",
                          active ? "opacity-100" : "opacity-0"
                        )}
                      />
                      <Icon className="w-5 h-5 flex-shrink-0" aria-hidden="true" />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}

        <div>
          <p className="px-3 mb-1.5 text-micro uppercase tracking-widest text-text3">Ajuda</p>
          <a
            href="mailto:suporte@aurumbit.com"
            className="flex items-center gap-3 px-3 py-2.5 rounded-base text-body font-medium text-text2 hover:text-text1 hover:bg-bg2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <LifeBuoy className="w-5 h-5 flex-shrink-0" aria-hidden="true" />
            Suporte
          </a>
        </div>
      </nav>

      <div className="p-4 border-t border-line2">
        <div className="glass-card p-3 mb-3" aria-label="Usuário logado">
          <p className="text-caption text-text3">Logado como</p>
          <p className="text-body font-semibold text-text1 truncate">{me?.name ?? "…"}</p>
          <p className="text-caption text-text2 truncate mono">{me?.email ?? ""}</p>
        </div>
        <button
          onClick={handleLogout}
          className="btn-ghost w-full justify-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <LogOut className="w-5 h-5" aria-hidden="true" />
          Sair
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-bg0 lg:flex">
      <a href="#conteudo" className="skip-link">
        Pular para o conteúdo
      </a>

      {/* Desktop sidebar */}
      <aside className="hidden lg:flex lg:w-72 lg:flex-col lg:fixed lg:inset-y-0 glass-chrome border-r border-line2" aria-label="Menu lateral">
        {sidebar}
      </aside>

      {/* Mobile topbar */}
      <header className="lg:hidden glass-chrome sticky top-0 z-[30] flex items-center justify-between px-4 h-16 border-b border-line2">
        <Link href="/" className="font-display font-extrabold text-title-page text-gradient-gold" aria-label="AurumBit - Início">
          Aurum<span className="font-accent italic text-accent">Bit</span>
        </Link>
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="p-2 rounded-base text-text2 hover:text-text1 hover:bg-bg2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          aria-expanded={mobileOpen}
          aria-label={mobileOpen ? "Fechar menu" : "Abrir menu"}
        >
          {mobileOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </header>

      <AnimatePresence>
        {mobileOpen && (
          <div className="lg:hidden fixed inset-0 z-[46]" role="dialog" aria-modal="true" aria-label="Menu">
            <motion.div
              className="absolute inset-0 bg-black/60"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMobileOpen(false)}
              aria-hidden="true"
            />
            <motion.div
              className="absolute left-0 top-0 h-full w-full max-w-xs bg-bg1 border-r border-line2"
              initial={{ x: -320 }}
              animate={{ x: 0 }}
              exit={{ x: -320 }}
              transition={{ type: "tween", duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            >
              {sidebar}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <main id="conteudo" className="flex-1 lg:pl-72" tabIndex={-1}>
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 py-8">
          <motion.div
            key={pathname}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
          >
            {children}
          </motion.div>
        </div>
      </main>
    </div>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <PortalProvider>
      <DashboardShell>{children}</DashboardShell>
    </PortalProvider>
  );
}
