import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Sse,
} from '@nestjs/common';
import { map, Observable } from 'rxjs';
import type { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthPrincipal } from '../../common/auth/jwt-payload';
import { JwtService } from '../../common/auth/jwt.service';
import { SupportService } from './support.service';
import type { ChatSender } from './support.types';

// Canal de atendimento (ponte portal ↔ admin).
// - Criação e fluxo do visitante: `@Public()` + `x-chat-token` (guest). O
//   EventSource não envia headers → o token vai na query `?token=` no SSE.
// - Lista admin: exige JWT (sem `@Public` — a cadeia JwtAuthGuard barra sem token).
// - Detalhe/mensagem/typing/read/stream: `@Public()` com checagem manual
//   (staff via Bearer verificado aqui OU guestToken). O `JwtAuthGuard` global
//   pula rotas `@Public()` sem preencher `request.user` — por isso o Bearer
//   staff é verificado manualmente (`isStaffRequest`); confiar só em
//   `request.user` aqui quebraria todo o lado admin (sempre FORBIDDEN).
//   Assim o widget da landpage funciona sem login e o admin continua
//   protegido por sessão.

function chatToken(req: Request, queryToken?: string): string | undefined {
  const h = req.headers['x-chat-token'];
  const fromHeader = Array.isArray(h) ? h[0] : h;
  return fromHeader || queryToken || undefined;
}

@Controller('support/conversations')
export class SupportController {
  constructor(
    private readonly support: SupportService,
    private readonly jwt: JwtService,
  ) {}

  /**
   * Staff em rotas `@Public()`: `request.user` só existe quando o
   * `JwtAuthGuard` roda (ele pula públicas) — então o Bearer é verificado
   * manualmente aqui (assinatura + iss/aud/exp/sub/sid/jti). Token curto
   * (15min); sem Bearer válido, só o guestToken do visitante autoriza.
   */
  private isStaffRequest(req: Request, user: AuthPrincipal | undefined): boolean {
    if (user) return true;
    const h = req.headers['authorization'];
    const raw = Array.isArray(h) ? h[0] : h;
    const m = typeof raw === 'string' ? raw.match(/^Bearer\s+(.+)$/i) : null;
    if (!m) return false;
    try {
      this.jwt.verify(m[1].trim());
      return true;
    } catch {
      return false;
    }
  }

  @Post()
  @Public()
  @HttpCode(201)
  create(
    @Body()
    body: {
      visitorName?: unknown;
      visitorEmail?: unknown;
      origin?: unknown;
      triage?: { topic?: unknown; label?: unknown } | null;
      customerId?: unknown;
      firstMessage?: unknown;
    },
  ) {
    const origin = body.origin === 'portal' || body.origin === 'admin' ? body.origin : 'landpage';
    const triage =
      body.triage && typeof body.triage.topic === 'string'
        ? { topic: String(body.triage.topic).slice(0, 60), label: String(body.triage.label ?? '').slice(0, 80) }
        : null;
    const { conversation, token } = this.support.createConversation({
      visitorName: typeof body.visitorName === 'string' ? body.visitorName : 'Visitante',
      visitorEmail: typeof body.visitorEmail === 'string' ? body.visitorEmail : undefined,
      origin,
      triage,
      customerId: typeof body.customerId === 'string' ? body.customerId : undefined,
      firstMessage: typeof body.firstMessage === 'string' ? body.firstMessage : undefined,
    });
    return { conversation, token };
  }

  // Lista p/ o módulo administrativo (JWT obrigatório).
  // `?archived=true` devolve só a lixeira (tela de arquivados p/ auditoria).
  @Get()
  list(@CurrentUser() _user: AuthPrincipal | undefined, @Query('archived') archived?: string) {
    if (archived === 'true') {
      return { data: this.support.listArchived(), presence: this.support.presence() };
    }
    return { data: this.support.listConversations(), presence: this.support.presence() };
  }

  @Get(':id')
  @Public()
  getOne(@Param('id') id: string, @Req() req: Request, @Query('token') qt: string, @CurrentUser() user: AuthPrincipal | undefined) {
    const found = this.support.resolveWithToken(id, chatToken(req, qt), this.isStaffRequest(req, user));
    if (!found) return { code: 'FORBIDDEN', message: 'Conversa não encontrada ou token inválido.' };
    return { conversation: this.support.getConversation(id) };
  }

  @Get(':id/messages')
  @Public()
  getMessages(
    @Param('id') id: string,
    @Req() req: Request,
    @Query('token') qt: string,
    @CurrentUser() user: AuthPrincipal | undefined,
  ) {
    const found = this.support.resolveWithToken(id, chatToken(req, qt), this.isStaffRequest(req, user));
    if (!found) return { code: 'FORBIDDEN', message: 'Conversa não encontrada ou token inválido.' };
    return { data: this.support.listMessages(id) };
  }

  @Post(':id/messages')
  @Public()
  @HttpCode(201)
  postMessage(
    @Param('id') id: string,
    @Req() req: Request,
    @CurrentUser() user: AuthPrincipal | undefined,
    @Body() body: { sender?: unknown; authorName?: unknown; body?: unknown },
    @Headers('x-chat-token') _h: string,
    @Query('token') qt: string,
  ) {
    const staff = this.isStaffRequest(req, user);
    const found = this.support.resolveWithToken(id, chatToken(req, qt), staff);
    if (!found) return { code: 'FORBIDDEN', message: 'Conversa não encontrada ou token inválido.' };
    // Visitante nunca pode se passar por agente (e vice-versa sem JWT).
    const wantsAgent = body.sender === 'agent';
    const sender: ChatSender = wantsAgent && staff ? 'agent' : body.sender === 'system' && staff ? 'system' : 'visitor';
    const msg = this.support.postMessage(id, {
      sender,
      authorName: typeof body.authorName === 'string' ? body.authorName : undefined,
      body: typeof body.body === 'string' ? body.body : '',
    });
    if (!msg) return { code: 'UNPROCESSABLE', message: 'Mensagem vazia.' };
    return { message: msg };
  }

  @Post(':id/typing')
  @Public()
  @HttpCode(200)
  typing(
    @Param('id') id: string,
    @Req() req: Request,
    @CurrentUser() user: AuthPrincipal | undefined,
    @Body() body: { sender?: unknown; active?: unknown },
    @Query('token') qt: string,
  ) {
    const staff = this.isStaffRequest(req, user);
    const found = this.support.resolveWithToken(id, chatToken(req, qt), staff);
    if (!found) return { ok: false };
    const sender: ChatSender = body.sender === 'agent' && staff ? 'agent' : 'visitor';
    this.support.setTyping(id, sender, body.active === true);
    return { ok: true };
  }

  @Post(':id/read')
  @Public()
  @HttpCode(200)
  read(
    @Param('id') id: string,
    @Req() req: Request,
    @CurrentUser() user: AuthPrincipal | undefined,
    @Body() body: { by?: unknown },
    @Query('token') qt: string,
  ) {
    const staff = this.isStaffRequest(req, user);
    const found = this.support.resolveWithToken(id, chatToken(req, qt), staff);
    if (!found) return { ok: false };
    const by: ChatSender = body.by === 'agent' && staff ? 'agent' : 'visitor';
    const ids = this.support.markRead(id, by);
    return { ok: true, read: ids };
  }

  @Patch(':id')
  patch(
    @Param('id') id: string,
    @Body() body: { status?: 'open' | 'pending' | 'active' | 'closed'; assignee?: string | null; archived?: unknown },
    @CurrentUser() user: AuthPrincipal | undefined,
  ) {
    // Arquivamento (lixeira): só admin/manager. Operadores de suporte
    // (`STAFF_SUPPORT`) arquivam; financeiro e demais, não. Sem roles no
    // token (stub/dev), mantém o comportamento staff-atual.
    if (body.archived !== undefined) {
      const roles = user?.roles ?? [];
      const canArchive =
        roles.length === 0 || roles.includes('STAFF_ADMIN') || roles.includes('STAFF_SUPPORT');
      if (!canArchive) return { code: 'FORBIDDEN', message: 'Arquivamento restrito a admin/manager.' };
      const archived = this.support.setArchived(id, body.archived === true);
      if (!archived) return { code: 'NOT_FOUND', message: 'Conversa não encontrada.' };
      return { conversation: archived };
    }
    const allowed = ['open', 'pending', 'active', 'closed'] as const;
    const status = allowed.includes(body.status as (typeof allowed)[number]) ? body.status : undefined;
    const updated = this.support.patchConversation(id, { status, assignee: body.assignee });
    if (!updated) return { code: 'NOT_FOUND', message: 'Conversa não encontrada.' };
    return { conversation: updated };
  }

  // SSE por conversa (visitante: `?token=`; staff: JWT via BFF — o
  // EventSource do browser não manda header, mas o fetch server-to-server
  // do BFF repassa o Bearer, verificado em `isStaffRequest`).
  @Sse(':id/stream')
  @Public()
  stream(@Param('id') id: string, @Req() req: Request, @Query('token') qt: string): Observable<MessageEvent> {
    const token = chatToken(req, qt);
    const staff = this.isStaffRequest(req, (req as unknown as { user?: AuthPrincipal }).user);
    const subject = this.support.streamFor(id);
    const found = this.support.resolveWithToken(id, token, staff);
    if (!subject || !found) {
      // Stream vazio (o client faz fallback p/ polling).
      const { EMPTY } = require('rxjs') as typeof import('rxjs');
      return EMPTY as Observable<MessageEvent>;
    }
    return subject.asObservable().pipe(
      map((event) => ({ data: event }) as MessageEvent),
    );
  }

  // SSE global p/ a fila do admin (JWT).
  @Sse('live/updates')
  globalStream(): Observable<MessageEvent> {
    return this.support.globalStream$().pipe(map((event) => ({ data: event }) as MessageEvent));
  }
}
