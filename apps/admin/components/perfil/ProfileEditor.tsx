"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  BadgeCheck,
  Building2,
  FileBadge,
  MapPin,
  Paperclip,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
  UserRound,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Dialog, DestructiveConfirm } from "@/components/ui/Dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { TabPanel, Tabs } from "@/components/ui/Tabs";
import { useMe } from "@/lib/auth/permissions";
import { apiPost } from "@/lib/api/client";
import type { UserDocumentType } from "@/lib/types";
import {
  DOCUMENT_LABELS,
  maskCep,
  toMaskedDocument,
  validateAddress,
  validateDocument,
  validateProfilePersonal,
} from "@/lib/profile";
import { profileCompleteness, useProfileStore } from "@/stores/profile-store";
import { ProfileAvatar } from "./ProfileAvatar";

type TabId = "pessoais" | "endereco" | "documentos";

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "pessoais", label: "Dados pessoais" },
  { id: "endereco", label: "Endereço" },
  { id: "documentos", label: "Documentos" },
];

/**
 * Área de perfil do operador: foto + pessoais (telefone inclusos) +
 * endereço + documentos (RG/CNH/etc. mascarados). Edição por aba com
 * validação inline (`role=alert`) e confirmação `role=status`.
 * Stub frontend-first (zustand persistido); `PATCH /api/profile` é
 * best-effort p/ o futuro Nest `PATCH /v1/users/me` (TODO).
 */
export function ProfileEditor() {
  const { me } = useMe();
  const [tab, setTab] = useState<TabId>("pessoais");
  const [status, setStatus] = useState<string | null>(null);
  const hydrateFromMe = useProfileStore((s) => s.hydrateFromMe);

  useEffect(() => {
    if (me) hydrateFromMe({ name: me.name, email: me.email });
  }, [me, hydrateFromMe]);

  const nomeExibicao = useProfileStore((s) => s.nomeExibicao);
  const email = useProfileStore((s) => s.email);
  const documentos = useProfileStore((s) => s.documentos);
  const endereco = useProfileStore((s) => s.endereco);
  const fotoPreviewUrl = useProfileStore((s) => s.fotoPreviewUrl);
  const telefone = useProfileStore((s) => s.telefone);
  const celular = useProfileStore((s) => s.celular);
  const profile = { nomeExibicao, email, documentos, endereco, fotoPreviewUrl, telefone, celular };
  const completeness = useProfileStore((s) =>
    profileCompleteness({
      nomeExibicao: s.nomeExibicao,
      email: s.email,
      telefone: s.telefone,
      celular: s.celular,
      endereco: s.endereco,
      documentos: s.documentos,
      fotoPreviewUrl: s.fotoPreviewUrl,
    }),
  );

  const statusRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (status) {
      statusRef.current?.focus?.();
      const t = window.setTimeout(() => setStatus(null), 6000);
      return () => window.clearTimeout(t);
    }
  }, [status]);

  const perms = me?.permissions ?? [];

  return (
    <div className="flex flex-col gap-4">
      {/* Cabeçalho elegante: avatar + identidade + completude */}
      <section
        aria-label="Resumo do perfil"
        className="relative overflow-hidden rounded-card border border-line1 bg-bg1 p-5 shadow-1 sm:p-6"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-20"
          style={{ background: "linear-gradient(120deg, var(--accent-soft), transparent 65%)" }}
        />
        <div className="relative flex flex-col gap-5">
          <ProfileAvatar size={96} />
          <div className="min-w-0">
            <h1 className="m-0 text-title-page text-text1">{profile.nomeExibicao || me?.name || "Meu perfil"}</h1>
            <p className="m-0 mt-1 truncate text-body text-text2">{profile.email || me?.email || ""}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge tone="accent" state="Conta verificada" icon={BadgeCheck}>
                Conta ativa
              </Badge>
              {me?.organizationId && (
                <Badge tone="neutral" icon={Building2}>
                  <span className="font-mono tnum text-[0.85em]">{me.organizationId}</span>
                </Badge>
              )}
              <Badge tone="info" icon={ShieldCheck}>
                {perms.length} permissões
              </Badge>
            </div>
          </div>
          <div aria-label={`Perfil ${completeness}% completo`} role="img" className="max-w-md">
            <div className="flex items-center justify-between gap-2">
              <p className="m-0 text-callout font-semibold text-text1">Perfil {completeness}% completo</p>
              <p className="m-0 font-mono tnum text-callout text-text2">{completeness}%</p>
            </div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-bg2" role="presentation">
              <div
                className="h-full rounded-full bg-accent transition-[width]"
                style={{ width: `${completeness}%` }}
              />
            </div>
            <p className="m-0 mt-1 text-callout text-text2">
              Foto, contato, endereço e ao menos um documento deixam o perfil completo.
            </p>
          </div>
        </div>
      </section>

      {status && (
        <p ref={statusRef} tabIndex={-1} role="status" className="m-0 rounded-card border border-line1 bg-bg1 p-3 text-body text-text1 shadow-1">
          {status}
        </p>
      )}

      <div className="rounded-card border border-line1 bg-bg1 p-5 shadow-1">
        <Tabs tabs={TABS} value={tab} onChange={setTab} label="Seções do perfil" />
        <div className="mt-4">
          {tab === "pessoais" && (
            <TabPanel label="Dados pessoais">
              <PersonalForm onSaved={(m) => setStatus(m)} />
            </TabPanel>
          )}
          {tab === "endereco" && (
            <TabPanel label="Endereço">
              <AddressForm onSaved={(m) => setStatus(m)} />
            </TabPanel>
          )}
          {tab === "documentos" && (
            <TabPanel label="Documentos pessoais">
              <DocumentsPanel onSaved={(m) => setStatus(m)} />
            </TabPanel>
          )}
        </div>
      </div>

      <section aria-label="Acesso e segurança" className="rounded-card border border-line1 bg-bg1 p-5 shadow-1">
        <h2 className="m-0 flex items-center gap-2 text-headline text-text1">
          <ShieldCheck size={18} strokeWidth={1.75} aria-hidden="true" className="text-text2" />
          Acesso e segurança
        </h2>
        <p className="text-callout text-text2">
          MFA {me?.mfaVerified ? "verificado" : "pendente"} · sessão via cookies httpOnly (nunca em localStorage).
          Troca de senha e chaves de recuperação ficam com o backend (em breve nesta área).
        </p>
        <div className="flex flex-wrap gap-1">
          {perms.length === 0 ? (
            <span className="text-callout text-text2">Nenhuma permissão efetiva.</span>
          ) : (
            perms.map((p) => (
              <Badge key={p} tone="neutral">
                <span className="font-mono tnum text-[0.85em]">{p}</span>
              </Badge>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function PersonalForm({ onSaved }: { onSaved: (msg: string) => void }) {
  const s = useProfileStore();
  const [form, setForm] = useState(() => ({
    nomeExibicao: s.nomeExibicao,
    nomeCompleto: s.nomeCompleto ?? "",
    email: s.email,
    telefone: s.telefone ?? "",
    celular: s.celular ?? "",
    dataNascimento: s.dataNascimento ?? "",
    genero: s.genero ?? "",
    cargo: s.cargo ?? "",
    departamento: s.departamento ?? "",
    bio: s.bio ?? "",
  }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm({
      nomeExibicao: s.nomeExibicao,
      nomeCompleto: s.nomeCompleto ?? "",
      email: s.email,
      telefone: s.telefone ?? "",
      celular: s.celular ?? "",
      dataNascimento: s.dataNascimento ?? "",
      genero: s.genero ?? "",
      cargo: s.cargo ?? "",
      departamento: s.departamento ?? "",
      bio: s.bio ?? "",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.updatedAt]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validateProfilePersonal({
      nomeExibicao: form.nomeExibicao,
      email: form.email,
      telefone: form.telefone,
      celular: form.celular,
      dataNascimento: form.dataNascimento || null,
    });
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    setSaving(true);
    try {
      // Best-effort p/ o futuro Nest (stub ecoa); fonte de verdade local segue no store.
      await apiPost("/api/profile", {
        nomeExibicao: form.nomeExibicao.trim(),
        email: form.email.trim(),
      }).catch(() => null);
      s.setPersonal({
        nomeExibicao: form.nomeExibicao.trim(),
        nomeCompleto: form.nomeCompleto.trim(),
        telefone: form.telefone.trim(),
        celular: form.celular.trim(),
        dataNascimento: form.dataNascimento || null,
        genero: form.genero,
        cargo: form.cargo.trim(),
        departamento: form.departamento.trim(),
        bio: form.bio.trim(),
      });
      s.setEmail(form.email.trim());
      onSaved("Dados pessoais atualizados.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate aria-label="Editar dados pessoais">
      <h3 className="m-0 mb-3 flex items-center gap-2 text-headline text-text1">
        <UserRound size={18} strokeWidth={1.75} aria-hidden="true" className="text-text2" />
        Dados pessoais
      </h3>
      <div className="grid gap-x-4 sm:grid-cols-2">
        <Field label="Nome de exibição" htmlFor="perfil-nome" error={errors.nomeExibicao}>
          <Input id="perfil-nome" value={form.nomeExibicao} onChange={set("nomeExibicao")} autoComplete="nickname" required aria-invalid={!!errors.nomeExibicao} aria-describedby={errors.nomeExibicao ? "perfil-nome-error" : undefined} />
        </Field>
        <Field label="Nome completo" htmlFor="perfil-nome-completo">
          <Input id="perfil-nome-completo" value={form.nomeCompleto} onChange={set("nomeCompleto")} autoComplete="name" placeholder="Como está nos documentos" />
        </Field>
        <Field label="E-mail" htmlFor="perfil-email" error={errors.email} hint="Usado p/ login e notificações.">
          <Input id="perfil-email" type="email" value={form.email} onChange={set("email")} autoComplete="email" required aria-invalid={!!errors.email} aria-describedby={errors.email ? "perfil-email-error" : undefined} />
        </Field>
        <Field label="Data de nascimento" htmlFor="perfil-nasc" error={errors.dataNascimento}>
          <Input id="perfil-nasc" type="date" value={form.dataNascimento ?? ""} onChange={set("dataNascimento")} autoComplete="bday" aria-invalid={!!errors.dataNascimento} aria-describedby={errors.dataNascimento ? "perfil-nasc-error" : undefined} />
        </Field>
        <Field label="Telefone" htmlFor="perfil-tel" error={errors.telefone} hint="Fixo com DDD.">
          <Input id="perfil-tel" value={form.telefone} onChange={set("telefone")} inputMode="tel" autoComplete="tel" placeholder="(11) 3000-0000" aria-invalid={!!errors.telefone} aria-describedby={errors.telefone ? "perfil-tel-error" : undefined} />
        </Field>
        <Field label="Celular" htmlFor="perfil-cel" error={errors.celular} hint="WhatsApp/SMS com DDD.">
          <Input id="perfil-cel" value={form.celular} onChange={set("celular")} inputMode="tel" autoComplete="tel-national" placeholder="(11) 90000-0000" aria-invalid={!!errors.celular} aria-describedby={errors.celular ? "perfil-cel-error" : undefined} />
        </Field>
        <Field label="Gênero" htmlFor="perfil-genero">
          <Select id="perfil-genero" value={form.genero} onChange={set("genero")}>
            <option value="">Prefiro não informar</option>
            <option value="feminino">Feminino</option>
            <option value="masculino">Masculino</option>
            <option value="nao-binario">Não-binário</option>
            <option value="outro">Outro</option>
          </Select>
        </Field>
        <Field label="Cargo" htmlFor="perfil-cargo">
          <Input id="perfil-cargo" value={form.cargo} onChange={set("cargo")} autoComplete="organization-title" placeholder="Ex.: Analista financeiro" />
        </Field>
        <Field label="Departamento" htmlFor="perfil-depto">
          <Input id="perfil-depto" value={form.departamento} onChange={set("departamento")} placeholder="Ex.: Operações" />
        </Field>
      </div>
      <Field label="Apresentação" htmlFor="perfil-bio" hint="Aparece p/ o time (máx. 280 caracteres).">
        <Textarea id="perfil-bio" value={form.bio} onChange={set("bio")} maxLength={280} placeholder="Conte em uma frase sua atuação…" />
      </Field>
      <div className="flex justify-end">
        <Button type="submit" variant="primary" loading={saving} loadingLabel="Salvando…" title={saving ? "Salvando…" : "Salvar dados pessoais"}>
          Salvar dados pessoais
        </Button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ */

function AddressForm({ onSaved }: { onSaved: (msg: string) => void }) {
  const s = useProfileStore();
  const [form, setForm] = useState({ ...s.endereco });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm({ ...s.endereco });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.updatedAt]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validateAddress({ cep: form.cep, uf: form.uf, cidade: form.cidade });
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    setSaving(true);
    try {
      s.setAddress({
        cep: form.cep ? maskCep(form.cep) : "",
        logradouro: form.logradouro?.trim(),
        numero: form.numero?.trim(),
        complemento: form.complemento?.trim(),
        bairro: form.bairro?.trim(),
        cidade: form.cidade?.trim(),
        uf: form.uf?.trim().toUpperCase(),
        pais: form.pais?.trim() || "Brasil",
      });
      onSaved("Endereço atualizado.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate aria-label="Editar endereço">
      <h3 className="m-0 mb-3 flex items-center gap-2 text-headline text-text1">
        <MapPin size={18} strokeWidth={1.75} aria-hidden="true" className="text-text2" />
        Endereço
      </h3>
      <div className="grid gap-x-4 sm:grid-cols-2">
        <Field label="CEP" htmlFor="perfil-cep" error={errors.cep}>
          <Input id="perfil-cep" value={form.cep ?? ""} onChange={set("cep")} inputMode="numeric" autoComplete="postal-code" placeholder="00000-000" aria-invalid={!!errors.cep} aria-describedby={errors.cep ? "perfil-cep-error" : undefined} />
        </Field>
        <Field label="País" htmlFor="perfil-pais">
          <Input id="perfil-pais" value={form.pais ?? "Brasil"} onChange={set("pais")} autoComplete="country-name" />
        </Field>
      </div>
      <div className="grid gap-x-4 sm:grid-cols-[1fr_8rem]">
        <Field label="Logradouro" htmlFor="perfil-rua">
          <Input id="perfil-rua" value={form.logradouro ?? ""} onChange={set("logradouro")} autoComplete="street-address" placeholder="Rua, avenida…" />
        </Field>
        <Field label="Número" htmlFor="perfil-num">
          <Input id="perfil-num" value={form.numero ?? ""} onChange={set("numero")} autoComplete="address-line2" placeholder="123" />
        </Field>
      </div>
      <div className="grid gap-x-4 sm:grid-cols-2">
        <Field label="Complemento" htmlFor="perfil-comp">
          <Input id="perfil-comp" value={form.complemento ?? ""} onChange={set("complemento")} placeholder="Apto, bloco…" />
        </Field>
        <Field label="Bairro" htmlFor="perfil-bairro">
          <Input id="perfil-bairro" value={form.bairro ?? ""} onChange={set("bairro")} autoComplete="address-level2" />
        </Field>
        <Field label="Cidade" htmlFor="perfil-cidade">
          <Input id="perfil-cidade" value={form.cidade ?? ""} onChange={set("cidade")} autoComplete="address-level2" />
        </Field>
        <Field label="UF" htmlFor="perfil-uf" error={errors.uf}>
          <Input id="perfil-uf" value={form.uf ?? ""} onChange={set("uf")} maxLength={2} autoComplete="address-level1" placeholder="SP" aria-invalid={!!errors.uf} aria-describedby={errors.uf ? "perfil-uf-error" : undefined} />
        </Field>
      </div>
      <div className="flex justify-end">
        <Button type="submit" variant="primary" loading={saving} loadingLabel="Salvando…" title={saving ? "Salvando…" : "Salvar endereço"}>
          Salvar endereço
        </Button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ */

function DocumentsPanel({ onSaved }: { onSaved: (msg: string) => void }) {
  const documentos = useProfileStore((s) => s.documentos);
  const addDocument = useProfileStore((s) => s.addDocument);
  const updateDocument = useProfileStore((s) => s.updateDocument);
  const removeDocument = useProfileStore((s) => s.removeDocument);
  const [dialog, setDialog] = useState<null | { mode: "add" } | { mode: "edit"; id: string }>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const label = useMemo(() => {
    const kinds = new Set(documentos.map((d) => d.tipo));
    if (kinds.size === 0) return "Nenhum documento cadastrado.";
    return `${documentos.length} documento(s): ${Array.from(kinds).map((k) => DOCUMENT_LABELS[k]).join(", ")}.`;
  }, [documentos]);

  return (
    <div>
      <h3 className="m-0 mb-1 flex items-center gap-2 text-headline text-text1">
        <FileBadge size={18} strokeWidth={1.75} aria-hidden="true" className="text-text2" />
        Documentos pessoais
      </h3>
      <p className="mt-0 text-callout text-text2">
        RG, CNH e demais documentos ficam mascarados na listagem (LGPD). O número completo aparece só na
        edição. {label}
      </p>
      <div className="mb-3">
        <Button type="button" variant="primary" onClick={() => setDialog({ mode: "add" })} title="Adicionar documento pessoal">
          <Plus size={16} strokeWidth={1.75} aria-hidden="true" />
          Adicionar documento
        </Button>
      </div>
      {documentos.length === 0 ? (
        <p role="status" className="rounded-base border border-dashed border-line2 p-4 text-body text-text2">
          Nenhum documento ainda — adicione RG, CNH ou outro documento p/ completar o perfil.
        </p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {documentos.map((d) => (
            <li
              key={d.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-base border border-line1 bg-bg2 p-3"
            >
              <FileBadge size={20} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-text2" />
              <span className="min-w-0 flex-1">
                <span className="block text-body font-semibold text-text1">
                  {DOCUMENT_LABELS[d.tipo]}
                  {d.uf ? <span className="font-normal text-text2"> · {d.uf}</span> : null}
                </span>
                <span className="block font-mono tnum text-callout text-text1">{d.numeroMasked}</span>
                <span className="block text-callout text-text2">
                  {d.orgaoEmissor ? `${d.orgaoEmissor} · ` : ""}
                  {d.validade ? `válido até ${d.validade} · ` : ""}
                  {d.anexoNome ? (
                    <span className="inline-flex items-center gap-1">
                      <Paperclip size={14} strokeWidth={1.75} aria-hidden="true" />
                      {d.anexoNome}
                    </span>
                  ) : (
                    "sem anexo"
                  )}
                </span>
              </span>
              <span className="flex gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setDialog({ mode: "edit", id: d.id })}
                  title={`Editar ${DOCUMENT_LABELS[d.tipo]}`}
                  aria-label={`Editar ${DOCUMENT_LABELS[d.tipo]}`}
                >
                  <Pencil size={16} strokeWidth={1.75} aria-hidden="true" />
                  Editar
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={() => setConfirmRemove(d.id)}
                  title={`Remover ${DOCUMENT_LABELS[d.tipo]}`}
                  aria-label={`Remover ${DOCUMENT_LABELS[d.tipo]}`}
                >
                  <Trash2 size={16} strokeWidth={1.75} aria-hidden="true" />
                  Remover
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {dialog && (
        <DocumentDialog
          key={dialog.mode === "edit" ? dialog.id : "add"}
          editingId={dialog.mode === "edit" ? dialog.id : null}
          onClose={() => setDialog(null)}
          onDone={(msg) => {
            setDialog(null);
            onSaved(msg);
          }}
          onAdd={addDocument}
          onUpdate={updateDocument}
        />
      )}
      <DestructiveConfirm
        open={confirmRemove !== null}
        onClose={() => setConfirmRemove(null)}
        onConfirm={() => {
          if (confirmRemove) removeDocument(confirmRemove);
          setConfirmRemove(null);
          onSaved("Documento removido.");
        }}
        title="Remover documento"
        description="O documento sai do perfil neste dispositivo. Confirma a remoção?"
        confirmLabel="Remover documento"
      />
    </div>
  );
}

function DocumentDialog({
  editingId,
  onClose,
  onDone,
  onAdd,
  onUpdate,
}: {
  editingId: string | null;
  onClose: () => void;
  onDone: (msg: string) => void;
  onAdd: (doc: ReturnType<typeof toMaskedDocument>) => void;
  onUpdate: (id: string, patch: Partial<ReturnType<typeof toMaskedDocument>>) => void;
}) {
  const existing = useProfileStore((s) => s.documentos.find((d) => d.id === editingId) ?? null);
  const [tipo, setTipo] = useState<UserDocumentType | "">((existing?.tipo as UserDocumentType) ?? "");
  const [numero, setNumero] = useState(existing?.numero ?? "");
  const [orgao, setOrgao] = useState(existing?.orgaoEmissor ?? "");
  const [uf, setUf] = useState(existing?.uf ?? "");
  const [validade, setValidade] = useState(existing?.validade ?? "");
  const [anexo, setAnexo] = useState<{ nome: string; tamanho: number } | null>(
    existing?.anexoNome ? { nome: existing.anexoNome, tamanho: existing.anexoTamanho ?? 0 } : null,
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) {
      setErrors((er) => ({ ...er, anexo: "Anexo até 5 MB." }));
      return;
    }
    setErrors((er) => {
      const next = { ...er };
      delete next.anexo;
      return next;
    });
    // Stub: guarda só nome/tamanho (bytes ficam no backend/object storage — TODO).
    setAnexo({ nome: f.name, tamanho: f.size });
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validateDocument({ tipo, numero });
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    setPending(true);
    try {
      const docType = tipo as UserDocumentType;
      if (editingId) {
        onUpdate(editingId, {
          tipo: docType,
          numeroMasked: `***·${numero.replace(/\D/g, "").slice(-4) || numero.slice(-4)}`,
          numero: numero.trim(),
          orgaoEmissor: orgao.trim() || undefined,
          uf: uf.trim().toUpperCase() || undefined,
          validade: validade || null,
          anexoNome: anexo?.nome ?? null,
          anexoTamanho: anexo?.tamanho ?? null,
        });
        onDone("Documento atualizado.");
      } else {
        onAdd(
          toMaskedDocument({
            tipo: docType,
            numero,
            orgaoEmissor: orgao,
            uf,
            validade: validade || null,
            anexoNome: anexo?.nome ?? null,
            anexoTamanho: anexo?.tamanho ?? null,
          }),
        );
        onDone("Documento adicionado ao perfil.");
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={editingId ? "Editar documento" : "Adicionar documento"}
      size="md"
      pending={pending}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose} disabled={pending} title={pending ? "Aguarde…" : "Voltar sem salvar"}>
            Voltar
          </Button>
          <Button type="submit" form="doc-form" variant="primary" loading={pending} loadingLabel="Salvando…" title={pending ? "Salvando…" : "Salvar documento"}>
            Salvar documento
          </Button>
        </>
      }
    >
      <form id="doc-form" onSubmit={onSubmit} noValidate aria-label={editingId ? "Editar documento" : "Adicionar documento"}>
        <div className="grid gap-x-4 sm:grid-cols-2">
          <Field label="Tipo" htmlFor="doc-tipo" error={errors.tipo}>
            <Select id="doc-tipo" value={tipo} onChange={(e) => setTipo(e.target.value as UserDocumentType | "")} required aria-invalid={!!errors.tipo} aria-describedby={errors.tipo ? "doc-tipo-error" : undefined}>
              <option value="">Selecione…</option>
              {(Object.keys(DOCUMENT_LABELS) as UserDocumentType[]).map((k) => (
                <option key={k} value={k}>
                  {DOCUMENT_LABELS[k]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Número" htmlFor="doc-numero" error={errors.numero} hint="Só aparece na edição; na lista fica mascarado.">
            <Input id="doc-numero" value={numero} onChange={(e) => setNumero(e.target.value)} inputMode="text" autoComplete="off" required aria-invalid={!!errors.numero} aria-describedby={errors.numero ? "doc-numero-error" : undefined} />
          </Field>
          <Field label="Órgão emissor" htmlFor="doc-orgao">
            <Input id="doc-orgao" value={orgao} onChange={(e) => setOrgao(e.target.value)} placeholder="Ex.: SSP, DETRAN" />
          </Field>
          <Field label="UF" htmlFor="doc-uf">
            <Input id="doc-uf" value={uf} onChange={(e) => setUf(e.target.value)} maxLength={2} placeholder="SP" />
          </Field>
          <Field label="Validade" htmlFor="doc-validade">
            <Input id="doc-validade" type="date" value={validade ?? ""} onChange={(e) => setValidade(e.target.value)} />
          </Field>
          <Field label="Anexo (opcional)" htmlFor="doc-anexo" error={errors.anexo} hint="Foto/escaneamento até 5 MB — guarda nome/tamanho neste stub.">
            <Input id="doc-anexo" type="file" accept="image/*,.pdf" onChange={onFile} aria-invalid={!!errors.anexo} aria-describedby={errors.anexo ? "doc-anexo-error" : undefined} />
            {anexo && (
              <p className="m-0 mt-1 inline-flex items-center gap-1 text-callout text-text2">
                <Paperclip size={14} strokeWidth={1.75} aria-hidden="true" />
                {anexo.nome}
              </p>
            )}
          </Field>
        </div>
      </form>
    </Dialog>
  );
}
