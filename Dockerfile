# ==============================================================================
# ZENTRA — Production Multi-Stage Containerfile for @zentra/api
# Stage 8: Backend Containerization & Production Isolation
# ==============================================================================

# ------------------------------------------------------------------------------
# Stage 1: Pruner (Turborepo Workspace Pruning)
# Isolates only @zentra/api and its internal workspace dependency tree
# ------------------------------------------------------------------------------
FROM node:22-alpine AS pruner
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Install Turborepo matching monorepo version specification
RUN npm install -g turbo@^2.1.2

# Copy source repository for structural pruning
COPY . .

# Generate minimal pruned workspace in /app/out
RUN turbo prune @zentra/api --docker

# ------------------------------------------------------------------------------
# Stage 2: Builder (Dependency Resolution & TypeScript Compilation)
# Installs exact locked dependencies and compiles production artifacts
# ------------------------------------------------------------------------------
FROM node:22-alpine AS builder
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Enable Corepack and activate exact repository pnpm version (v12.9.1)
RUN corepack enable && corepack prepare pnpm@12.9.1 --activate

# Layer 1: Copy pruned package manifests and lockfiles for optimal caching
COPY --from=pruner /app/out/json/ .
COPY --from=pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=pruner /app/out/pnpm-workspace.yaml ./pnpm-workspace.yaml

# Install dependencies using frozen lockfile
RUN pnpm install --frozen-lockfile

# Layer 2: Copy pruned application and package source code
COPY --from=pruner /app/out/full/ .
COPY --from=pruner /app/tsconfig.base.json ./tsconfig.base.json

# Compile @zentra/api and all upstream workspace dependencies
RUN pnpm --filter=@zentra/api... build

# Deploy isolated standalone production bundle (resolves workspace deps into standalone node_modules)
RUN pnpm --filter=@zentra/api deploy --prod /app/deployed

# ------------------------------------------------------------------------------
# Stage 3: Runner (Minimal Production Runtime)
# Hardened, non-root Alpine container executing compiled Fastify NestJS application
# ------------------------------------------------------------------------------
FROM node:22-alpine AS runner
RUN apk add --no-cache dumb-init curl
WORKDIR /app

# Production environment defaults
ENV NODE_ENV=production
ENV APP_ENV=production
ENV API_PORT=4000
ENV API_HOST=0.0.0.0

# Security: Execute as pre-existing non-privileged node user (UID 1000)
USER node

# Copy standalone production deployment bundle with appropriate ownership
COPY --chown=node:node --from=builder /app/deployed ./

# Fastify HTTP service port
EXPOSE 4000

# Native container liveness health probe
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -f http://127.0.0.1:4000/api/v1/health/liveness || exit 1

# Process supervisor ensuring proper PID 1 signal forwarding and graceful shutdown
ENTRYPOINT ["dumb-init", "--"]

# Production API application entry point
CMD ["node", "dist/main.js"]
