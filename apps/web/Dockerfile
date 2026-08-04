# SPDX-License-Identifier: AGPL-3.0-only
FROM node:24-bookworm-slim@sha256:cd84903a12dbd26b46f1f3b8144a2568c41c5d37ddd0c7a80a34c7a19786b35f AS build

WORKDIR /source
ENV CI=1
RUN corepack enable && corepack prepare pnpm@9.12.3 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY LICENSE ./LICENSE
COPY apps/web ./apps/web
COPY packages ./packages
RUN pnpm install --frozen-lockfile
ARG VITE_API_BASE_URL=/api
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN pnpm exec tsc -b --force packages/shared/tsconfig.json packages/markdown-exporter/tsconfig.json apps/web/tsconfig.json \
  && pnpm --filter @infosteed/web build

FROM nginxinc/nginx-unprivileged:1.29-alpine@sha256:0c79d56aee561a1d81c63f00eee5fb5fe29279560cdc55e91425133104c7fbe6
COPY infra/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /source/apps/web/dist /usr/share/nginx/html
COPY LICENSE /usr/share/nginx/html/LICENSE
EXPOSE 8080
