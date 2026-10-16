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

  it('arquiva e restaura: sai da fila, fica na lixeira, mensagens preservadas', () => {
    const svc = new SupportService();
    const c1 = svc.createConversation({ visitorName: 'A', origin: 'landpage' });
    const c2 = svc.createConversation({ visitorName: 'B', origin: 'portal' });
    svc.postMessage(c1.conversation.id, { sender: 'visitor', body: 'spam sem sequência' });

    const archived = svc.setArchived(c1.conversation.id, true);
    expect(archived?.archivedAt).toEqual(expect.any(String));

    // Sai da fila ativa…
    expect(svc.listConversations().map((c) => c.id)).toEqual([c2.conversation.id]);
    // …e aparece só na lixeira, com mensagens intactas (auditoria).
    const trash = svc.listArchived();
    expect(trash.map((c) => c.id)).toEqual([c1.conversation.id]);
    expect(svc.listMessages(c1.conversation.id).length).toBeGreaterThan(0);

    const restored = svc.setArchived(c1.conversation.id, false);
    expect(restored?.archivedAt).toBeNull();
    expect(svc.listArchived()).toHaveLength(0);
    expect(svc.listConversations().map((c) => c.id)).toContain(c1.conversation.id);
  });

  it('arquivar conversa inexistente retorna null', () => {
    const svc = new SupportService();
    expect(svc.setArchived('chat-inexistente', true)).toBeNull();
  });
});
