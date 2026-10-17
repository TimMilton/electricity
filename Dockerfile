# syntax=docker/dockerfile:1
#
# Образ вебзастосунку «Електрооблік будинку».
# Конфігурація (адреси й ключі Supabase) передається під час запуску —
# один образ працює з будь-яким Supabase (власним у docker compose або хмарним).

ARG NODE_IMAGE=node:22-alpine

# ---- залежності -------------------------------------------------------------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ---- збірка -----------------------------------------------------------------
FROM ${NODE_IMAGE} AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# postbuild копіює .next/static і public у .next/standalone
RUN npm run build

# ---- запуск -----------------------------------------------------------------
FROM ${NODE_IMAGE} AS runner
WORKDIR /app
RUN apk add --no-cache tzdata
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    TZ=Europe/Kyiv

COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/scripts/create-admin.mjs ./scripts/create-admin.mjs

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "server.js"]
