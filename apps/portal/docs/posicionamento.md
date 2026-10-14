# AurumBit — Posicionamento e Copy Deck (PT-BR)

> Documento de trabalho para reescrever a landing em linguagem simples de negócios.
> Regra de ouro: quem compra não é técnico. Todo texto aqui é em português simples,
> sem jargão de desenvolvedor, sem número inventado e sem promessa que não dá para cumprir.

---

## A. Perfil do público

**Quem decide a compra**

- Dono ou dona de empresa pequena ou média (comércio, escritório, loja, clínica, prestadora de serviço).
- Gerente de loja, de escritório ou de operações, que responde pelo dia a dia e indica a compra ao dono.
- Responsável administrativo/financeiro, que paga a conta e quer previsibilidade.

**O que essa pessoa teme (freios de compra)**

1. O trabalho parar: internet cair, sistema travar, ninguém conseguir vender ou atender.
2. Conta surpresa: taxa escondida, reajuste sem aviso, multa para cancelar.
3. Complicação na instalação: precisar de técnico, mexer em servidor, treinar a equipe por semanas.
4. Perder dados ou ter problema com a lei de proteção de dados (LGPD).
5. Pagar e ficar sem ajuda: suporte só em inglês, só por robô, ou que demora dias.
6. Comprar algo que não serve e ficar preso a contrato longo.

**O que essa pessoa deseja (motores de compra)**

1. Preço claro e previsível: saber quanto paga por mês ou por ano, sem surpresa.
2. Funcionar sempre: com ou sem internet, no movimento da loja e do escritório.
3. Começar rápido: pagar, receber a chave e instalar no mesmo dia, sem técnico.
4. Ajuda de gente de verdade, em português, quando precisar.
5. Liberdade para sair: cancelar quando quiser, sem multa e sem burocracia.
6. Segurança para os dados da empresa e dos clientes.

**Como falar com esse público**

- Frases curtas. Verbo de ação. Exemplo: "Pague. Receba a chave. Instale."
- Falar do resultado no negócio, nunca da tecnologia. Exemplo: "sua loja continua vendendo mesmo sem internet" em vez de qualquer termo técnico.
- Preço e condição sempre à vista. Nada de "consulte" ou "sob consulta".
- Prova honesta: dizer o que o produto faz hoje, sem inventar cliente ou número.

---

## B. Proposta de valor

**Uma frase:**

> Programas prontos para a sua empresa, que continuam funcionando mesmo sem internet, com chave de ativação na hora, pagamento do jeito que você prefere e ajuda em português.

**Três pilares (linguagem simples):**

1. **Seu trabalho não para.** Os programas continuam funcionando mesmo se a internet cair — no plano Base e no Pro, até 7 dias; no Enterprise, até 30 dias. Quando a internet volta, tudo se atualiza sozinho.
2. **Você sabe quanto paga e pode sair quando quiser.** Preço claro por plano, pagamento por Pix, boleto ou cartão, nota fiscal e cancelamento quando quiser, sem multa [dado — confirmar: política de cancelamento e reembolso].
3. **Você nunca fica sozinho.** Instalação simples que qualquer pessoa faz, chave de ativação entregue logo após o pagamento [dado — confirmar: prazo real de entrega] e atendimento de gente de verdade, em português.

---

## C. Dores reais de empresas (e como a AurumBit responde em 1 linha)

1. **"Se a internet cai, a loja para."**
   A AurumBit continua funcionando sem internet por dias, e atualiza tudo sozinho quando ela volta.
2. **"Todo mês tem uma taxa nova que eu não entendi."**
   Aqui o preço é por plano e está escrito antes de você pagar: sem taxa escondida.
3. **"Instalar programa novo dá dor de cabeça."**
   Você paga, recebe a chave na hora e instala seguindo um passo a passo simples, sem precisar de técnico.
4. **"Só tem 1 ou 2 computadores e cada um paga separado."**
   Cada chave já libera os computadores do plano: 1 no Base, 3 no Pro e 50 ou mais no Enterprise.
5. **"Quando preciso de ajuda, ninguém responde."**
   Atendimento em português, com prioridade para quem é Pro e gerente dedicado para quem é Enterprise.
6. **"Tenho medo de problema com dados dos clientes."**
   Seus dados ficam protegidos, com acesso só de quem você autorizar e regras alinhadas à lei de proteção de dados (LGPD) — sem promessa milagrosa, com cuidado de verdade.

---

## D. BLACKLIST de jargão (proibido → como dizer)

Regra: se um dono de loja não entenderia a palavra em 3 segundos, ela não entra na landing.

| Proibido (não usar) | Usar no lugar |
|---|---|
| licença offline 7 dias / licença offline 30 dias | funciona até 7 dias sem internet / funciona até 30 dias sem internet |
| máquinas / dispositivos / múltiplos devices | computadores |
| tolerância degradada / modo degradado / grace | período extra de funcionamento após o vencimento (explique em dias) [dado — confirmar: quantos dias] |
| requisições/s, req/s | nunca usar; se precisar falar de capacidade, dizer "aguenta o movimento da sua loja/escritório" |
| latência | nunca usar; dizer "responde rápido" |
| uptime, SLA 99.99%, disponibilidade | dizer "funciona de forma estável" (Enterprise: "acordo de atendimento com prazo garantido" — só se o contrato existir [dado — confirmar]) |
| JWT, httpOnly, cookie, token | nunca usar na landing (é assunto interno) |
| API, webhook, HMAC | nunca usar na landing; na área do cliente, se inevitável, explicar entre parênteses |
| SSO/SAML/OIDC, on-premise, deploy | "entrada única para a equipe" / "instalado dentro da sua empresa, nos seus computadores" |
| sincronização WebSocket / em tempo real | "atualiza sozinho quando tem internet" |
| multi-database, arquitetura, BFF, PWA, SAML | nunca usar na landing |
| Asaas (nome do fornecedor interno) | "pagamento seguro" (Pix, boleto ou cartão) |
| desenvolvedores independentes, projetos menores | "empresas pequenas", "negócios começando agora" |
| Windows/Mac/Web, desktop | "funciona no computador da loja e do escritório" (detalhar sistemas na página do produto, não no título) |
| auditoria avançada / completa (sozinho) | "registro do que cada pessoa fez no sistema" |
| ativação instantânea (sozinho, sem prova) | "chave liberada logo após a confirmação do pagamento" |

**Cheque rápido antes de publicar:** procurar no texto por `API, JWT, webhook, HMAC, uptime, latência, req, SSO, on-premise, deploy, Asaas, máquina, degradad, multi-` — se achar, reescrever.

---

## E. Números de linguagem de negócio (trocar métrica técnica por fato útil)

Mostrar estes números na landing. Tudo que não está provado vai marcado.

| Mostrar (linguagem simples) | Situação |
|---|---|
| Chave liberada logo após a confirmação do pagamento | [dado — confirmar: prazo real médio] |
| Funciona até 7 dias sem internet (Base e Pro) | confirmado no catálogo atual |
| Funciona até 30 dias sem internet (Enterprise) | confirmado no catálogo atual |
| 1 computador por chave (Base), 3 (Pro), 50 ou mais (Enterprise) | confirmado no catálogo atual |
| Pagamento por Pix, boleto ou cartão, com nota fiscal | confirmado (meios); nota fiscal [dado — confirmar] |
| Cancele quando quiser, sem multa | [dado — confirmar: política oficial] |
| Atendimento em português; Pro com prioridade; Enterprise com gerente dedicado | confirmado na oferta; tempos de resposta [dado — confirmar: não prometer "24h"/"24/7" sem escala real] |
| Preços e desconto do plano anual | [dado — confirmar: tabela oficial — os valores atuais nos arquivos são de teste e não devem ir ao ar] |
| Quantidade de empresas que usam, depoimentos, economia gerada | NÃO mostrar até existir de verdade — sem inventar cliente, sem inventar porcentagem |

**Nunca mostrar:** qualquer número técnico (respostas por segundo, tempo de resposta, porcentagem de estabilidade, versão de protocolo). O comprador não decide por isso e desconfia de promessa técnica.

---

## F. Copy deck por seção (pronto para aplicar)

> Observação de honestidade: nenhum texto abaixo inventa cliente, número ou prazo.
> Onde falta definição do negócio, há marca [dado — confirmar].

### 1. Topo (hero)

- **Título:** Programas prontos para a sua empresa, que funcionam mesmo sem internet
- **Subtítulo:** Você paga com Pix, boleto ou cartão, recebe a chave logo após o pagamento e instala nos computadores da sua empresa. Sem técnico, sem complicação e com ajuda em português.
- **Bullets:**
  - Funciona até 7 dias sem internet nos planos Base e Pro (até 30 dias no Enterprise).
  - 1 computador por chave no Base, 3 no Pro e 50 ou mais no Enterprise.
  - Cancele quando quiser, sem multa [dado — confirmar].
  - Atendimento de gente de verdade, em português.
- **Observação:** preço "a partir de" só entra aqui quando a tabela oficial existir.

### 2. Faixa de confiança (logo abaixo do topo)

- **Título pequeno:** Feito para empresas que não podem parar
- **Subtítulo:** Sem jargão, sem surpresa na conta, sem ficar sem ajuda.
- **Bullets (selos em texto, não inventar selo gráfico):**
  - Pagamento seguro: Pix, boleto ou cartão.
  - Chave liberada após a confirmação do pagamento.
  - Nota fiscal para a sua empresa [dado — confirmar].
  - Dados tratados com cuidado, seguindo a lei de proteção de dados (LGPD).
  - Cancele quando quiser [dado — confirmar].
- **Observação:** não usar logos de clientes, prêmios ou "milhares de empresas" até existir prova real.

### 3. Produtos (os 3 planos)

- **Título da seção:** Escolha o plano do tamanho da sua empresa
- **Subtítulo:** Os três funcionam sem internet e liberam a chave após o pagamento. A diferença é quantos computadores e quanta ajuda você recebe.

**Aurum Base — para começar**

- **Descrição:** O essencial para quem tem 1 computador e quer resolver o básico bem feito.
- **Bullets:**
  - Funciona até 7 dias sem internet.
  - 1 computador por chave.
  - Chave liberada após a confirmação do pagamento.
  - Ajuda em português por e-mail.
  - Atualizações incluídas enquanto a assinatura estiver ativa [dado — confirmar].

**Aurum Pro — para quem tem movimento (destaque: "o mais escolhido" só se for verdade [dado — confirmar])**

- **Descrição:** O completo para lojas e escritórios com até 3 computadores e atendimento mais rápido.
- **Bullets:**
  - Funciona até 7 dias sem internet.
  - 3 computadores por chave.
  - Chave liberada após a confirmação do pagamento.
  - Atendimento prioritário em português.
  - Atualizações incluídas enquanto a assinatura estiver ativa [dado — confirmar].

**Aurum Enterprise — para operações grandes**

- **Descrição:** Para empresas com muitos computadores, que precisam de controle e de alguém para chamar pelo nome.
- **Bullets:**
  - Funciona até 30 dias sem internet.
  - 50 computadores ou mais por chave [dado — confirmar: limite e expansão].
  - Instalação dentro da sua empresa, nos seus computadores.
  - Entrada única para a equipe e registro do que cada pessoa fez no sistema.
  - Gerente dedicado e acordo de atendimento com prazo garantido [dado — confirmar].

### 4. Dores ("A AurumBit resolve")

- **Título:** O que trava a sua empresa hoje — e como a AurumBit resolve
- **Subtítulo:** Sem trocar tudo de lugar, sem parar o atendimento, sem precisar de técnico.
- **Bullets (dor → solução):**
  - A internet caiu e o trabalho parou → o programa continua funcionando por dias e atualiza sozinho depois.
  - Cada computador paga separado e a conta confunde → cada chave já inclui os computadores do plano.
  - Instalar programa novo é complicado → passo a passo simples, com ajuda em português.
  - Ninguém responde quando você precisa → atendimento em português, com prioridade para o Pro e gerente dedicado no Enterprise.
  - Medo de usar dado de cliente errado → acesso só para quem você autorizar e cuidado alinhado à LGPD.

### 5. Serviços ("Feito sob medida")

- **Título:** Precisa de algo do seu jeito? A gente monta para você
- **Subtítulo:** Se o programa pronto não cobre tudo, nossa equipe adapta ou cria a solução para a sua operação — você acompanha cada etapa.
- **Bullets:**
  - Conversa inicial para entender o que a sua empresa precisa (sem compromisso) [dado — confirmar: a conversa é gratuita?].
  - Proposta com preço fechado e prazo antes de começar [dado — confirmar].
  - Instalação e ajuste com acompanhamento da nossa equipe.
  - Treino simples para a sua equipe usar sem depender de técnico.
  - Ajuda em português depois da entrega [dado — confirmar: condições].

### 6. Como funciona (3 passos)

- **Título:** Do pagamento ao trabalho em 3 passos
- **Subtítulo:** Sem proposta demorada, sem instalador complicado.
- **Passos:**
  1. **Você escolhe o plano e paga** — Pix, boleto ou cartão, com total e condições escritos antes de confirmar.
  2. **Você recebe a chave** — liberada logo após a confirmação do pagamento, com o passo a passo de instalação [dado — confirmar: prazo e canal de entrega].
  3. **Você instala e usa** — nos computadores liberados pelo plano, com ou sem internet, e com ajuda em português se travar em algo.

### 7. Perguntas frequentes (6 Q&A)

**1. Funciona sem internet mesmo?**
Sim. Os planos Base e Pro funcionam até 7 dias sem internet; o Enterprise, até 30 dias. Quando a internet volta, o sistema atualiza sozinho o que mudou nesse período.

**2. Como instalo? Preciso de técnico?**
Não. Você recebe a chave após a confirmação do pagamento e segue um passo a passo simples no próprio computador. Se travar, nosso atendimento ajuda em português.

**3. Em quantos computadores posso usar?**
Depende do plano: 1 computador no Base, 3 no Pro e 50 ou mais no Enterprise. Se trocar de computador, você transfere a chave seguindo as regras do plano [dado — confirmar: regra de transferência].

**4. Quais são as formas de pagamento? Tem nota fiscal?**
Pix, boleto ou cartão, em ambiente de pagamento seguro. Sobre nota fiscal e planos mensal/anual com desconto: [dado — confirmar: tabela e documentos fiscais].

**5. Posso cancelar quando quiser?**
[Resposta pendente — confirmar e escrever aqui a política oficial: prazo, multa (idealmente nenhuma), o que acontece com o acesso após o cancelamento e reembolso. Não publicar "sem multa" até confirmar.]

**6. Meus dados e os dos meus clientes estão protegidos?**
Sim, com cuidado de verdade: acesso só para quem você autorizar, registros de uso e práticas alinhadas à lei de proteção de dados (LGPD). Não prometemos "segurança absoluta" — nenhuma empresa séria promete isso — mas tratamos seus dados com responsabilidade e explicamos como, se você pedir.

### 8. Chamada final (CTA de fechamento)

- **Título:** Sua empresa funcionando com ou sem internet, ainda esta semana
- **Subtítulo:** Escolha o plano, pague do seu jeito e receba a chave com o passo a passo. E se precisar, tem gente de verdade para ajudar em português.
- **Bullets de reforço:**
  - Preço claro antes de pagar.
  - Chave após a confirmação do pagamento.
  - Cancele quando quiser [dado — confirmar].

---

## G. Recomendações de botão (CTA) por seção

| Seção | Botão principal | Botão secundário |
|---|---|---|
| Topo | Ver planos e preços | Como funciona |
| Faixa de confiança | (sem botão — é faixa de leitura) | (sem botão) |
| Produtos | Quero o Base / Quero o Pro / Falar com a AurumBit (Enterprise) | Comparar planos (âncora para a tabela) |
| Dores | Ver planos e preços | Tirar dúvidas (âncora para FAQ) |
| Serviços | Pedir uma proposta | Ver programas prontos |
| Como funciona | Começar agora | Ver planos e preços |
| FAQ | Começar agora | Falar com atendimento [dado — confirmar: canal — WhatsApp, e-mail, chat?] |
| Chamada final | Ver planos e preços | Falar com atendimento |

**Regras dos botões:**

1. Um pedido por botão. Nunca "Saiba mais" — diga o que acontece: "Ver planos", "Começar agora", "Pedir uma proposta".
2. Enterprise sempre leva a conversa ("Falar com a AurumBit"), nunca a compra direta — empresa grande não compra no clique.
3. Depois do pagamento, o botão vira instrução: "Receber minha chave" / "Instalar agora" — não "Acessar dashboard".
4. Nenhum botão promete o que não existe: sem "Teste grátis" até existir teste grátis de verdade.

---

## Fontes e base da pesquisa (resumo)

- Padrões observados em TOTVS (planos pequenos a partir de faixa mensal baixa, prova por volume de empresas, FAQ sobre implantação/módulos/contratação), ContaAzul (linguagem simples, planos por faturamento, "sem cartão", "fácil implantação"), Omie (7 dias grátis, sem fidelidade, cancelamento rápido, prova por número de empresas), Bling (30 dias grátis, "suporte humano especialista", linguagem de sonho/rotina) e Tiny/Olist (preço de entrada baixo, simplicidade, nota em 1 minuto).
- Estrutura de alta conversão recorrente na literatura 2025–2026: título com resultado + subtítulo com mecanismo, prova logo no topo, benefícios antes de recursos, 3 passos de como funciona, FAQ quebrando objeções antes do CTA final, um pedido por seção, preço visível para tíquete baixo.
- Objeções mapeadas em literatura de ERP para PME: "empresa pequena demais", "caro demais", "implantação longa", "não atende meu jeito de trabalhar", "vai distrair a equipe" — respondidas no deck com simplicidade, preço claro, instalação sem técnico e cancelamento livre.
- LGPD (Lei nº 13.709/2018, art. 46 e 50): promessas honestas, sem "100% seguro"; controles reais ficam em documento técnico, nunca como slogan.
- Diferencial offline: concorrentes de gestão em nuvem param sem internet; o discurso "continua funcionando por dias" é o posicionamento mais distintivo e deve liderar o topo.

## Pendências para o fundador (nada disto vai ao ar sem resposta)

1. Tabela oficial de preços (mensal/anual, desconto, limites) — os valores nos arquivos atuais são de teste.
2. Política de cancelamento e reembolso (prazo, multa, o que acontece com o acesso).
3. Prazo e canal reais de entrega da chave após o pagamento.
4. Regra de troca/transferência de computador por chave.
5. Tempos de resposta do suporte por plano e canal oficial de atendimento.
6. Nota fiscal: o que é emitido e para quais planos.
7. Enterprise: limite real de computadores, condições de instalação interna, acordo de atendimento e gerente dedicado.
8. Existe teste grátis? Se sim, regras. Se não, remover qualquer menção.
