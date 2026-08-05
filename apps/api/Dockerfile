# SPDX-License-Identifier: AGPL-3.0-only
FROM node:24-bookworm-slim@sha256:cd84903a12dbd26b46f1f3b8144a2568c41c5d37ddd0c7a80a34c7a19786b35f AS build

WORKDIR /source
ENV CI=1
RUN corepack enable && corepack prepare pnpm@9.12.3 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY LICENSE ./LICENSE
COPY apps/api ./apps/api
COPY apps/extension ./apps/extension
COPY packages ./packages
COPY scripts/package-extension.mjs ./scripts/package-extension.mjs
COPY artifacts ./prebuilt-extension-artifacts
RUN pnpm install --frozen-lockfile
RUN if [ -f prebuilt-extension-artifacts/extension-offline.zip ]; then \
    mkdir -p artifacts \
    && cp prebuilt-extension-artifacts/extension-offline.zip artifacts/ \
    && if [ -f prebuilt-extension-artifacts/extension-store.zip ]; then cp prebuilt-extension-artifacts/extension-store.zip artifacts/; fi \
    && if [ -f prebuilt-extension-artifacts/extension-checksums.sha256 ]; then cp prebuilt-extension-artifacts/extension-checksums.sha256 artifacts/; fi \
    && if [ -f prebuilt-extension-artifacts/extension-contents.txt ]; then cp prebuilt-extension-artifacts/extension-contents.txt artifacts/; fi; \
  else \
    node scripts/package-extension.mjs --chrome-only; \
  fi
RUN test ! -e artifacts/firefox-offline.xpi \
  && if [ -f artifacts/extension-checksums.sha256 ]; then ! grep -qi firefox artifacts/extension-checksums.sha256; fi \
  && if [ -f artifacts/extension-contents.txt ]; then ! grep -qi firefox artifacts/extension-contents.txt; fi
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
    /usr/lib/node_modules/npm \
    /usr/lib/node_modules/corepack \
    /usr/lib/node_modules/yarn \
    /usr/bin/npm \
    /usr/bin/npx \
    /usr/bin/corepack \
    /usr/bin/yarn \
    /usr/bin/yarnpkg
WORKDIR /app
COPY --from=build --chown=pwuser:pwuser /release ./
COPY --chown=pwuser:pwuser migrations ./migrations
COPY --from=build --chown=pwuser:pwuser /source/artifacts ./extension-artifacts

ENV NODE_ENV=production HOST=0.0.0.0 PORT=3777
USER pwuser
EXPOSE 3777
CMD ["node", "dist/server.js"]
