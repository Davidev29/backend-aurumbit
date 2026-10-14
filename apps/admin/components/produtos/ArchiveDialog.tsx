"use client";

import { useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { DestructiveForm } from "@/components/ui/DestructiveForm";
import { RequirePerm } from "@/lib/auth/permissions";
import { archiveProduct } from "@/lib/products";

/**
 * Arquivamento de produto (2 passos: motivo ≥10 + checkbox, submit destrutivo
 * "Arquivar produto"). Exige `product.manage`. Motivo + confirmação seguem no
 * corpo como nas demais ações destrutivas (revoke/refund/cancel); a resposta
 * traz o produto atualizado + `auditId`.
 */
export function ArchiveDialog({
  productCode,
  productName,
  onClose,
  onDone,
}: {
  productCode: string;
  productName: string;
  onClose: () => void;
  onDone?: (auditId: string) => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(motivo: string) {
    setPending(true);
    setError(null);
    try {
      const res = await archiveProduct(productCode, { motivo, confirmacao: true });
      onDone?.(typeof res?.auditId === "string" ? res.auditId : "");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao arquivar produto.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open onClose={onClose} title={`Arquivar produto — ${productName}`} size="sm" pending={pending}>
      <RequirePerm perm="product.manage">
        <p className="mt-0 text-callout text-text2">
          O produto sai do catálogo (novas emissões bloqueadas; licenças vigentes seguem
          válidas até expirar). Registrado em auditoria.
        </p>
        <DestructiveForm
          submitLabel="Arquivar produto"
          submitVariant="destructive"
          pending={pending}
          error={error}
          onBack={onClose}
          onSubmit={handleSubmit}
        />
      </RequirePerm>
    </Dialog>
  );
}
