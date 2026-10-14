"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { MOCK_ORGANIZATIONS } from "@/lib/mocks";
import { useOrgStore } from "@/stores/org-store";
import { useMe } from "@/lib/auth/permissions";

/**
 * Seletor de organização (stub). Escopa telas por org — permissão real validada
 * no backend por `organization_id` (PROJECT §3). Menu opaco bg-2 + shadow-2, z-40.
 */
export function OrgSwitcher() {
  const { me } = useMe();
  const { orgId, setOrgId } = useOrgStore();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const activeId = orgId ?? me?.organizationId ?? MOCK_ORGANIZATIONS[0].id;
  const active = MOCK_ORGANIZATIONS.find((o) => o.id === activeId) ?? MOCK_ORGANIZATIONS[0];

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
  }, [open ]);

  return (
    <div className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Trocar organização"
        onClick={() => (open ? setOpen(false) : setOpen(true))}
        className="focus-ring flex h-11 items-center gap-2 rounded-base border border-line2 bg-bg2 px-3 text-callout text-text1"
      >
        <span className="max-w-40 truncate">{active.name}</span>
        <ChevronDown size={16} strokeWidth={1.5} aria-hidden="true" className="shrink-0 text-text2" />
      </button>
      {open && (
        <div
          ref={panelRef}
          role="listbox"
          aria-label="Organizações"
          className="absolute right-0 top-full z-40 mt-1 min-w-56 border border-line1 bg-bg2 p-2 shadow-2"
          style={{ borderRadius: 12 }}
        >
          {MOCK_ORGANIZATIONS.map((o) => (
            <button
              key={o.id}
              type="button"
              role="option"
              aria-selected={o.id === activeId}
              onClick={() => {
                setOrgId(o.id);
                setOpen(false);
                triggerRef.current?.focus();
              }}
              className="focus-ring flex min-h-11 w-full items-center justify-between gap-2 rounded-base px-3 text-left text-callout text-text1 hover:bg-bg1"
            >
              <span className="truncate">{o.name}</span>
              {o.id === activeId && <Check size={16} strokeWidth={1.5} aria-hidden="true" className="shrink-0 text-accent" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
