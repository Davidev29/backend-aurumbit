"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { UserAddress, UserDocument, UserProfileData } from "@/lib/types";

export interface ProfileState extends UserProfileData {
  setPersonal: (patch: Partial<Pick<UserProfileData, "nomeExibicao" | "nomeCompleto" | "telefone" | "celular" | "dataNascimento" | "genero" | "cargo" | "departamento" | "bio">>) => void;
  setEmail: (email: string) => void;
  setAddress: (patch: Partial<UserAddress>) => void;
  setPhoto: (previewUrl: string | null, nome: string | null) => void;
  removePhoto: () => void;
  addDocument: (doc: UserDocument) => void;
  updateDocument: (id: string, patch: Partial<UserDocument>) => void;
  removeDocument: (id: string) => void;
  hydrateFromMe: (me: { name: string; email: string }) => void;
  touch: () => void;
}

const now = (): string => new Date().toISOString();

/**
 * Perfil do operador (stub frontend-first).
 * Persiste em `localStorage` (`aurum:profile`); foto/anexos guardam só
 * dataURL/nome em sessão — backend real usa object storage + CDN (TODO).
 */
export const useProfileStore = create<ProfileState>()(
  persist(
    (set) => ({
      nomeExibicao: "",
      nomeCompleto: "",
      email: "",
      telefone: "",
      celular: "",
      dataNascimento: null,
      genero: "",
      cargo: "",
      departamento: "",
      bio: "",
      fotoPreviewUrl: null,
      fotoNome: null,
      endereco: { pais: "Brasil" },
      documentos: [],
      updatedAt: now(),

      setPersonal: (patch) => set((s) => ({ ...s, ...patch, updatedAt: now() })),
      setEmail: (email) => set((s) => ({ ...s, email, updatedAt: now() })),
      setAddress: (patch) =>
        set((s) => ({ ...s, endereco: { ...s.endereco, ...patch }, updatedAt: now() })),
      setPhoto: (previewUrl, nome) =>
        set((s) => ({ ...s, fotoPreviewUrl: previewUrl, fotoNome: nome, updatedAt: now() })),
      removePhoto: () => set((s) => ({ ...s, fotoPreviewUrl: null, fotoNome: null, updatedAt: now() })),
      addDocument: (doc) => set((s) => ({ ...s, documentos: [doc, ...s.documentos], updatedAt: now() })),
      updateDocument: (id, patch) =>
        set((s) => ({
          ...s,
          documentos: s.documentos.map((d) => (d.id === id ? { ...d, ...patch } : d)),
          updatedAt: now(),
        })),
      removeDocument: (id) =>
        set((s) => ({ ...s, documentos: s.documentos.filter((d) => d.id !== id), updatedAt: now() })),
      hydrateFromMe: (me) =>
        set((s) => ({
          ...s,
          nomeExibicao: s.nomeExibicao || me.name,
          nomeCompleto: s.nomeCompleto || me.name,
          email: s.email || me.email,
        })),
      touch: () => set((s) => ({ ...s, updatedAt: now() })),
    }),
    {
      name: "aurum:profile",
      storage: createJSONStorage(() => localStorage),
    },
  ),
);

/** % de preenchimento p/ barra de completude (foto + pessoais + endereço + docs). */
export function profileCompleteness(p: UserProfileData): number {
  const checks: boolean[] = [
    !!p.nomeExibicao?.trim(),
    !!p.email?.trim(),
    !!p.celular?.trim() || !!p.telefone?.trim(),
    !!p.endereco.cep?.trim() && !!p.endereco.cidade?.trim() && !!p.endereco.uf?.trim(),
    p.documentos.length > 0,
    !!p.fotoPreviewUrl,
  ];
  const done = checks.filter(Boolean).length;
  return Math.round((done / checks.length) * 100);
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return `${parts[0].charAt(0)}${parts[parts.length - 1].charAt(0)}`.toUpperCase();
}
