"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { useCan } from "@/lib/auth/permissions";
import type { LicenseView } from "@/lib/types";
import { AdjustMachinesDialog } from "./dialogs/AdjustMachinesDialog";
import { BonusDialog } from "./dialogs/BonusDialog";
import { RenewDialog } from "./dialogs/RenewDialog";
import { RevokeDialog } from "./dialogs/RevokeDialog";

type OpenDialog = "adjust" | "bonus" | "renew" | "revoke" | null;

/**
 * Ações da licença. Botões desabilitados sem a permissão correspondente
 * (`license.adjust` / `bonus.grant`); a autorização real é do backend (403).
 * Cada diálogo também é envolvido em `RequirePerm`.
 */
export function LicenseActions({ license }: { license: LicenseView }) {
  const canAdjust = useCan("license.adjust");
  const canBonus = useCan("bonus.grant");
  const [open, setOpen] = useState<OpenDialog>(null);

  return (
    <span className="inline-flex flex-wrap gap-2">
      <Button
        type="button"
        variant="secondary"
        disabled={!canAdjust}
        title={canAdjust ? "Ajustar limite de máquinas" : "Requer permissão license.adjust"}
        onClick={() => setOpen("adjust")}
      >
        Ajustar
      </Button>
      <Button
        type="button"
        variant="secondary"
        disabled={!canBonus}
        title={canBonus ? "Conceder bônus de acesso" : "Requer permissão bonus.grant"}
        onClick={() => setOpen("bonus")}
      >
        Bônus
      </Button>
      <Button
        type="button"
        variant="secondary"
        disabled={!canAdjust}
        title={canAdjust ? "Renovar vigência (1M/12M)" : "Requer permissão license.adjust"}
        onClick={() => setOpen("renew")}
      >
        Renovar
      </Button>
      <Button
        type="button"
        variant="destructive"
        disabled={!canAdjust}
        title={canAdjust ? "Revogar licença (bump token_version)" : "Requer permissão license.adjust"}
        onClick={() => setOpen("revoke")}
      >
        Revogar
      </Button>

      {open === "adjust" && (
        <AdjustMachinesDialog
          licenseId={license.id}
          machinesAllowed={license.machinesAllowed}
          onClose={() => setOpen(null)}
        />
      )}
      {open === "bonus" && <BonusDialog licenseId={license.id} onClose={() => setOpen(null)} />}
      {open === "renew" && (
        <RenewDialog licenseId={license.id} expiresAt={license.expiresAt} onClose={() => setOpen(null)} />
      )}
      {open === "revoke" && (
        <RevokeDialog licenseId={license.id} keyMasked={license.keyMasked} onClose={() => setOpen(null)} />
      )}
    </span>
  );
}
