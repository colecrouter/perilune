FROM node:24.22.1-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS build
WORKDIR /app
RUN npm install --global pnpm@12.11.2
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY patches ./patches
# Synchronization needs the application source, so defer the prepare hook.
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY . .
RUN pnpm run build && pnpm prune --prod --ignore-scripts

FROM node:24.22.1-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS runtime
ARG VERSION=development
ARG REVISION=unknown
ARG CREATED
LABEL org.opencontainers.image.source="https://github.com/colecrouter/perilune" \
      org.opencontainers.image.licenses="GPL-3.0-only" \
      org.opencontainers.image.version="$VERSION" \
      org.opencontainers.image.revision="$REVISION" \
      org.opencontainers.image.created="$CREATED"
ENV PERILUNE_BUILD_VERSION=$VERSION PERILUNE_BUILD_REVISION=$REVISION
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 PERILUNE_DATABASE=/app/data/perilune.sqlite
WORKDIR /app
COPY --from=build --chown=node:node /app/build ./build
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/scripts/server.mjs ./scripts/server.mjs
COPY --from=build --chown=node:node /app/scripts/auth.mjs ./scripts/auth.mjs
COPY --from=build --chown=node:node /app/scripts/backup.mjs ./scripts/backup.mjs
COPY --from=build --chown=node:node /app/scripts/restore.mjs ./scripts/restore.mjs
COPY --from=build --chown=node:node /app/src/lib/server/auth/*.sql ./src/lib/server/auth/
COPY --from=build --chown=node:node /app/src/lib/server/auth/process-lock.mjs ./src/lib/server/auth/process-lock.mjs
RUN mkdir /app/data /app/backups && chown node:node /app/data /app/backups
USER node
EXPOSE 3000
CMD ["node", "scripts/server.mjs"]
