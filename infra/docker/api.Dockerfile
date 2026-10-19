# syntax=docker/dockerfile:1
# ------------------------------------------------------------------------------
# Build stage: install all workspace dependencies and build TypeScript packages
# ------------------------------------------------------------------------------
FROM node:22.12-alpine AS build

WORKDIR /app

# Copy root manifest and lockfile
COPY package.json package-lock.json tsconfig.json ./

# Copy all workspace package.json manifests for layer caching
COPY src/game-core/package.json ./src/game-core/
COPY src/bot-protocol/package.json ./src/bot-protocol/
COPY src/match-runner/package.json ./src/match-runner/
COPY src/platform/job-contract/package.json ./src/platform/job-contract/
COPY src/platform/api/package.json ./src/platform/api/
COPY src/platform/worker/package.json ./src/platform/worker/
COPY src/platform/web/package.json ./src/platform/web/
COPY src/bots/sandbox-corpus/package.json ./src/bots/sandbox-corpus/

# Install dependencies deterministically from lockfile
RUN npm ci

# Copy shared tsconfig and sources required by @ott/platform-api and its dependencies
COPY src/tsconfig.base.json ./src/
COPY src/game-core/ ./src/game-core/
COPY src/bot-protocol/ ./src/bot-protocol/
COPY src/match-runner/ ./src/match-runner/
COPY src/platform/job-contract/ ./src/platform/job-contract/
COPY src/platform/api/ ./src/platform/api/

# Build platform-api workspace package
RUN npm run build --workspace @ott/platform-api

# ------------------------------------------------------------------------------
# Runtime stage: minimal Node 22 alpine image running as non-root user
# ------------------------------------------------------------------------------
FROM node:22.12-alpine AS runtime

WORKDIR /app

# Non-root user provided by node:22-alpine base image (UID 1000)
# Set ownership of app directory before dropping privileges
RUN chown -R node:node /app

# Copy package manifest, root configs, and node_modules from build stage
COPY --chown=node:node --from=build /app/package.json /app/tsconfig.json ./
COPY --chown=node:node --from=build /app/node_modules ./node_modules

# Copy application sources, including SQL migrations in src/platform/api/migrations/
COPY --chown=node:node --from=build /app/src/tsconfig.base.json ./src/
COPY --chown=node:node --from=build /app/src/game-core ./src/game-core
COPY --chown=node:node --from=build /app/src/bot-protocol ./src/bot-protocol
COPY --chown=node:node --from=build /app/src/match-runner ./src/match-runner
COPY --chown=node:node --from=build /app/src/platform/job-contract ./src/platform/job-contract
COPY --chown=node:node --from=build /app/src/platform/api ./src/platform/api

# Production runtime configuration
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

# EXPOSE 3000 matches the default port defined in src/platform/api/src/runtime/config.ts:131-132
EXPOSE 3000

# Switch to non-root user 'node'
USER node

# Healthcheck hitting live endpoint using BusyBox wget in Alpine (/usr/bin/wget).
# (Alternative: node -e "fetch('http://127.0.0.1:3000/api/v1/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))")
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/v1/health/live > /dev/null || exit 1

# Default command: start platform-api.
# Alternative one-shot command for migration jobs: npm run db:migrate --workspace @ott/platform-api
CMD ["npm", "run", "start", "--workspace", "@ott/platform-api"]
