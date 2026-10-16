import { SupportService } from './support.service';

describe('SupportService (canal de atendimento)', () => {
  it('cria conversa com boas-vindas, posta mensagens e marca leitura', () => {
    const svc = new SupportService();
    const { conversation, token } = svc.createConversation({
      visitorName: 'Maria',
      origin: 'landpage',
      triage: { topic: 'planos', label: 'Dúvidas sobre planos' },
    });
    expect(conversation.id).toMatch(/^chat-/);
    expect(token.length).toBeGreaterThan(16);

    const seed = svc.listMessages(conversation.id);
    expect(seed.length).toBe(1);
    expect(seed[0].sender).toBe('system');

    const v = svc.postMessage(conversation.id, { sender: 'visitor', body: 'Olá, preciso de ajuda' });
    expect(v?.status).toBe('delivered');

    const a = svc.postMessage(conversation.id, { sender: 'agent', authorName: 'Ana', body: 'Olá! Como posso ajudar?' });
    expect(a?.sender).toBe('agent');

    expect(svc.setTyping(conversation.id, 'agent', true)).toBe(true);
    const read = svc.markRead(conversation.id, 'visitor');
    expect(read.length).toBeGreaterThan(0);

    const resolved = svc.resolveWithToken(conversation.id, token, false);
    expect(resolved?.id).toBe(conversation.id);
    expect(svc.resolveWithToken(conversation.id, 'token-errado', false)).toBeNull();
  });

  it('lista conversas ordenadas e atualiza status', () => {
    const svc = new SupportService();
    const c1 = svc.createConversation({ visitorName: 'A', origin: 'landpage' });
    const c2 = svc.createConversation({ visitorName: 'B', origin: 'portal' });
    const list = svc.listConversations();
    expect(list.map((c) => c.id)).toContain(c1.conversation.id);
    expect(list.map((c) => c.id)).toContain(c2.conversation.id);
    const patched = svc.patchConversation(c1.conversation.id, { status: 'closed' });
    expect(patched?.status).toBe('closed');
  });
});
