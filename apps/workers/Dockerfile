# apps/workers/Dockerfile — multi-stage node:22-alpine, non-root.
# Contexto de build: RAIZ do repo (docker build -f apps/workers/Dockerfile .).
# TODO(T1): migrar para pnpm + turbo prune.

FROM node:22-alpine AS deps
WORKDIR /app/apps/workers
COPY apps/workers/package*.json ./
RUN npm install --no-audit --no-fund

FROM node:22-alpine AS builder
WORKDIR /app/apps/workers
COPY --from=deps /app/apps/workers/node_modules ./node_modules
COPY apps/workers ./
COPY tsconfig.base.json /app/tsconfig.base.json
RUN npm run build

FROM node:22-alpine AS runner
ENV NODE_ENV=production
RUN addgroup -S nodejs && adduser -S nestjs -G nodejs
WORKDIR /app/apps/workers
COPY apps/workers/package*.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=builder /app/apps/workers/dist ./dist
RUN chown -R nestjs:nodejs /app/apps/workers
USER nestjs
CMD ["node", "dist/main"]
