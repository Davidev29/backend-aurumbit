# apps/api/Dockerfile — multi-stage node:22-alpine, non-root.
# Contexto de build: RAIZ do repo (docker build -f apps/api/Dockerfile .).
# T4: pnpm workspace + `turbo prune --docker` — a imagem leva só a API e o que
# ela depende (libs/contracts), com lockfile podado (build reprodutível; antes
# o `npm install` sem lockfile podia pegar versões diferentes a cada build).

FROM node:22-alpine AS base
RUN apk add --no-cache libc6-compat
WORKDIR /app
ENV PNPM_VERSION=9.0.0
RUN npm install -g pnpm@${PNPM_VERSION}

FROM base AS prepare
RUN apk add --no-cache curl
# Binário do turbo fixado (docs oficiais 2.11.7: standalone ≥ 2.11.5, SHA256 verificado).
ARG TURBO_VERSION=2.11.7
RUN set -eu; \
    case "$(uname -m)" in \
      x86_64) target=x86_64-unknown-linux-musl ;; \
      aarch64) target=aarch64-unknown-linux-musl ;; \
      *) echo 'Unsupported architecture' >&2; exit 1 ;; \
    esac; \
    archive="turbo-$TURBO_VERSION-$target.tar.gz"; \
    release="https://github.com/vercel/turborepo/releases/download/v$TURBO_VERSION"; \
    cd /tmp; \
    curl -fsSL "$release/SHA256SUMS" -o SHA256SUMS; \
    curl -fsSL "$release/$archive" -o "$archive"; \
    awk -v name="$archive" '$2 == name && NF == 2 { print }' SHA256SUMS > turbo-checksum; \
    [ "$(wc -l < turbo-checksum)" -eq 1 ]; \
    sha256sum -c turbo-checksum; \
    [ "$(tar -tzf "$archive")" = turbo ]; \
    tar -xzf "$archive" -C /usr/local/bin turbo; \
    chmod 755 /usr/local/bin/turbo; \
    rm SHA256SUMS turbo-checksum "$archive"
COPY . .
# O `.gitignore` fica fora do contexto Docker: sem ele o prune copiaria
# `*.tsbuildinfo` do working tree e o tsc incremental pularia a emissão.
RUN find . -name '*.tsbuildinfo' -delete
RUN turbo prune @aurum-bit/api --docker

FROM base AS deps
# Só manifests + lockfile podado: esta camada só invalida quando uma dep muda.
COPY --from=prepare /app/out/json/ .
RUN pnpm install --frozen-lockfile

FROM deps AS builder
COPY --from=prepare /app/out/full/ .
# tsconfig.base.json não entra no prune (não é package.json) — contrato de build.
COPY tsconfig.base.json ./tsconfig.base.json
RUN pnpm exec turbo run build --filter=@aurum-bit/api

FROM base AS runner
ENV NODE_ENV=production
RUN addgroup -S nodejs && adduser -S nestjs -G nodejs
WORKDIR /app
# Runtime: só dependências de produção do pacote podado (sem devDeps/toolchain).
COPY --from=prepare /app/out/json/ .
RUN pnpm install --prod --frozen-lockfile && pnpm store prune
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/libs/contracts/dist ./libs/contracts/dist
# Spec OpenAPI servida pelo Swagger UI (resolveOpenApiSpecPath sobe a árvore).
COPY docs/openapi.yaml /app/docs/openapi.yaml
RUN chown -R nestjs:nodejs /app
USER nestjs
EXPOSE 3000
CMD ["node", "apps/api/dist/src/main"]
