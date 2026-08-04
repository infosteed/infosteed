# SPDX-License-Identifier: AGPL-3.0-only
FROM node:24-bookworm-slim@sha256:cd84903a12dbd26b46f1f3b8144a2568c41c5d37ddd0c7a80a34c7a19786b35f AS build

WORKDIR /source
ENV CI=1
RUN corepack enable && corepack prepare pnpm@9.12.3 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api ./apps/api
COPY packages ./packages
RUN pnpm install --frozen-lockfile
RUN pnpm exec tsc -b --force \
  packages/shared/tsconfig.json \
  packages/ai-step-writer/tsconfig.json \
  packages/image-processor/tsconfig.json \
  packages/markdown-exporter/tsconfig.json \
  apps/api/tsconfig.json
RUN pnpm --filter @infosteed/api deploy --prod /release

FROM mcr.microsoft.com/playwright:v1.62.1-noble@sha256:dcc5531e97840b9b5e794f2814476b21571c5124a3fca2267d73041f56e7580e

USER root
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build --chown=pwuser:pwuser /release ./
COPY --chown=pwuser:pwuser migrations ./migrations

ENV NODE_ENV=production HOST=0.0.0.0 PORT=3777
USER pwuser
EXPOSE 3777
CMD ["node", "dist/server.js"]
