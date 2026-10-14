"use client";

import { useState } from "react";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { RequirePerm } from "@/lib/auth/permissions";
import { mockFinanceFacets } from "@/lib/mocks";
import type { CustomerDetail } from "@/lib/types";
import { maskDoc, registerCustomer } from "./customer-data";

export interface PreRegistered {
  customer: CustomerDetail;
  /** Produto vinculado ou `null` (somente conta). */
  product: string | null;
  /** Link de definição de senha (demonstração — backend envia por e-mail). */
  setupLink: string;
  auditId: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const ONLY_DIGITS = /\D/g;

/**
 * Pré-cadastro de cliente (stub robusto até o backend servir
 * `POST /v1/customers` + envio do link por e-mail com TTL curto).
 * - Conta simples ou com produto vinculado (assinatura criada pelo billing).
 * - E-mail duplicado é recusado inline (lista + sessão).
 * - Registro em sessão (`registerCustomer`) p/ o modal abrir sem divergência.
 * Exige `customer.read` (TODO backend: permissão `customer.manage` dedicada).
 */
export function PreRegisterDialog({
  takenEmails,
  onClose,
  onDone,
}: {
  /** E-mails já existentes (lista + sessão), em minúsculas. */
  takenEmails: string[];
  onClose: () => void;
  onDone: (entry: PreRegistered) => void;
}) {
  const products = mockFinanceFacets().products;
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [doc, setDoc] = useState("");
  const [product, setProduct] = useState<string>("");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const digits = doc.replace(ONLY_DIGITS, "");
  const nameValid = name.trim().length >= 3;
  const emailValid = EMAIL_RE.test(email.trim());
  const emailTaken = emailValid && takenEmails.includes(email.trim().toLowerCase());
  const docValid = digits.length === 11 || digits.length === 14;
  const valid = nameValid && emailValid && !emailTaken && docValid;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || pending) return;
    setPending(true);
    setError(null);
    try {
      const stamp = Date.now();
      const id = `cus-pre-${stamp}`;
      const token =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID().replace(/-/g, "").slice(0, 32)
          : `${stamp.toString(36)}${Math.random().toString(36).slice(2, 18)}`;
      const customer: CustomerDetail = {
        id,
        name: name.trim(),
        email: email.trim(),
        docMasked: maskDoc(digits),
        organizationId: "org-acme",
        status: "active",
        licensesCount: 0,
        createdAt: new Date().toISOString(),
      };
      registerCustomer(customer);
      await new Promise((r) => setTimeout(r, 500));
      onDone({
        customer,
        product: product === "" ? null : product,
        setupLink: `${window.location.origin}/definir-senha?token=set-${token}`,
        auditId: `aud-customer-pre-${stamp}`,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao pré-cadastrar.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open onClose={onClose} title="Pré-cadastrar cliente" size="md" material="glass" pending={pending}>
      <RequirePerm perm="customer.read">
        <p className="mt-0 text-callout text-text2">
          Cria a conta (com produto ou somente conta) e gera o link de definição de senha.
          Demonstração — o backend passa a persistir e enviar o link por e-mail (TTL curto).
        </p>
        <form onSubmit={handleSubmit}>
          <Field label="Nome completo" htmlFor="pre-name">
            <Input
              id="pre-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex.: Davi Souza"
              autoComplete="off"
              disabled={pending}
            />
          </Field>
          <Field
            label="E-mail"
            htmlFor="pre-email"
            error={emailTaken ? "Este e-mail já está cadastrado." : null}
          >
            <Input
              id="pre-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="cliente@exemplo.com"
              autoComplete="off"
              disabled={pending}
              aria-invalid={emailTaken}
            />
          </Field>
          <Field label="CPF/CNPJ" htmlFor="pre-doc" hint="Somente dígitos verificados (11 ou 14); exibido mascarado.">
            <Input
              id="pre-doc"
              mono
              inputMode="numeric"
              value={doc}
              onChange={(e) => setDoc(e.target.value)}
              placeholder="000.000.000-00"
              disabled={pending}
            />
          </Field>
          <Field label="Produto" htmlFor="pre-product" hint="Somente conta cria o acesso sem assinatura.">
            <Select
              id="pre-product"
              value={product}
              onChange={(e) => setProduct(e.target.value)}
              disabled={pending}
            >
              <option value="">Somente conta (sem produto)</option>
              {products.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Observação (opcional)" htmlFor="pre-note">
            <Textarea
              id="pre-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={pending}
              placeholder="Contexto do pré-cadastro"
            />
          </Field>
          {error && (
            <p className="flex items-center gap-2 text-callout text-danger dark:text-[#ff9a9e]" role="alert">
              <TriangleAlert size={16} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2 mt-4">
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
              disabled={pending}
              title={pending ? "Aguarde…" : "Cancelar"}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={pending}
              loadingLabel="Cadastrando…"
              disabled={!valid || pending}
              title={
                pending
                  ? "Cadastrando…"
                  : emailTaken
                    ? "E-mail já cadastrado"
                    : !valid
                      ? "Preencha nome, e-mail válido e CPF/CNPJ"
                      : "Criar conta e gerar link"
              }
            >
              Criar conta
            </Button>
          </div>
        </form>
      </RequirePerm>
    </Dialog>
  );
}
