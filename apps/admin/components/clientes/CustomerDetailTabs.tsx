"use client";

import { useState } from "react";
import {
  Ban,
  CircleCheck,
  Eye,
  FileText,
  KeyRound,
  MonitorSmartphone,
  Package,
  ScrollText,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/table";
import { Table, Td, Th } from "@/components/ui/table";
import { Tabs, TabPanel } from "@/components/ui/Tabs";
import { Button } from "@/components/ui/Button";
import { ErrorState as FeedbackError } from "@/components/feedback/ErrorState";
import { MaskedJson } from "@/components/billing/MaskedJson";
import { GraceBadge } from "@/components/licencas/GraceBadge";
import { HeartbeatDot } from "@/components/licencas/HeartbeatDot";
import { LicenseActions } from "@/components/licencas/LicenseActions";
import { LicenseKeyMasked } from "@/components/licencas/LicenseKeyMasked";
import { SessionTable } from "@/components/licencas/SessionTable";
import { formatBRL, formatDateInTZ, formatDateTimeInTZ } from "@/lib/format";
import type { LicenseView } from "@/lib/types";
import {
  getCustomerData,
  planCycleOf,
  subscriptionState,
  type CustomerData,
} from "./customer-data";
import { CustomerAccessActions } from "./CustomerAccessActions";

type TabId = "perfil" | "contratos" | "licencas" | "acessos";

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "perfil", label: "Perfil" },
  { id: "contratos", label: "Contratos" },
  { id: "licencas", label: "Licenças" },
  { id: "acessos", label: "Acessos e diagnóstico" },
];

/**
 * Conteúdo em abas do cliente — fonte única usada pelo modal (`page.tsx`) e
 * pela página profunda (`[id]/page.tsx`).
 * Superfícies opacas DS §2 (vidro só no chrome sidebar/topbar, já no ar);
 * elevação por `shadow-1` + borda de token; sem blur em conteúdo denso.
 */
export function CustomerDetailTabs({ customerId }: { customerId: string }) {
  const [tab, setTab] = useState<TabId>("perfil");
  const data = getCustomerData(customerId);

  if (!data) {
    return <FeedbackError message="Cliente não encontrado." />;
  }

  return (
    <div>
      <Tabs tabs={TABS} value={tab} onChange={setTab} label="Seções do cliente" />
      <div className="mt-4">
        {tab === "perfil" && (
          <TabPanel label="Perfil do cliente">
            <PerfilPanel data={data} />
          </TabPanel>
        )}
        {tab === "contratos" && (
          <TabPanel label="Contratos do cliente">
            <ContratosPanel data={data} />
          </TabPanel>
        )}
        {tab === "licencas" && (
          <TabPanel label="Licenças do cliente">
            <LicencasPanel data={data} />
          </TabPanel>
        )}
        {tab === "acessos" && (
          <TabPanel label="Acessos e diagnóstico">
            <AcessosPanel data={data} />
          </TabPanel>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function PanelCard({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <section aria-label={label} className="rounded-card border border-line1 bg-bg1 shadow-1 p-5">
      {children}
    </section>
  );
}

function PerfilPanel({ data }: { data: CustomerData }) {
  const { customer } = data;
  const [blocked, setBlocked] = useState(customer.status === "blocked");
  const [trail, setTrail] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <PanelCard label="Informações do perfil">
        <dl className="m-0 grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-callout text-text2">Nome completo</dt>
            <dd className="m-0 text-body font-semibold text-text1">{customer.name}</dd>
          </div>
          <div>
            <dt className="text-callout text-text2">E-mail</dt>
            <dd className="m-0 text-body text-text1">{customer.email}</dd>
          </div>
          <div>
            <dt className="text-callout text-text2">CPF/CNPJ</dt>
            <dd className="m-0 text-body text-text1">
              <span className="font-mono tnum text-[0.85em]">{customer.docMasked}</span>
              <span className="block text-callout text-text2">Mascarado (LGPD — sem dado cru na UI).</span>
            </dd>
          </div>
          <div>
            <dt className="text-callout text-text2">Registrado em</dt>
            <dd className="m-0 text-body text-text1">{formatDateInTZ(customer.createdAt)}</dd>
          </div>
          <div>
            <dt className="text-callout text-text2">Status</dt>
            <dd className="m-0 text-body text-text1">
              {blocked ? (
                <Badge tone="danger" state="Bloqueado">
                  <Ban size={14} strokeWidth={1.75} aria-hidden="true" />
                  Bloqueado
                </Badge>
              ) : (
                <Badge tone="ok" state="Ativo">
                  <CircleCheck size={14} strokeWidth={1.75} aria-hidden="true" />
                  Ativo
                </Badge>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-callout text-text2">Organização</dt>
            <dd className="m-0 text-body text-text1">
              <span className="font-mono tnum text-[0.85em]">{customer.organizationId}</span>
            </dd>
          </div>
        </dl>
        {trail && (
          <p className="mb-0 mt-3 text-callout text-text2" role="status">
            Trilha de acesso: <span className="font-mono tnum text-[0.85em]">{trail}</span>
          </p>
        )}
      </PanelCard>
      <PanelCard label="Ajustes de acesso">
        <h3 className="mt-0 text-headline text-text1">Ajustes de acesso</h3>
        <CustomerAccessActions
          customer={customer}
          licenses={data.licenses}
          blocked={blocked}
          onBlockedChange={(next, auditId) => {
            setBlocked(next);
            setTrail(auditId);
          }}
        />
      </PanelCard>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function ContratosPanel({ data }: { data: CustomerData }) {
  const { subscriptions, contracts } = data;
  if (subscriptions.length === 0 && contracts.length === 0) {
    return (
      <EmptyState title="Sem contratos" message="Este cliente ainda não possui produtos assinados." />
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {subscriptions.length > 0 && (
        <Table
          caption="Produtos assinados (validade e estado da cobrança)"
          head={
            <>
              <Th>Produto</Th>
              <Th>Pacote</Th>
              <Th>Validade</Th>
              <Th numeric>Valor</Th>
              <Th>Status</Th>
            </>
          }
        >
          {subscriptions.map((s) => {
            const cycle = planCycleOf(s.planName);
            const st = subscriptionState(s);
            return (
              <tr key={s.id}>
                <Td>
                  <span className="inline-flex items-center gap-2">
                    <Package size={16} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-text2" />
                    {s.planName}
                  </span>
                </Td>
                <Td>
                  {cycle === "Mensal" ? (
                    <Badge tone="accent" state="Pacote mensal">Mensal</Badge>
                  ) : cycle === "Anual" ? (
                    <Badge tone="info" state="Pacote anual">Anual</Badge>
                  ) : (
                    <Badge tone="neutral">—</Badge>
                  )}
                </Td>
                <Td>
                  <time dateTime={s.nextDue}>{formatDateInTZ(s.nextDue)}</time>
                  <span className="block text-callout text-text2">próxima cobrança</span>
                </Td>
                <Td numeric>{formatBRL(s.amount)}</Td>
                <Td>
                  {st.state === "em-dia" ? (
                    <Badge tone="ok" state={st.label}>
                      <CircleCheck size={14} strokeWidth={1.75} aria-hidden="true" />
                      {st.label}
                    </Badge>
                  ) : st.state === "atrasado" ? (
                    <Badge tone="danger" state={st.label}>
                      <Ban size={14} strokeWidth={1.75} aria-hidden="true" />
                      {st.label}
                    </Badge>
                  ) : (
                    <Badge tone="neutral" state={st.label}>{st.label}</Badge>
                  )}
                </Td>
              </tr>
            );
          })}
        </Table>
      )}
      {contracts.length > 0 && (
        <Table
          caption="Contratos (preço congelado)"
          head={
            <>
              <Th>Produto</Th>
              <Th numeric>Preço congelado</Th>
              <Th>Início</Th>
            </>
          }
        >
          {contracts.map((c) => (
            <tr key={c.id}>
              <Td>
                <span className="inline-flex items-center gap-2">
                  <FileText size={16} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-text2" />
                  {c.productName}
                </span>
              </Td>
              <Td numeric>{formatBRL(c.priceFrozen)}</Td>
              <Td>{formatDateInTZ(c.startedAt)}</Td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function LicencasPanel({ data }: { data: CustomerData }) {
  const [expanded, setExpanded] = useState<string | null>(data.licenses[0]?.id ?? null);
  if (data.licenses.length === 0) {
    return <EmptyState title="Sem licenças" message="Este cliente ainda não possui licenças." />;
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="m-0 text-callout text-text2">
        Chaves sempre mascaradas (PROJECT §2). Revelação exige{" "}
        <code className="font-mono tnum text-[0.85em]">license.read</code> + MFA, auditada.
      </p>
      {data.licenses.map((l) => {
        const open = expanded === l.id;
        return (
          <section
            key={l.id}
            aria-label={`Licença ${l.id}`}
            className="rounded-card border border-line1 bg-bg1 shadow-1 p-4"
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <KeyRound size={20} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-text2" />
              <code className="font-mono tnum text-[0.85em] text-text1">{l.keyMasked}</code>
              <GraceBadge status={l.status} graceUntil={l.graceUntil} degraded={l.degraded} />
              <span className="text-callout text-text2">
                {l.machinesUsed}/{l.machinesAllowed} máquinas
              </span>
              {l.lastActivity && <HeartbeatDot lastActivity={l.lastActivity} />}
              <span className="ml-auto">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  aria-expanded={open}
                  title={open ? "Ocultar detalhes da licença" : "Ver chave, máquinas e IPs"}
                  onClick={() => setExpanded(open ? null : l.id)}
                >
                  <Eye size={16} strokeWidth={1.75} aria-hidden="true" />
                  {open ? "Ocultar" : "Abrir produto"}
                </Button>
              </span>
            </div>
            {open && <LicenseDetails license={l} data={data} />}
          </section>
        );
      })}
    </div>
  );
}

function LicenseDetails({ license, data }: { license: LicenseView; data: CustomerData }) {
  const devices = data.devices.filter((d) => d.licenseId === license.id);
  return (
    <div className="mt-4 flex flex-col gap-4 border-t border-line1 pt-4">
      <div>
        <h4 className="m-0 mb-2 text-headline text-text1">Chave de ativação</h4>
        <LicenseKeyMasked licenseId={license.id} keyMasked={license.keyMasked} />
        <p className="mb-0 mt-2 text-callout text-text2">
          Validade: expira em {formatDateInTZ(license.expiresAt)}
          {license.graceUntil && <> · graça até {formatDateInTZ(license.graceUntil)}</>} · origem{" "}
          {license.origin}
        </p>
      </div>
      <div>
        <h4 className="m-0 mb-2 text-headline text-text1">Máquinas vinculadas</h4>
        {devices.length === 0 ? (
          <EmptyState title="Sem máquinas" message="Nenhuma máquina vinculada a esta licença." />
        ) : (
          <Table
            caption={`Máquinas da licença ${license.id} (id por hash, nunca hardware cru)`}
            head={
              <>
                <Th>Id da máquina</Th>
                <Th>Rótulo</Th>
                <Th>Conexão</Th>
                <Th>Alerta</Th>
              </>
            }
          >
            {devices.map((d) => (
              <tr key={d.id}>
                <Td mono>{d.deviceHashMasked}</Td>
                <Td>
                  <span className="inline-flex items-center gap-2">
                    <MonitorSmartphone size={16} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-text2" />
                    {d.label}
                  </span>
                </Td>
                <Td>
                  <HeartbeatDot lastActivity={d.lastActivity} />
                </Td>
                <Td>
                  {d.suspectClone ? (
                    <Badge tone="danger" state="Clone suspeito">Clone suspeito</Badge>
                  ) : (
                    <span className="text-callout text-text2">—</span>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </div>
      <div>
        <h4 className="m-0 mb-2 text-headline text-text1">Endereços de IP e conexão</h4>
        {data.sessions.length === 0 ? (
          <EmptyState title="Sem sessões" message="Nenhuma sessão registrada para este cliente." />
        ) : (
          <Table
            caption="Sessões do cliente (IP mascarado /24, nunca raw — PROJECT §4)"
            head={
              <>
                <Th>Dispositivo</Th>
                <Th>IP</Th>
                <Th>Conectado</Th>
              </>
            }
          >
            {data.sessions.map((s) => (
              <tr key={s.id}>
                <Td>{s.deviceLabel}</Td>
                <Td mono>{s.ipMasked}</Td>
                <Td>
                  <HeartbeatDot lastActivity={s.lastActivity} />
                </Td>
              </tr>
            ))}
          </Table>
        )}
        <p className="mb-0 mt-2 text-callout text-text2">
          Vínculo sessão↔licença aproximado no stub; o backend resolve pelo `device_hash` + `license_id`.
        </p>
      </div>
      <div>
        <h4 className="m-0 mb-2 text-headline text-text1">Ajustes da licença</h4>
        <LicenseActions license={license} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function AcessosPanel({ data }: { data: CustomerData }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-4">
      <section aria-label="Gestão de acessos">
        <h3 className="mt-0 text-headline text-text1">Gestão de acessos</h3>
        <SessionTable sessions={data.sessions} />
      </section>
      <section aria-label="Erros de ferramenta e diagnóstico">
        <h3 className="mt-0 text-headline text-text1">Erros de ferramenta e diagnóstico</h3>
        {data.devices.filter((d) => d.suspectClone || !d.live).length === 0 && data.sessions.length > 0 ? (
          <div className="rounded-card border border-line1 bg-bg1 shadow-1 p-4" role="status">
            <p className="m-0 text-body text-text1">
              <Badge tone="ok" state="Sem anomalias">Sem anomalias</Badge> Nenhum clone suspeito nem
              sessão ociosa fora da janela no momento.
            </p>
          </div>
        ) : (
          <Table
            caption="Diagnóstico por dispositivo (clone suspeito, heartbeat)"
            head={
              <>
                <Th>Dispositivo</Th>
                <Th>Licença</Th>
                <Th>Diagnóstico</Th>
                <Th>Última atividade</Th>
              </>
            }
          >
            {data.devices.map((d) => (
              <tr key={d.id}>
                <Td mono>{d.deviceHashMasked}</Td>
                <Td mono>{d.licenseId}</Td>
                <Td>
                  {d.suspectClone ? (
                    <Badge tone="danger" state="Clone suspeito">Clone suspeito</Badge>
                  ) : !d.live ? (
                    <Badge tone="warn" state="Sessão ociosa">Sessão ociosa</Badge>
                  ) : (
                    <Badge tone="ok" state="Saudável">Saudável</Badge>
                  )}
                </Td>
                <Td>{formatDateTimeInTZ(d.lastActivity)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </section>
      <section aria-label="Logs para auditoria">
        <h3 className="mt-0 flex items-center gap-2 text-headline text-text1">
          <ScrollText size={16} strokeWidth={1.75} aria-hidden="true" className="text-text2" />
          Logs para auditoria
        </h3>
        {data.audit.length === 0 ? (
          <EmptyState title="Sem logs vinculados" message="Nenhum evento de auditoria para este cliente." />
        ) : (
          <>
            <Table
              caption="Eventos de auditoria vinculados ao cliente (append-only)"
              head={
                <>
                  <Th>Ocorrido em</Th>
                  <Th>Tipo de log</Th>
                  <Th>Ator</Th>
                  <Th>CorrelationId</Th>
                  <Th>Detalhe</Th>
                </>
              }
            >
              {data.audit.map((e) => (
                <tr key={e.id}>
                  <Td>{formatDateTimeInTZ(e.occurredAt)}</Td>
                  <Td>
                    <code className="font-mono tnum text-[0.85em]">{e.action}</code>
                    <span className="block text-callout text-text2">{e.resource}:{e.resourceId}</span>
                  </Td>
                  <Td>{e.actor}</Td>
                  <Td mono>{e.correlationId}</Td>
                  <Td>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      aria-expanded={expanded === e.id}
                      title={expanded === e.id ? "Ocultar detalhe do log" : "Ver detalhe do log"}
                      onClick={() => setExpanded((cur) => (cur === e.id ? null : e.id))}
                    >
                      {expanded === e.id ? "Ocultar" : "Ver"}
                    </Button>
                  </Td>
                </tr>
              ))}
            </Table>
            {expanded && (
              <ExpandedAudit event={data.audit.find((e) => e.id === expanded) ?? null} onClose={() => setExpanded(null)} />
            )}
          </>
        )}
      </section>
    </div>
  );
}

function ExpandedAudit({
  event,
  onClose,
}: {
  event: CustomerData["audit"][number] | null;
  onClose: () => void;
}) {
  if (!event) return null;
  return (
    <section aria-label={`Log ${event.id}`} className="mt-3 rounded-card border border-line1 bg-bg1 shadow-1 p-4">
      <h4 className="m-0 text-headline text-text1">
        <code className="font-mono tnum text-[0.85em]">{event.action}</code>{" "}
        <span className="font-normal text-text2">{event.id}</span>
      </h4>
      <p className="text-callout text-text2">
        Tipo de log: <Badge tone="info" state={event.resource}>{event.resource}</Badge> · ator {event.actor} ·{" "}
        <time dateTime={event.occurredAt}>{formatDateTimeInTZ(event.occurredAt)}</time>
      </p>
      <MaskedJson data={event.metadataMasked} />
      <div className="mt-3 flex justify-end">
        <Button type="button" variant="secondary" onClick={onClose} title="Fechar detalhe do log">
          Fechar
        </Button>
      </div>
    </section>
  );
}
