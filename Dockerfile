# lumoras.ai: built on VPS3 by
# phonon-orchestration-hub/docker/vps3/lumoras.ai/docker-compose.yml.
FROM node:22-bookworm-slim

# COREPACK_HOME outside root's home, so the pnpm fetched during the build is the
# one the node user runs at start.
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_HOME=/corepack \
    NEXT_TELEMETRY_DISABLED=1
RUN corepack enable

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile

COPY apps/web apps/web
RUN pnpm build

ENV NODE_ENV=production
WORKDIR /app/apps/web
RUN chown -R node:node .next && chmod -R a+rX /corepack
USER node
EXPOSE 3006
CMD ["pnpm", "start", "-H", "0.0.0.0", "-p", "3006"]
