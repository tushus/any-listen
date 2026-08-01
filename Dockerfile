# syntax=docker/dockerfile:1

FROM node:22-alpine AS builder

WORKDIR /source-code

RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    git \
    icu-data-full

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV WEB_SERVER_ONLY="true"

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable && corepack prepare pnpm@latest --activate && pnpm fetch

COPY . .
RUN pnpm install --offline --frozen-lockfile
RUN pnpm build:web

FROM node:22-alpine AS runner

WORKDIR /server

RUN apk add --no-cache icu-data-full tzdata

RUN addgroup -g 1001 -S algroup && \
    adduser -u 1001 -S anylisten -G algroup && \
    mkdir -p /server/data && \
    chown anylisten:algroup /server/data

COPY --from=builder --chown=anylisten:algroup /source-code/build ./

ENV NODE_ENV=production
ENV DATA_PATH=/server/data
ENV PORT=9500
ENV BIND_IP=0.0.0.0

EXPOSE 9500
USER anylisten
CMD ["node", "index.cjs"]
