# SPDX-License-Identifier: AGPL-3.0-only
FROM node:24-bookworm-slim@sha256:cd84903a12dbd26b46f1f3b8144a2568c41c5d37ddd0c7a80a34c7a19786b35f AS build

WORKDIR /source
ENV CI=1
RUN corepack enable && corepack prepare pnpm@9.12.3 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/video-render-worker ./apps/video-render-worker
COPY packages/shared ./packages/shared
RUN pnpm install --frozen-lockfile
RUN pnpm exec tsc -b --force packages/shared/tsconfig.json apps/video-render-worker/tsconfig.json
RUN pnpm --filter @infosteed/video-render-worker deploy --prod /release

FROM node:24-bookworm-slim@sha256:cd84903a12dbd26b46f1f3b8144a2568c41c5d37ddd0c7a80a34c7a19786b35f

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
    /usr/local/lib/node_modules/npm \
    /usr/local/lib/node_modules/corepack \
    /usr/local/bin/npm \
    /usr/local/bin/npx \
    /usr/local/bin/corepack \
    /usr/local/bin/pnpm \
    /usr/local/bin/pnpx \
    /usr/local/bin/yarn \
    /usr/local/bin/yarnpkg \
  && useradd --create-home --uid 10001 app
WORKDIR /app
COPY --from=build --chown=app:app /release ./
ENV NODE_ENV=production
USER app
CMD ["node", "dist/index.js"]
