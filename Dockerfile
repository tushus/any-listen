# 多阶段构建 - Alpine（体积小）
FROM node:22-alpine AS base

FROM base AS builder

ARG IS_CI
ARG GIT_COMMIT_ID
ARG GIT_COMMIT_DATE

WORKDIR /source-code

# 安装编译依赖 + icu
RUN apk add --update --no-cache \
    g++ \
    make \
    python3 \
    py3-pip \
    git \
    icu-data-full

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV WEB_SERVER_ONLY="true"

# 先复制依赖文件，利用缓存
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable pnpm && pnpm fetch

COPY . ./
RUN pnpm i --offline --frozen-lockfile

ENV IS_CI=${IS_CI}
ENV CI=${IS_CI}
ENV GIT_COMMIT_ID=${GIT_COMMIT_ID}
ENV GIT_COMMIT_DATE="${GIT_COMMIT_DATE}"

# 完整构建 Web 服务
RUN pnpm build:web

# ---------- 运行阶段 ----------
FROM base AS final

WORKDIR /server

RUN apk add --update --no-cache \
    icu-data-full \
    tzdata

# 创建非 root 用户
RUN addgroup -g 1001 -S algroup && \
    adduser -u 1001 -S anylisten -G algroup && \
    mkdir -p /server/data && \
    chown anylisten:algroup /server/data

COPY --from=builder --chown=anylisten:algroup /source-code/build ./

ENV DATA_PATH="/server/data"
ENV NODE_ENV="production"
ENV PORT="9500"
ENV BIND_IP="0.0.0.0"

EXPOSE 9500

USER anylisten

CMD ["node", "index.cjs"]
