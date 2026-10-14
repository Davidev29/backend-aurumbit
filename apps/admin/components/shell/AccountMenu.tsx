"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, CircleUserRound, LogOut, UserRound } from "lucide-react";
import { useMe } from "@/lib/auth/permissions";
import { initialsOf, useProfileStore } from "@/stores/profile-store";

/** Menu da conta: identidade + saída (POST /api/auth/logout). Menu opaco bg-2 + shadow-2, z-40. */
export function AccountMenu() {
  const { me } = useMe();
  const fotoPreviewUrl = useProfileStore((s) => s.fotoPreviewUrl);
  const nomeExibicao = useProfileStore((s) => s.nomeExibicao);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const displayName = nomeExibicao || me?.name || "Conta";

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    router.push("/login");
    router.refresh();
  };

  useEffect(() => {
    if (!open) return;
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
  }, [open]);

  return (
    <div className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Menu da conta"
        onClick={() => (open ? (setOpen(false), triggerRef.current?.blur()) : setOpen(true))}
        className="focus-ring flex h-11 items-center gap-2 rounded-base border border-line2 bg-bg2 px-3 text-callout text-text1"
      >
        {fotoPreviewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={fotoPreviewUrl}
            alt=""
            aria-hidden="true"
            className="h-6 w-6 shrink-0 rounded-full object-cover"
          />
        ) : (
          <CircleUserRound size={20} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-text2" />
        )}
        <span className="max-w-32 truncate max-xl:hidden">{displayName}</span>
        <ChevronDown size={16} strokeWidth={1.5} aria-hidden="true" className="shrink-0 text-text2" />
      </button>
      {open && (
        <div
          ref={panelRef}
          role="menu"
          aria-label="Conta"
          className="absolute right-0 top-full z-40 mt-1 min-w-56 border border-line1 bg-bg2 p-2 shadow-2"
          style={{ borderRadius: 12 }}
        >
          <div className="flex items-center gap-2 px-3 py-2">
            <span
              aria-hidden="true"
              className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-accentsoft text-callout font-bold text-text1"
            >
              {fotoPreviewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={fotoPreviewUrl} alt="" aria-hidden="true" className="h-full w-full object-cover" />
              ) : (
                initialsOf(displayName)
              )}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-callout font-semibold text-text1">{displayName}</span>
              <span className="block truncate text-caption text-text2">{me?.email ?? ""}</span>
            </span>
          </div>
          <Link
            href="/perfil"
            role="menuitem"
            onClick={() => setOpen(false)}
            aria-label="Abrir meu perfil"
            className="focus-ring flex min-h-11 w-full items-center gap-2 rounded-base px-3 text-left text-callout text-text1 no-underline hover:bg-bg1"
          >
            <UserRound size={16} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
            Meu perfil
          </Link>
          <div aria-hidden="true" className="mx-3 my-1 h-px bg-line1" />
          <button
            type="button"
            role="menuitem"
            onClick={logout}
            className="focus-ring flex min-h-11 w-full items-center gap-2 rounded-base px-3 text-left text-callout text-danger hover:bg-bg1"
          >
            <LogOut size={16} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
            Sair
          </button>
        </div>
      )}
    </div>
  );
}
