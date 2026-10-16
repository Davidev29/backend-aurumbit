"use client";

import { useState } from "react";
import { Ban, CircleCheck, Gift, MonitorSmartphone, ReceiptText } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Field";
import { useCan } from "@/lib/auth/permissions";
import type { CustomerDetail, LicenseView } from "@/lib/types";
import { AdjustMachinesDialog } from "@/components/licencas/dialogs/AdjustMachinesDialog";
import { BonusDialog } from "@/components/licencas/dialogs/BonusDialog";
import { BlockCustomerDialog } from "./BlockCustomerDialog";
import { CreateChargeDialog, type CreatedCharge } from "./CreateChargeDialog";
import {
  getCustomerData,
  planAdjustTrails,
  planBonusTrails,
  planChargeTrails,
  recordActionTrails,
} from "./customer-data";

type OpenDialog = "block" | "bonus" | "adjust" | "charge" | null;

/**
 * Ações de acesso do cliente (DS §9: destrutivo em 2 passos, `title` em
 * disabled, sucesso inline — sem toast-sistema).
 * - Bloquear/liberar acesso (SUSPEND reversível + trilhas secundárias
 *   entitlement/billing/finance sob o mesmo `correlationId`; TODO backend).
 * - Bonificar dias/produto (`bonus.grant` → BonusDialog + trilha secundária
 *   `finance.courtesy.hold` p/ não cobrar o período de cortesia).
 * - Liberar outra máquina (`license.adjust` → AdjustMachinesDialog + trilha).
 * - Gerar cobrança (`billing.manage` → CreateChargeDialog + trilhas
 *   `billing.invoice.created` + `finance.receivable.forecast`).
 * Trilhas em sessão aparecem em Acessos > Logs; backend real usa os mesmos
 * `correlationId`s com `Idempotency-Key` por mutação.
 */
export function CustomerAccessActions({
  customer,
  licenses,
  blocked,
  onBlockedChange,
}: {
  customer: CustomerDetail;
  licenses: LicenseView[];
  blocked: boolean;
  onBlockedChange: (next: boolean, auditId: string) => void;
}) {
  const canAdjust = useCan("license.adjust");
  const canBonus = useCan("bonus.grant");
  const canCharge = useCan("billing.manage");
  const [open, setOpen] = useState<OpenDialog>(null);
  const [licenseId, setLicenseId] = useState(licenses[0]?.id ?? "");
  const [notice, setNotice] = useState<string | null>(null);

  const activeLicense = licenses.find((l) => l.id === licenseId) ?? licenses[0];

  return (
    <div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Ajustes de acesso">
        <Button
          type="button"
          variant={blocked ? "primary" : "destructive"}
          onClick={() => setOpen("block")}
          disabled={!canAdjust}
          title={canAdjust ? (blocked ? "Liberar acesso do cliente" : "Bloquear acesso do cliente") : "Requer permissão license.adjust"}
        >
          {blocked ? (
            <CircleCheck size={16} strokeWidth={1.75} aria-hidden="true" />
          ) : (
            <Ban size={16} strokeWidth={1.75} aria-hidden="true" />
          )}
          {blocked ? "Liberar acesso" : "Bloquear acesso"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => setOpen("bonus")}
          disabled={!canBonus || licenses.length === 0}
          title={
            licenses.length === 0
              ? "Cliente sem licenças para bonificar"
              : canBonus
                ? "Bonificar dias de acesso (mensal/anual)"
                : "Requer permissão bonus.grant"
          }
        >
          <Gift size={16} strokeWidth={1.75} aria-hidden="true" />
          Bonificar dias
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => setOpen("adjust")}
          disabled={!canAdjust || licenses.length === 0}
          title={
            licenses.length === 0
              ? "Cliente sem licenças para ajustar"
              : canAdjust
                ? "Liberar acesso em outra máquina (+1)"
                : "Requer permissão license.adjust"
          }
        >
          <MonitorSmartphone size={16} strokeWidth={1.75} aria-hidden="true" />
          Liberar outra máquina
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => setOpen("charge")}
          disabled={!canCharge}
          title={canCharge ? "Gerar nova cobrança avulsa" : "Requer permissão billing.manage"}
        >
          <ReceiptText size={16} strokeWidth={1.75} aria-hidden="true" />
          Gerar cobrança
        </Button>
      </div>

      {licenses.length > 1 && (open === "bonus" || open === "adjust") && (
        <div className="mt-3 max-w-[24rem]">
          <label htmlFor="access-license" className="block mb-1 font-semibold text-headline text-text1">
            Licença alvo
          </label>
          <Select id="access-license" value={licenseId} onChange={(e) => setLicenseId(e.target.value)}>
            {licenses.map((l) => (
              <option key={l.id} value={l.id}>
                {l.keyMasked} · {l.id}
              </option>
            ))}
          </Select>
        </div>
      )}

      {notice && (
        <div className="mt-3 rounded-card border border-line1 bg-bg1 shadow-1 p-4" role="status">
          <p className="m-0 text-body text-text1">{notice}</p>
        </div>
      )}

      {open === "block" && (
        <BlockCustomerDialog
          customerId={customer.id}
          customerName={customer.name}
          blocked={blocked}
          onClose={() => setOpen(null)}
          onDone={(next, auditId) => {
            onBlockedChange(next, auditId);
            setNotice(
              next
                ? `Acesso bloqueado. Trilha ${auditId} (stub local — TODO backend).`
                : `Acesso liberado. Trilha ${auditId} (stub local — TODO backend).`,
            );
          }}
        />
      )}
      {open === "bonus" && activeLicense && (
        <BonusDialog
          licenseId={activeLicense.id}
          onClose={() => setOpen(null)}
          onDone={() => {
            const corr = `corr-bonus-${activeLicense.id}-${Date.now()}`;
            const trails = recordActionTrails(
              customer.id,
              corr,
              planBonusTrails(getCustomerData(customer.id), activeLicense.id, corr),
            );
            setNotice(
              `Bônus em ${activeLicense.keyMasked} registrado · correlation ${corr} · +${trails.length} trilhas (bônus + cortesia financeira p/ não cobrar). Ver Logs.`,
            );
          }}
        />
      )}
      {open === "adjust" && activeLicense && (
        <AdjustMachinesDialog
          licenseId={activeLicense.id}
          machinesAllowed={activeLicense.machinesAllowed}
          onClose={() => setOpen(null)}
          onDone={(limit) => {
            const corr = `corr-adjust-${activeLicense.id}-${Date.now()}`;
            const delta = limit - activeLicense.machinesAllowed;
            const trails = recordActionTrails(
              customer.id,
              corr,
              planAdjustTrails(getCustomerData(customer.id), activeLicense.id, delta, corr),
            );
            setNotice(
              `Limite atualizado para ${limit} máquina(s) em ${activeLicense.keyMasked} · correlation ${corr} · +${trails.length} trilha(s).`,
            );
          }}
        />
      )}
      {open === "charge" && (
        <CreateChargeDialog
          customerId={customer.id}
          customerName={customer.name}
          onClose={() => setOpen(null)}
          onDone={(c: CreatedCharge) => {
            const trails = recordActionTrails(
              customer.id,
              c.correlationId,
              planChargeTrails(getCustomerData(customer.id), c.id, c.title, c.correlationId),
            );
            setNotice(
              `Cobrança “${c.title}” registrada (rascunho ${c.id}, trilha ${c.auditId}) · +${trails.length} trilhas (fatura + previsto financeiro).`,
            );
          }}
        />
      )}
    </div>
  );
}
