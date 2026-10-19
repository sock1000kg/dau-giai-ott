# syntax=docker/dockerfile:1
# ------------------------------------------------------------------------------
# Build stage: compile TypeScript sources and build React SPA with Vite
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

# Copy shared tsconfig and sources required by @ott/platform-web and its dependencies
COPY src/tsconfig.base.json ./src/
COPY src/game-core/ ./src/game-core/
COPY src/bot-protocol/ ./src/bot-protocol/
COPY src/match-runner/ ./src/match-runner/
COPY src/platform/job-contract/ ./src/platform/job-contract/
COPY src/platform/api/ ./src/platform/api/
COPY src/platform/web/ ./src/platform/web/

# Build static SPA assets into src/platform/web/dist
RUN npm run build --workspace @ott/platform-web

# ------------------------------------------------------------------------------
# Runtime stage: unprivileged Nginx serving static assets and proxying API
# ------------------------------------------------------------------------------
FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime

# Default upstream API URL for envsubst template mechanism
ENV API_UPSTREAM=http://api:3000

# Ensure envsubst only substitutes API_UPSTREAM to avoid clobbering nginx variables
ENV NGINX_ENVSUBST_FILTER="API_UPSTREAM"

# Copy built SPA distribution files to nginx default web root
COPY --from=build /app/src/platform/web/dist /usr/share/nginx/html

# Copy nginx config template for envsubst substitution into /etc/nginx/conf.d/default.conf
COPY infra/docker/nginx.conf /etc/nginx/templates/default.conf.template

# Ensure /srv/snapshots directory exists and is readable by unprivileged user
USER root
RUN mkdir -p /srv/snapshots && chown -R 101:101 /srv/snapshots
USER 101

# Expose non-privileged HTTP port
EXPOSE 8080

# Healthcheck hitting dedicated /healthz endpoint
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz > /dev/null || exit 1
