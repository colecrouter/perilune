FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN npm install --global pnpm@12.11.2
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY patches ./patches
# Synchronization needs the application source, so defer the prepare hook.
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY . .
RUN pnpm run build && pnpm prune --prod --ignore-scripts

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 PERILUNE_DATABASE=/app/data/perilune.sqlite
WORKDIR /app
COPY --from=build --chown=node:node /app/build ./build
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/scripts/server.mjs ./scripts/server.mjs
COPY --from=build --chown=node:node /app/scripts/auth.mjs ./scripts/auth.mjs
COPY --from=build --chown=node:node /app/scripts/backup.mjs ./scripts/backup.mjs
COPY --from=build --chown=node:node /app/src/lib/server/auth/*.sql ./src/lib/server/auth/
COPY --from=build --chown=node:node /app/src/lib/server/auth/process-lock.mjs ./src/lib/server/auth/process-lock.mjs
RUN mkdir /app/data && chown node:node /app/data
USER node
EXPOSE 3000
CMD ["node", "scripts/server.mjs"]
