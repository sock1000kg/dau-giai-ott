# syntax=docker/dockerfile:1
# ------------------------------------------------------------------------------
# Build stage: install all workspace dependencies and compile TypeScript packages
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

# Copy shared tsconfig, sources required by @ott/platform-worker, dependencies, and bot policies
COPY src/tsconfig.base.json ./src/
COPY src/game-core/ ./src/game-core/
COPY src/bot-protocol/ ./src/bot-protocol/
COPY src/match-runner/ ./src/match-runner/
COPY src/platform/job-contract/ ./src/platform/job-contract/
COPY src/platform/api/ ./src/platform/api/
COPY src/platform/worker/ ./src/platform/worker/
COPY src/bots/ ./src/bots/

# Build platform-worker workspace package
RUN npm run build --workspace @ott/platform-worker

# ------------------------------------------------------------------------------
# Runtime stage: minimal Node 22 alpine image for worker and coordinator
# ------------------------------------------------------------------------------
# This image contains NO Docker CLI; the sandbox runtime communicates directly
# with Docker daemon via Node HTTP over /var/run/docker.sock.
FROM node:22.12-alpine AS runtime

WORKDIR /app

# Non-root user 'node' (UID 1000, GID 1000).
# When mounting the Docker socket (/var/run/docker.sock), Docker Compose must
# supply the socket group via 'group_add:' (e.g. group_add: ["${DOCKER_GID:-999}"])
# so that the non-root 'node' process can read/write the socket without hardcoding a GID.
RUN chown -R node:node /app

# Copy root configs and node_modules from build stage
COPY --chown=node:node --from=build /app/package.json /app/tsconfig.json ./
COPY --chown=node:node --from=build /app/node_modules ./node_modules

# Copy application sources, match runner, and bot policies (excluding *.oci.tar via .dockerignore)
COPY --chown=node:node --from=build /app/src/tsconfig.base.json ./src/
COPY --chown=node:node --from=build /app/src/game-core ./src/game-core
COPY --chown=node:node --from=build /app/src/bot-protocol ./src/bot-protocol
COPY --chown=node:node --from=build /app/src/match-runner ./src/match-runner
COPY --chown=node:node --from=build /app/src/platform/job-contract ./src/platform/job-contract
COPY --chown=node:node --from=build /app/src/platform/api ./src/platform/api
COPY --chown=node:node --from=build /app/src/platform/worker ./src/platform/worker
COPY --chown=node:node --from=build /app/src/bots ./src/bots

# Production runtime configuration
ENV NODE_ENV=production
ENV OTT_WORKER_METRICS_HOST=0.0.0.0
ENV OTT_COORD_METRICS_HOST=0.0.0.0
ENV OTT_DOCKER_SOCKET=/var/run/docker.sock

# Expose metrics & health endpoints:
# 9464 for job worker (src/platform/worker/src/runtime/config.ts:221)
# 9465 for coordinator (src/platform/worker/src/coordinator/config.ts:404)
EXPOSE 9464 9465

# Ensure /snapshots directory exists and is owned by non-root user 'node' (UID 1000)
# for snapshot volume mount initialization.
RUN mkdir -p /snapshots && chown node:node /snapshots

# Switch to non-root user
USER node

# Default command: start match worker (reads from BullMQ queue, executes jobs).
# To run coordinator instead, set command in Compose:
#   command: ["npm", "run", "start:coordinator", "--workspace", "@ott/platform-worker"]
CMD ["npm", "run", "start", "--workspace", "@ott/platform-worker"]
