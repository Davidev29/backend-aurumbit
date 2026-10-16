"use client";

import { SearchX } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Field";
import { Segmented } from "@/components/ui/Tabs";
import type { CustomerStatusFilter } from "./customer-data";

/**
 * Barra de filtros da seção de clientes (DS §9: filtros resetam a paginação).
 * - Busca por nome/e-mail (debounce de 300ms na página).
 * - Produto (nomes do catálogo + uso real).
 * - Status (segmentado Todos/Ativos/Bloqueados).
 */
export function CustomerFilters({
  query,
  onQueryChange,
  product,
  onProductChange,
  status,
  onStatusChange,
  products,
  onClear,
  hasActiveFilters,
}: {
  query: string;
  onQueryChange: (v: string) => void;
  product: string;
  onProductChange: (v: string) => void;
  status: CustomerStatusFilter;
  onStatusChange: (v: CustomerStatusFilter) => void;
  products: string[];
  onClear: () => void;
  hasActiveFilters: boolean;
}) {
  return (
    <form
      aria-label="Filtros de clientes"
      className="mb-4 rounded-card border border-line1 bg-bg1 shadow-1 p-4"
      onSubmit={(e) => e.preventDefault()}
    >
      <div className="flex flex-wrap items-end gap-4">
        <div className="min-w-[14rem] flex-[2] basis-64">
          <Field label="Buscar por nome ou e-mail" htmlFor="busca-clientes">
            <Input
              id="busca-clientes"
              type="search"
              placeholder="Ex.: Alice ou alice@example.com"
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              autoComplete="off"
            />
          </Field>
        </div>
        <div className="min-w-[12rem] flex-1 basis-48">
          <Field label="Produto" htmlFor="filtro-produto">
            <Select
              id="filtro-produto"
              value={product}
              onChange={(e) => onProductChange(e.target.value)}
            >
              <option value="">Todos os produtos</option>
              {products.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="min-w-[12rem] basis-56">
          <span className="mb-1 block font-semibold text-headline text-text1" id="filtro-status-label">
            Status
          </span>
          <Segmented<CustomerStatusFilter>
            options={[
              { value: "all", label: "Todos" },
              { value: "active", label: "Ativos" },
              { value: "blocked", label: "Bloqueados" },
            ]}
            value={status}
            onChange={onStatusChange}
            label="Filtrar por status"
          />
        </div>
        {hasActiveFilters && (
          <div className="pb-4">
            <Button
              type="button"
              variant="secondary"
              onClick={onClear}
              title="Limpar busca, produto e status"
            >
              <SearchX size={16} strokeWidth={1.75} aria-hidden="true" />
              Limpar
            </Button>
          </div>
        )}
      </div>
      <p className="m-0 text-callout text-text2">
        Selecione um cliente para ver perfil, contratos, licenças e diagnóstico em modal.
        Filtros reiniciam a paginação.
      </p>
    </form>
  );
}
