# apps/api/Dockerfile — multi-stage node:22-alpine, non-root.
# Contexto de build: RAIZ do repo (docker build -f apps/api/Dockerfile .).
# TODO(T1): migrar para pnpm + turbo prune.

FROM node:22-alpine AS deps
WORKDIR /app/apps/api
COPY apps/api/package*.json ./
RUN npm install --no-audit --no-fund

FROM node:22-alpine AS builder
WORKDIR /app/apps/api
COPY --from=deps /app/apps/api/node_modules ./node_modules
COPY apps/api ./
COPY tsconfig.base.json /app/tsconfig.base.json
RUN npm run build

FROM node:22-alpine AS runner
ENV NODE_ENV=production
RUN addgroup -S nodejs && adduser -S nestjs -G nodejs
WORKDIR /app/apps/api
COPY apps/api/package*.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=builder /app/apps/api/dist ./dist
# Spec OpenAPI servida pelo Swagger UI (common/openapi/swagger.ts) — resolvida
# subindo a árvore a partir do cwd (/app/apps/api → /app/docs). Ou use
# OPENAPI_SPEC_PATH para apontar outro caminho.
COPY docs/openapi.yaml /app/docs/openapi.yaml
RUN chown -R nestjs:nodejs /app/apps/api
USER nestjs
EXPOSE 3000
CMD ["node", "dist/src/main"]
