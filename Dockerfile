# ============================================================================
# Dockerfile for MTG Backend (Commander Deck Advisor API)
# ============================================================================
# Multi-stage build optimized for AI/ML workload
# Final image size target: ~160MB (without mtg.db)
# mtg.db (315MB) mounted as Cloud Storage volume in production
# ============================================================================

# ──────────────────────────────────────────────────────────────────────────
# Stage 1: Base dependencies
# ──────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS base

# Install build dependencies
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    && ln -sf python3 /usr/bin/python

WORKDIR /app

# ──────────────────────────────────────────────────────────────────────────
# Stage 2: Dependencies installer
# ──────────────────────────────────────────────────────────────────────────
FROM base AS deps

# Copy root package files for workspace setup
COPY package*.json ./

# Copy mtg and mtg/frontend package files
COPY mtg/package*.json ./mtg/
COPY mtg/frontend/package*.json ./mtg/frontend/

# Install ALL dependencies for mtg workspace
RUN npm ci --workspace=mtg --include-workspace-root

# ──────────────────────────────────────────────────────────────────────────
# Stage 3: Builder
# ──────────────────────────────────────────────────────────────────────────
FROM deps AS builder

# Copy mtg backend source code
COPY mtg/tsconfig.json ./mtg/
COPY mtg/src ./mtg/src

# Copy mtg frontend build (pre-built)
COPY mtg/frontend/dist ./mtg/frontend/dist

# Build TypeScript → JavaScript
RUN npm run build --workspace=mtg

# ──────────────────────────────────────────────────────────────────────────
# Stage 4: Production dependencies only
# ──────────────────────────────────────────────────────────────────────────
FROM base AS prod-deps

# Copy root package files
COPY package*.json ./

# Copy mtg package files
COPY mtg/package*.json ./mtg/

# Install ONLY production dependencies
RUN npm ci --workspace=mtg --include-workspace-root --omit=dev

# ──────────────────────────────────────────────────────────────────────────
# Stage 5: Production runtime (FINAL IMAGE)
# ──────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS production

# Install runtime dependencies
RUN apk add --no-cache \
    tini

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

WORKDIR /app

# Copy production dependencies from prod-deps stage
COPY --from=prod-deps --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=prod-deps --chown=nodejs:nodejs /app/mtg/node_modules ./mtg/node_modules

# Copy built application from builder stage
COPY --from=builder --chown=nodejs:nodejs /app/mtg/dist ./mtg/dist

# Copy package.json files
COPY --chown=nodejs:nodejs package*.json ./
COPY --chown=nodejs:nodejs mtg/package*.json ./mtg/

# Create directory for database volume mount
# In production, this will be mounted from Cloud Storage
RUN mkdir -p /app/mtg/data && \
    chown -R nodejs:nodejs /app/mtg/data

# IMPORTANT: Database handling
# ─────────────────────────────
# Option 1: Cloud Storage volume mount
#   - Mount gs://maxtory-mtg-database/ to /app/mtg/data
#   - Database path: /app/mtg/data/mtg.db
#   - See commented deployment commands below
#
# Option 2: Bake database into image (RECOMMENDED for this deployment)
#   - Includes 315MB mtg.db directly in the image
#   - Slower cold starts but simpler deployment
COPY --chown=nodejs:nodejs mtg/data/mtg.db ./mtg/data/mtg.db
#
# Option 3: Download at startup (NOT RECOMMENDED - slow cold starts)
#   Add startup script to download from Cloud Storage

# Switch to non-root user
USER nodejs

# Expose port (Cloud Run will inject PORT env var or use MTG_PORT)
EXPOSE 3002

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3002/api/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

# Use tini as PID 1 for proper signal handling
ENTRYPOINT ["/sbin/tini", "--"]

# Start the MTG Assistant server
# Uses Node's experimental SQLite support (required for embeddings)
CMD ["node", "--experimental-sqlite", "mtg/dist/assistant/server.js"]

# ──────────────────────────────────────────────────────────────────────────
# Stage 6: Development (for docker-compose)
# ──────────────────────────────────────────────────────────────────────────
FROM deps AS development

# Install tsx for development hot reload
RUN npm install -g tsx

# Copy source code (will be overridden by volume mount)
COPY mtg/tsconfig.json ./mtg/
COPY mtg/vitest.config.ts ./mtg/
COPY mtg/src ./mtg/src

# Copy database for local development
COPY mtg/data ./mtg/data

WORKDIR /app

# Expose port
EXPOSE 3002

# Development mode with hot reload
# Note: Uses assistant:serve script which starts the HTTP server
CMD ["npm", "run", "dev", "--workspace=mtg"]

# ──────────────────────────────────────────────────────────────────────────
# Build Instructions:
# ──────────────────────────────────────────────────────────────────────────
# Production (without database):
#   docker build -t maxtory-mtg-backend -f mtg/Dockerfile .
#
# Development:
#   docker build --target development -t maxtory-mtg-backend-dev -f mtg/Dockerfile .
#
# Cloud Build:
#   gcloud builds submit --tag gcr.io/PROJECT_ID/maxtory-mtg-backend \
#     --dockerfile=mtg/Dockerfile .
#
# Deploy with Cloud Storage volume:
#   gcloud run deploy maxtory-mtg-backend \
#     --image gcr.io/PROJECT_ID/maxtory-mtg-backend \
#     --add-volume name=mtg-data,type=cloud-storage,bucket=maxtory-mtg-database \
#     --add-volume-mount volume=mtg-data,mount-path=/app/mtg/data
# ──────────────────────────────────────────────────────────────────────────
