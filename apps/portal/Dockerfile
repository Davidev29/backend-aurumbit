# apps/portal/Dockerfile — Portal público + área do cliente (Next.js standalone)
FROM node:20-alpine AS deps
WORKDIR /app
COPY apps/portal/package.json apps/portal/package-lock.json* apps/portal/pnpm-lock.yaml* apps/portal/yarn.lock* ./
RUN \
  if [ -f pnpm-lock.yaml ]; then npm i -g pnpm && pnpm i --frozen-lockfile; \
  elif [ -f yarn.lock ]; then yarn --frozen-lockfile; \
  elif [ -f package-lock.json ]; then npm ci; \
  else npm i; fi

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY apps/portal ./apps/portal
WORKDIR /app/apps/portal
RUN mkdir -p ./public
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
RUN addgroup -S nextjs && adduser -S nextjs -G nextjs
COPY --from=builder /app/apps/portal/.next/standalone ./
COPY --from=builder /app/apps/portal/.next/static ./.next/static
COPY --from=builder /app/apps/portal/public ./public
COPY --from=deps /app/node_modules ./node_modules
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
