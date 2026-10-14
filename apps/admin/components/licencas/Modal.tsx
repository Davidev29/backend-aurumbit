"use client";

import type { ReactNode } from "react";
import { Dialog } from "@/components/ui/Dialog";

/**
 * Modal acessível mínimo (compat: mesma API; hoje delega ao Dialog P0 do DS v1).
 * Fecha com Escape ou clique no overlay; trava enquanto `pending` (via Dialog).
 * `titleId` mantido por compatibilidade com chamadas existentes.
 */
export function Modal({
  title,
  onClose,
  children,
}: {
  titleId: string;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Dialog open onClose={onClose} title={title}>
      {children}
    </Dialog>
  );
}
