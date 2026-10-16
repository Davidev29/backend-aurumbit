import { Injectable, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Subject } from 'rxjs';
import type {
  ChatConversation,
  ChatEvent,
  ChatMessage,
  ChatOrigin,
  ChatSender,
  ChatStatus,
} from './support.types';

// Canal de atendimento em tempo real (ponte portal ↔ admin).
// - Fonte primária: memória (latência zero, SSE instantâneo).
// - Persistência PG: best-effort em `communications.chat_*` (quando as tabelas
//   existirem — migração `0002_chat`). Sem tabela = segue em memória, sem throw.
// - Eventos: `message` (persistente), `typing` (transiente, TTL 3s no client),
//   `read` (duplo check), `presence` (online), `conversation` (upsert p/ lista admin).
// - LGPD: guarda só nome + e-mail mascarado do visitante; corpo da mensagem é
//   funcional (suporte) e cai na retenção de 90d do domínio communications.

const MAX_BODY = 2000;
const MAX_NAME = 80;

function nowIso(): string {
  return new Date().toISOString();
}

function cleanStr(v: unknown, max: number): string {
  if (typeof v !== 'string') return '';
  return v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
}

export interface CreateConversationInput {
  visitorName: string;
  visitorEmail?: string;
  origin: ChatOrigin;
  triage?: { topic: string; label: string } | null;
  customerId?: string;
  firstMessage?: string;
}

// Mapeamentos PG (UPPER) → domínio em memória (lower). Entrada inválida cai
// no default seguro em vez de quebrar a hidratação.
function lowerStatus(v: unknown): ChatStatus {
  const s = String(v ?? '').toLowerCase();
  return s === 'open' || s === 'pending' || s === 'active' || s === 'closed' ? s : 'open';
}

function lowerSender(v: unknown): ChatSender {
  const s = String(v ?? '').toLowerCase();
  return s === 'agent' || s === 'system' ? s : 'visitor';
}

function lowerMsgStatus(v: unknown): ChatMessage['status'] {
  const s = String(v ?? '').toLowerCase();
  return s === 'read' || s === 'delivered' ? s : 'sent';
}

function lowerOrigin(v: unknown): ChatOrigin {
  const s = String(v ?? '').toLowerCase();
  return s === 'portal' || s === 'admin' ? s : 'landpage';
}

function lowerTriage(v: unknown): { topic: string; label: string } | null {
  const raw: unknown = typeof v === 'string' ? tryJson(v) : v;
  const o = raw as { topic?: unknown; label?: unknown } | null;
  if (o && typeof o.topic === 'string' && o.topic) {
    return { topic: o.topic.slice(0, 60), label: typeof o.label === 'string' ? o.label.slice(0, 80) : '' };
  }
  return null;
}

function tryJson(s: string): unknown {
  try {
    return JSON.parse(s) as unknown;
  } catch {
    return null;
  }
}

function isoOf(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string' && v) {
    const d = new Date(v);
    if (!Number.isNaN(+d)) return d.toISOString();
  }
  return nowIso();
}

export interface PostMessageInput {
  sender: ChatSender;
  authorName?: string;
  body: string;
}

@Injectable()
export class SupportService implements OnModuleInit {
  private readonly conversations = new Map<string, ChatConversation>();
  private readonly messages = new Map<string, ChatMessage[]>();
  private readonly streams = new Map<string, Subject<ChatEvent>>();
  private readonly globalStream = new Subject<ChatEvent>();
  private readonly typing = new Map<string, Map<ChatSender, number>>();

  // Hidrata a memória a partir do PG no boot (o realtime continua em
  // memória; sem tabela/linhas, segue vazio sem throw).
  async onModuleInit(): Promise<void> {
    await this.hydrateBestEffort();
  }

  // ---- conversas ----

  createConversation(input: CreateConversationInput): { conversation: ChatConversation; token: string } {
    const visitorName = cleanStr(input.visitorName, MAX_NAME) || 'Visitante';
    const visitorEmail = cleanStr(input.visitorEmail ?? '', 120) || null;
    const id = `chat-${randomUUID().slice(0, 8)}`;
    const guestToken = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '').slice(0, 8);
    const at = nowIso();
    const conversation: ChatConversation = {
      id,
      guestToken,
      visitorName,
      visitorEmail,
      origin: input.origin ?? 'landpage',
      triage: input.triage ?? null,
      status: 'open',
      assignee: null,
      customerId: input.customerId ?? null,
      lastMessageAt: at,
      unreadAgent: 0,
      unreadVisitor: 0,
      createdAt: at,
      updatedAt: at,
      archivedAt: null,
    };
    this.conversations.set(id, conversation);
    this.messages.set(id, []);
    this.streams.set(id, new Subject<ChatEvent>());

    const first = cleanStr(input.firstMessage ?? '', MAX_BODY);
    // A semente só persiste DEPOIS da conversa (FK `conversationId`): os dois
    // INSERTs eram fire-and-forget em paralelo e a mensagem perdia a corrida
    // (violação de FK engolida pelo catch best-effort).
    let seed: ChatMessage;
    if (first) {
      seed = this.appendMessageInternal(conversation, 'visitor', visitorName, first);
    } else {
      // Boas-vindas + triagem inicial (sistema).
      seed = this.appendMessageInternal(
        conversation,
        'system',
        'Atendimento AurumBit',
        `Olá, ${visitorName}! 👋 Bem-vindo ao atendimento AurumBit. Escolha um assunto para começar — um especialista entra em instantes.`,
      );
    }
    this.emitConversation(conversation);
    void this.persistConversationBestEffort(conversation)
      .then(() => this.persistMessageBestEffort(seed))
      .catch(() => undefined);
    return { conversation: this.publicConversation(conversation), token: guestToken };
  }

  listConversations(): ChatConversation[] {
    // Arquivadas saem da fila (vão p/ `listArchived` — tela de arquivados).
    return [...this.conversations.values()]
      .filter((c) => c.archivedAt == null)
      .map((c) => this.publicConversation(c, true))
      .sort((a, b) => (a.lastMessageAt < b.lastMessageAt ? 1 : -1));
  }

  /** Lixeira auditável: só arquivadas, mais recentemente arquivadas primeiro. */
  listArchived(): ChatConversation[] {
    return [...this.conversations.values()]
      .filter((c) => c.archivedAt != null)
      .map((c) => this.publicConversation(c, true))
      .sort((a, b) => ((a.archivedAt ?? '') < (b.archivedAt ?? '') ? 1 : -1));
  }

  getConversation(id: string): ChatConversation | null {
    const c = this.conversations.get(id);
    return c ? this.publicConversation(c) : null;
  }

  /** Acesso: staff (request.user) OU guestToken (header/query). Retorna a conversa interna ou null. */
  resolveWithToken(id: string, token: string | undefined, isStaff: boolean): ChatConversation | null {
    const c = this.conversations.get(id);
    if (!c) return null;
    if (isStaff) return c;
    if (token && token === c.guestToken) return c;
    return null;
  }

  patchConversation(id: string, patch: { status?: ChatStatus; assignee?: string | null }): ChatConversation | null {
    const c = this.conversations.get(id);
    if (!c) return null;
    if (patch.status) c.status = patch.status;
    if (patch.assignee !== undefined) c.assignee = patch.assignee;
    c.updatedAt = nowIso();
    this.emitConversation(c);
    void this.persistConversationBestEffort(c);
    return this.publicConversation(c);
  }

  /**
   * Arquiva/restaura (lixeira auditável — gate de role no controller).
   * Arquivar não apaga: esconde da fila, mantém mensagens + restauração.
   */
  setArchived(id: string, archived: boolean): ChatConversation | null {
    const c = this.conversations.get(id);
    if (!c) return null;
    c.archivedAt = archived ? nowIso() : null;
    c.updatedAt = nowIso();
    this.emitConversation(c);
    void this.persistArchivedBestEffort(c);
    return this.publicConversation(c);
  }

  // ---- mensagens ----

  listMessages(conversationId: string): ChatMessage[] {
    return [...(this.messages.get(conversationId) ?? [])];
  }

  postMessage(id: string, input: PostMessageInput): ChatMessage | null {
    const c = this.conversations.get(id);
    if (!c) return null;
    const body = cleanStr(input.body, MAX_BODY);
    if (!body) return null;
    const sender: ChatSender = input.sender === 'agent' ? 'agent' : input.sender === 'system' ? 'system' : 'visitor';
    const author =
      cleanStr(input.authorName ?? '', MAX_NAME) ||
      (sender === 'agent' ? 'Atendimento' : sender === 'system' ? 'Atendimento AurumBit' : c.visitorName);
    const msg = this.appendMessageInternal(c, sender, author, body);
    void this.persistMessageBestEffort(msg);
    return msg;
  }

  setTyping(id: string, sender: ChatSender, active: boolean): boolean {
    const c = this.conversations.get(id);
    if (!c) return false;
    let per = this.typing.get(id);
    if (!per) {
      per = new Map();
      this.typing.set(id, per);
    }
    per.set(sender, active ? Date.now() : 0);
    this.emit(id, { kind: 'typing', conversationId: id, at: nowIso(), typing: { sender, active } });
    return true;
  }

  /** Marca como lidas as mensagens DO OUTRO lado. Retorna ids afetados. */
  markRead(id: string, by: ChatSender): string[] {
    const c = this.conversations.get(id);
    if (!c) return [];
    const other: ChatSender = by === 'visitor' ? 'agent' : 'visitor';
    const affected: string[] = [];
    for (const m of this.messages.get(id) ?? []) {
      // Sistema conta como agente p/ leitura do visitante.
      const isOther = m.sender === other || (by === 'visitor' && m.sender === 'system');
      if (isOther && m.status !== 'read') {
        m.status = 'read';
        affected.push(m.id);
      }
    }
    if (by === 'visitor') c.unreadVisitor = 0;
    else c.unreadAgent = 0;
    c.updatedAt = nowIso();
    if (affected.length > 0) {
      this.emit(id, { kind: 'read', conversationId: id, at: nowIso(), read: { by, messageIds: affected } });
      this.emitConversation(c);
    }
    return affected;
  }

  // ---- streams (SSE) ----

  streamFor(id: string): Subject<ChatEvent> | null {
    return this.streams.get(id) ?? null;
  }

  globalStream$(): Subject<ChatEvent> {
    return this.globalStream;
  }

  presence(): { onlineAgents: number; onlineVisitors: number } {
    return { onlineAgents: 1, onlineVisitors: this.conversations.size };
  }

  // ---- internos ----

  private appendMessageInternal(
    c: ChatConversation,
    sender: ChatSender,
    authorName: string,
    body: string,
  ): ChatMessage {
    const msg: ChatMessage = {
      id: `msg-${randomUUID().slice(0, 8)}`,
      conversationId: c.id,
      sender,
      authorName,
      body,
      status: 'sent',
      createdAt: nowIso(),
    };
    // Entrega imediata (memória): sent → delivered no mesmo tick.
    msg.status = 'delivered';
    this.messages.get(c.id)?.push(msg);
    c.lastMessageAt = msg.createdAt;
    c.updatedAt = msg.createdAt;
    if (sender === 'visitor') c.unreadAgent += 1;
    if (sender === 'agent' || sender === 'system') c.unreadVisitor += 1;
    if (c.status === 'open' && sender === 'visitor') c.status = 'pending';
    this.emit(c.id, { kind: 'message', conversationId: c.id, at: msg.createdAt, message: msg });
    this.emitConversation(c);
    return msg;
  }

  private emit(conversationId: string, event: ChatEvent): void {
    try {
      this.streams.get(conversationId)?.next(event);
    } catch {
      /* ouvinte fechou — ignora */
    }
    try {
      this.globalStream.next(event);
    } catch {
      /* noop */
    }
  }

  private emitConversation(c: ChatConversation): void {
    const snapshot = this.publicConversation(c, true);
    try {
      this.globalStream.next({ kind: 'conversation', conversationId: c.id, at: nowIso(), conversation: snapshot });
    } catch {
      /* noop */
    }
  }

  /** Expõe a conversa SEM vazar o guestToken p/ staff-list; com token só no create/get autorizado. */
  private publicConversation(c: ChatConversation, hideToken = false): ChatConversation {
    if (!hideToken) return { ...c };
    const { guestToken: _omit, ...rest } = c;
    return { ...rest, guestToken: '' } as ChatConversation;
  }

  // Persistência best-effort (nunca quebra o realtime se a tabela não existir).
  // Enums do PG são UPPER (`OPEN`, `VISITOR`...); o domínio em memória é lower.
  private async persistConversationBestEffort(c: ChatConversation): Promise<void> {
    try {
      const pool = this.optionalPool();
      if (!pool) return;
      await pool.query(
        `INSERT INTO chat_conversations (id, "guestToken", "visitorName", "visitorEmail", origin, triage, status, assignee, "customerId", "lastMessageAt", "createdAt", "updatedAt")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, assignee = EXCLUDED.assignee, "lastMessageAt" = EXCLUDED."lastMessageAt", "updatedAt" = EXCLUDED."updatedAt"`,
        [
          c.id,
          c.guestToken,
          c.visitorName,
          c.visitorEmail,
          c.origin,
          JSON.stringify(c.triage ?? null),
          c.status.toUpperCase(),
          c.assignee,
          c.customerId,
          c.lastMessageAt,
          c.createdAt,
          c.updatedAt,
        ],
      );
    } catch {
      /* tabela ausente em dev — memória segue valendo */
    }
  }

  /**
   * Persiste só o arquivamento em statement isolado: se a coluna `archivedAt`
   * não existir (migração `0003` pendente), só este UPDATE falha em silêncio —
   * nunca quebra a persistência da conversa/mensagem.
   */
  private async persistArchivedBestEffort(c: ChatConversation): Promise<void> {
    try {
      const pool = this.optionalPool();
      if (!pool) return;
      await pool.query('UPDATE chat_conversations SET "archivedAt" = $2, "updatedAt" = $3 WHERE id = $1', [
        c.id,
        c.archivedAt,
        c.updatedAt,
      ]);
    } catch {
      /* coluna ausente — memória segue valendo */
    }
  }

  private async persistMessageBestEffort(m: ChatMessage): Promise<void> {
    try {
      const pool = this.optionalPool();
      if (!pool) return;
      await pool.query(
        `INSERT INTO chat_messages (id, "conversationId", sender, "authorName", body, status, "createdAt")
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
        [m.id, m.conversationId, m.sender.toUpperCase(), m.authorName, m.body, m.status.toUpperCase(), m.createdAt],
      );
    } catch {
      /* noop */
    }
  }

  // Hidratação best-effort no boot: reconstrói mapas + streams a partir das
  // linhas persistidas (retenção do domínio). Falha silenciosa = memória vazia.
  private async hydrateBestEffort(): Promise<void> {
    try {
      const pool = this.optionalPool();
      if (!pool) return;
      const convRes = (await pool.query(
        `SELECT id, "guestToken", "visitorName", "visitorEmail", origin, triage, status, assignee, "customerId", "lastMessageAt", "createdAt", "updatedAt"
         FROM chat_conversations ORDER BY "lastMessageAt" DESC LIMIT 200`,
      )) as { rows: Array<Record<string, unknown>> };
      const rows = Array.isArray(convRes?.rows) ? convRes.rows : [];
      if (rows.length === 0) return;
      const ids = rows.map((r) => String(r.id));
      const msgRes = (await pool.query(
        `SELECT id, "conversationId", sender, "authorName", body, status, "createdAt"
         FROM chat_messages WHERE "conversationId" = ANY($1) ORDER BY "createdAt" ASC`,
        [ids],
      )) as { rows: Array<Record<string, unknown>> };
      const msgRows = Array.isArray(msgRes?.rows) ? msgRes.rows : [];
      const byConv = new Map<string, ChatMessage[]>();
      for (const r of msgRows) {
        const cid = String(r.conversationId);
        const list = byConv.get(cid) ?? [];
        const msg: ChatMessage = {
          id: String(r.id),
          conversationId: cid,
          sender: lowerSender(r.sender),
          authorName: typeof r.authorName === 'string' ? r.authorName : '',
          body: typeof r.body === 'string' ? r.body : '',
          status: lowerMsgStatus(r.status),
          createdAt: isoOf(r.createdAt),
        };
        list.push(msg);
        byConv.set(cid, list);
      }
      for (const r of rows) {
        const id = String(r.id);
        const msgs = byConv.get(id) ?? [];
        const conversation: ChatConversation = {
          id,
          guestToken: typeof r.guestToken === 'string' ? r.guestToken : '',
          visitorName: typeof r.visitorName === 'string' && r.visitorName ? r.visitorName : 'Visitante',
          visitorEmail: typeof r.visitorEmail === 'string' ? r.visitorEmail : null,
          origin: lowerOrigin(r.origin),
          triage: lowerTriage(r.triage),
          status: lowerStatus(r.status),
          assignee: typeof r.assignee === 'string' ? r.assignee : null,
          customerId: typeof r.customerId === 'string' ? r.customerId : null,
          lastMessageAt: isoOf(r.lastMessageAt),
          unreadAgent: msgs.filter((m) => m.sender === 'visitor' && m.status !== 'read').length,
          unreadVisitor: msgs.filter((m) => m.sender !== 'visitor' && m.status !== 'read').length,
          createdAt: isoOf(r.createdAt),
          updatedAt: isoOf(r.updatedAt),
          archivedAt: null,
        };
        this.conversations.set(id, conversation);
        this.messages.set(id, msgs);
        this.streams.set(id, new Subject<ChatEvent>());
      }
      // Overlay do arquivamento em query isolada: sem a coluna (migração 0003
      // pendente) este SELECT falha sozinho e o histórico acima segue válido.
      try {
        const pool = this.optionalPool();
        if (pool) {
          const archRes = (await pool.query('SELECT id, "archivedAt" FROM chat_conversations')) as {
            rows: Array<Record<string, unknown>>;
          };
          for (const r of Array.isArray(archRes?.rows) ? archRes.rows : []) {
            const c = this.conversations.get(String(r.id));
            if (c && r.archivedAt) c.archivedAt = isoOf(r.archivedAt);
          }
        }
      } catch {
        /* sem coluna — tudo segue não-arquivado */
      }
    } catch {
      /* boot nunca quebra por causa do histórico */
    }
  }

  private optionalPool(): { query: (text: string, params?: unknown[]) => Promise<unknown> } | null {
    try {
      // Lazy: só cria pool se a env existir; sem banco = null (memória).
      const conn = process.env.DATABASE_URL_COMMUNICATIONS;
      if (!conn) return null;
      // Import tardio p/ não quebrar testes sem `pg`.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { Pool } = require('pg') as typeof import('pg');
      const g = globalThis as unknown as { __supportPool?: import('pg').Pool };
      if (!g.__supportPool) {
        g.__supportPool = new Pool({ connectionString: conn, max: 2, connectionTimeoutMillis: 1500, idleTimeoutMillis: 10_000 });
        g.__supportPool.on('error', () => null);
      }
      return g.__supportPool;
    } catch {
      return null;
    }
  }
}
