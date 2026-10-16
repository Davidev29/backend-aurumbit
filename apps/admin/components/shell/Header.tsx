"use client";

import { usePathname } from "next/navigation";
import { Menu, Moon, Sun } from "lucide-react";
import { useSidebarStore } from "@/stores/sidebar-store";
import { useTheme } from "@/lib/theme";
import { AccountMenu } from "./AccountMenu";
import { NotificationsBell } from "./NotificationsBell";
import { SearchCmdk } from "./SearchCmdk";

const TITLES: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/clientes": "Clientes",
  "/usuarios": "Usuários",
  "/cobrancas": "Cobranças",
  "/assinaturas": "Assinaturas",
  "/auditoria": "Auditoria",
  "/financeiro": "Financeiro",
  "/notificacoes": "Notificações",
  "/filas": "Filas",
  "/produtos": "Produtos",
  "/promocionais": "Promocionais",
  "/perfil": "Meu perfil",
};

function titleFor(pathname: string): string {
  for (const [href, title] of Object.entries(TITLES)) {
    if (pathname === href || pathname.startsWith(`${href}/`)) return title;
  }
  return "Aurum Admin";
}

/** Topbar 56px glass-chrome z-30: hamburger (<1024px) + breadcrumb + busca stub + tema + sino + avatar. */
export function Header() {
  const setMobileOpen = useSidebarStore((s) => s.setMobileOpen);
  const { theme, toggle } = useTheme();
  const pathname = usePathname() ?? "";
  const title = titleFor(pathname);

  return (
    <header
      role="banner"
      className="glass-chrome sticky top-0 z-30 flex h-14 items-center justify-between gap-3 rounded-none border-0 border-b border-line1 px-4 lg:px-6"
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <button
          type="button"
          aria-label="Abrir menu"
          onClick={() => setMobileOpen(true)}
          className="focus-ring flex h-11 w-11 shrink-0 items-center justify-center rounded-base border border-line2 text-text1 lg:hidden"
        >
          <Menu size={20} strokeWidth={1.75} aria-hidden="true" />
        </button>

        <nav aria-label="Caminho" className="min-w-0 shrink">
          <ol className="m-0 flex list-none items-center gap-2 p-0">
            <li aria-hidden="true" className="hidden text-micro font-normal uppercase tracking-wider text-text2 sm:block">
              Aurum
            </li>
            <li aria-hidden="true" className="hidden text-text2 sm:block">
              /
            </li>
            <li aria-current="page" className="truncate text-headline text-text1">
              {title}
            </li>
          </ol>
        </nav>
      </div>

      <div className="hidden w-full max-w-md flex-1 justify-center sm:flex">
        <div className="w-full max-w-md">
          <SearchCmdk />
        </div>
      </div>

      <div className="flex flex-1 items-center justify-end gap-3">
        <button
          type="button"
          onClick={toggle}
          aria-label={theme === "dark" ? "Alternar para tema claro" : "Alternar para tema escuro"}
          aria-pressed={theme === "dark"}
          title={theme === "dark" ? "Tema claro" : "Tema escuro"}
          className="focus-ring flex h-11 w-11 shrink-0 items-center justify-center rounded-base border border-line2 text-text1"
        >
          {theme === "dark" ? (
            <Sun size={20} strokeWidth={1.75} aria-hidden="true" />
          ) : (
            <Moon size={20} strokeWidth={1.75} aria-hidden="true" />
          )}
        </button>
        <NotificationsBell />
        <AccountMenu />
      </div>
    </header>
  );
}
