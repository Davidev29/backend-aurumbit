# apps/portal/Dockerfile — multi-stage node:22-alpine, non-root.
# Contexto de build: RAIZ do repo (docker build -f apps/portal/Dockerfile .).
# T4: pnpm workspace + `turbo prune --docker`; runner = output standalone do
# Next com `outputFileTracingRoot` na raiz do monorepo (embarca contracts).

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
RUN turbo prune @aurum/portal --docker

FROM base AS deps
COPY --from=prepare /app/out/json/ .
RUN pnpm install --frozen-lockfile

FROM deps AS builder
COPY --from=prepare /app/out/full/ .
# tsconfig.base.json não entra no prune (não é package.json) — contracts/build usam.
COPY tsconfig.base.json ./tsconfig.base.json
RUN pnpm exec turbo run build --filter=@aurum/portal

FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
RUN addgroup -S nextjs && adduser -S nextjs -G nextjs
WORKDIR /app
# O standalone (tracing root = raiz) já contém node_modules traçados, incl.
# `@aurum-bit/contracts`; static/ e public/ ficam de fora por design do Next.
COPY --from=builder --chown=nextjs:nextjs /app/apps/portal/.next/standalone ./
COPY --from=builder --chown=nextjs:nextjs /app/apps/portal/.next/static ./apps/portal/.next/static
COPY --from=builder --chown=nextjs:nextjs /app/apps/portal/public ./apps/portal/public
USER nextjs
EXPOSE 3000
CMD ["node", "apps/portal/server.js"]
