# Lumoras Growth (apps/seo): one image, two containers.
#   web:    the default CMD below: applies migrations as the owner role, then serves on 3007
#   worker: command ["node", "--import", "tsx", "worker/index.ts"]
# Build from the repository root (the workspace):
#   docker build -f apps/seo/Dockerfile -t lumoras-seo .
# Compose: apps/seo/deploy/docker-compose.yml. Not deployed by the build session.
FROM node:22-bookworm-slim

ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_HOME=/corepack \
    NEXT_TELEMETRY_DISABLED=1
RUN corepack enable

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/seo/package.json apps/seo/package.json
COPY packages/ui-tokens/package.json packages/ui-tokens/package.json
COPY packages/ui-field/package.json packages/ui-field/package.json
RUN pnpm install --frozen-lockfile --filter seo...

COPY packages packages
COPY apps/seo apps/seo
RUN pnpm --filter seo build

ENV NODE_ENV=production \
    PORT=3007
WORKDIR /app/apps/seo
RUN chown -R node:node .next && chmod -R a+rX /corepack
USER node
EXPOSE 3007
CMD ["sh", "docker/start-web.sh"]
