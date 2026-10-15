# Colocando em produção na VPS — guia simples e completo

> Para quem nunca subiu o sistema: subir a landing page, testar o fluxo de
> compra de verdade e operar o administrativo. Detalhamento técnico profundo
> vive em `docs/RUNBOOKS/deploy.md` — aqui está o caminho feliz, em ordem,
> sem pular nada. Todo bloco termina num **teste que prova que funcionou**.

## 0. O que você precisa ter em mãos

| Item | Onde conseguir | Para quê |
|---|---|---|
| VPS Ubuntu 24.04, 4 GB RAM (8 GB confortável) | sua provedora | rodar tudo |
| Domínio `aurumbit.com` com acesso ao DNS | seu registrador | landing + admin + API |
| Conta Asaas **produção** (API key + webhook secret) | painel Asaas, conta prod — nunca sandbox aqui | cobrar de verdade |
| Conta Resend + domínio verificado (SPF/DKIM/DMARC) | painel Resend | e-mails transacionais |
| Chave SSH (ed25519) no seu computador | `ssh-keygen -t ed25519` | acessar a VPS sem senha |

Regra de ouro: **nenhum segredo vai para git, chat ou log.** Senhas e chaves
vivem em arquivos `chmod 600` só na VPS (+ cópia cifrada fora dela).

## 1. Preparar a VPS (30–60 min, a maioria é espera do DNS)

**1.1.** 24–48h antes: baixe o TTL do DNS para 300s nos 3 hosts
(`aurumbit.com`, `admin.aurumbit.com`, `api.aurumbit.com`) e configure
SPF/DKIM/DMARC do Resend. Sem isso, nada adiante funciona bem.

```bash
# Da SUA máquina — teste que prova:
dig +short aurumbit.com | head -3
dig TXT aurumbit.com +short            # espera: v=spf1 ... resend
dig TXT resend._domainkey.aurumbit.com +short
dig TXT _dmarc.aurumbit.com +short
```

**1.2.** Primeiro acesso + proteção (na VPS, como root):

```bash
ssh root@SEU_IP_DA_VPS
git clone <URL-DO-REPO> /srv/aurum && cd /srv/aurum
bash deploy/scripts/harden-vps.sh --dry-run     # só mostra o que faria
# Na SUA máquina: ssh-keygen -lf ~/.ssh/id_ed25519.pub  → copie o fingerprint
ALLOW_SSH_KEY="SHA256:..." bash deploy/scripts/harden-vps.sh --apply
ufw status verbose            # espera: só 22/80/443 ALLOW
```

> Mantenha uma segunda sessão SSH aberta antes do `--apply`. Se algo falhar,
> restaure com o backup que o próprio script guarda.

**1.3.** Docker + swap:

```bash
apt-get update && apt-get install -y ca-certificates curl gnupg
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" > /etc/apt/sources.list.d/docker.list
apt-get update && apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
fallocate -l 4G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=4096
chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
grep -q /swapfile /etc/fstab || echo "/swapfile none swap sw 0 0" >> /etc/fstab
docker --version && docker compose version   # teste que prova
```

## 2. Subir a landing page (portal) + API + admin

**2.1.** Gere o ambiente de produção (senhas fortes, nunca reuse as de dev):

```bash
cd /srv/aurum
bash deploy/scripts/gen-prod-env.sh
# Complete no arquivo gerado: ASAAS_API_KEY/SECRET (prod, do cofre) e
# RESEND_API_KEY (conta prod). Domínios: NEXT_PUBLIC_API_URL=https://api.aurumbit.com
chmod 600 .env.prod  # (o script já faz; confira)
grep -q ADMIN_DEV_OPEN .env.prod && { echo "FAIL: ADMIN_DEV_OPEN presente"; exit 1; } || echo ENV-OK
```

**2.2.** Checkpoint irreversível — faça ANTES de continuar: guarde cópia
**cifrada** do `.env.prod` + do arquivo da chave-mestra de licenças **fora da VPS**.
Perder a chave-mestra = licenças emitidas nunca mais podem ser reexibidas.

```bash
gpg -c .env.prod   # gera .env.prod.gpg com senha forte do cofre
rclone copy .env.prod.gpg <seu-remoto>:aurum-bit/env-backups/
```

**2.3.** Build travado por versão + banco + dados iniciais + subida:

```bash
bash deploy/scripts/tag-images.sh            # build com tag = git SHA (nunca :latest)
bash deploy/scripts/migrate-all.sh           # cria as tabelas nos 9 schemas do banco aurumbit
bash deploy/scripts/seed-all.sh              # admin demo + catálogo (planos, features)
docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.prod.yml up -d
curl -fsS http://localhost:3000/health/ready   # espera: {"status":"ok"}
curl -fsS http://localhost:3000/health/live    # espera: 200
```

> `NEXT_PUBLIC_*` é assada no build do Next: trocar valor depois exige
> rebuild (`tag-images.sh`) + `up -d`. Nunca edite só o `.env` esperando efeito.

**2.4.** Aponte o DNS e valide o TLS (só depois do passo 2.3 verde):

```bash
# 1) Aponte os 3 A-records para o IP da VPS. 2) Aguarde o Caddy emitir os certs. 3) Teste:
curl -sI https://aurumbit.com/ | head -3                    # 200 (landing page no ar)
curl -sI https://www.aurumbit.com/ | grep -i location       # redirect → apex
curl -sI https://api.aurumbit.com/health/live | head -1     # 200
curl -sI https://admin.aurumbit.com/ | head -1              # 200 (tela de login)
echo | openssl s_client -connect aurumbit.com:443 2>/dev/null | openssl x509 -noout -dates
```

✅ **Landing page no ar = `https://aurumbit.com/` responde 200 com a vitrine**
(herói, planos e preços vindos da API — se aparecer conteúdo de exemplo/mock,
o portal não alcançou a API: volte ao passo 2.3).

## 3. Testar o fluxo de compra de verdade (com dinheiro simbólico)

> Nunca teste com valor real cheio. O ritual é: **compra mínima → confirma
> licença → estorna**. Só prossiga para vendas reais com esse ciclo verde.

**3.1.** No portal (`https://aurumbit.com/`): escolha o plano mais barato,
vá ao checkout (`/checkout`) e pague (PIX/cartão conforme o Asaas liberar).
A tela só mostra "concluído" **depois** da cobrança confirmada — `done` sem
cobrança é bug, reporte.

**3.2.** Prove cada elo (na VPS ou na sua máquina):

```bash
# 1) Fatura paga existe e virou licença vitalícia/ativa (troque os IDs):
curl -fsS https://api.aurumbit.com/v1/invoices | grep -o '"status":"PAID"' | head -1
# 2) Re-entrega do MESMO webhook não duplica nada (idempotência):
#    repita no painel Asaas o reenvio do evento → 2ª resposta deve ser DUPLICATE 200,
#    sem 2ª cobrança e sem 2ª licença.
# 3) Acesso liberado no canal certo:
curl -fsS 'https://api.aurumbit.com/v1/access/check?...' | grep -o '"decision":"ALLOW"'
```

**3.3.** No portal, entre na área do cliente (`/dashboard`): fatura aparece em
`faturas`, a licença em `sistemas`, seus dados em `perfil`. Confira o e-mail
`payment-confirmed` na caixa de entrada (se não chegou, volte ao SPF/DKIM do passo 1.1).

**3.4.** Estorne a cobrança de teste no painel Asaas e confirme que a fatura
mudou de estado sem quebrar a trilha (reembolso aparece, sem apagar histórico).

✅ **Fluxo provado = pagou pouco, virou licença, duplicata não duplica, estornou.**

Antes de vender de verdade, cadastre no painel Asaas **prod** a URL do webhook
(aponta para `https://api.aurumbit.com/v1/billing/webhooks/asaas`) e rode uma
vez o smoke automatizado:

```bash
bash deploy/scripts/smoke-prod.sh   # home, produtos, checkout mínimo, duplicata, login admin, health
```

## 4. Consumir o administrativo (`https://admin.aurumbit.com/`)

**4.1.** Primeiro acesso: entre com o admin demo criado pelo seed e **troque a
senha imediatamente** (é obrigatória). Ative MFA na sua conta — telas sensíveis
exigem.

**4.2.** Tour guiado pelo menu (cada tela lê da API de verdade; sem backend,
elas mostram vazio/erro — nunca dado inventado):

| Tela | Para que serve no dia a dia |
|---|---|
| `dashboard` | saúde da operação num relance |
| `clientes` | achar titular (PF/PJ), ver perfil e consentimentos |
| `assinaturas` | estado de cada assinatura (ativa, inadimplente, cancelada) |
| `cobrancas` | faturas, pagamentos, reembolsos + reenvio de webhook |
| `financeiro` | previsto × pendente × realizado, contas e projeções (exige concessão `finance.read` explícita — sem ela, 403) |
| `produtos` | catálogo, planos e features (preço congela por linha — não se edita preço vigente) |
| `auditoria` | quem fez o quê, quando e por quê (trilha append-only de 5 anos) |
| `filas` | DLQ e replay de eventos travados |
| `usuarios` | concessões de acesso (`ADMIN`, `FINANCE`...), último OWNER é protegido |
| `notificacoes` / `perfil` | avisos do sistema e sua conta |

**4.3.** Rotina semanal do operador (15 min):

1. `cobrancas`: algum `PAID` sem licença correspondente? (reconciliação acusa sozinha — confira o alerta)
2. `filas`: DLQ zerada? Se não, replay + investigar a causa antes de limpar.
3. `financeiro`: realizado do mês confere com o extrato Asaas?
4. Na VPS: `ls -lh /var/backups/aurum/ | tail -3` (backup do dia existe?) e `crontab -l | grep -E "backup|restore"` (agendamentos ativos?).

## 5. Quando algo der errado (atalhos)

| Sintoma | Ação |
|---|---|
| Landing fora do ar | `docker compose ps` → `docker compose logs portal --tail=100`; portal 502 = API fora (veja abaixo) |
| API 503 no `/ready` | `docker compose logs api/postgres --tail=100`; causa comum: migração pendente → `bash deploy/scripts/migrate-all.sh` |
| Login do admin falha | confira `API_INTERNAL_URL` e se a API está 200; `ADMIN_DEV_OPEN` jamais existe em prod |
| E-mail não chega | SPF/DKIM/DMARC (passo 1.1) + `RESEND_API_KEY` de prod + `RESEND_FROM` no domínio verificado |
| Webhook Asaas rejeitado em massa | relógio da VPS (`timedatectl`, `chronyc tracking`) — skew quebra assinatura |
| Precisa voltar atrás | rollback = imagem pela tag SHA anterior + `up -d` (+ DNS de volta; TTL 300 ajuda) — detalhes em `docs/RUNBOOKS/deploy.md` §7 |

Referência completa (cada gate com assert copiável): `docs/RUNBOOKS/deploy.md`.
Contrato comercial (o que cada plano libera e onde): `docs/RUNBOOKS/commercial.md`.
