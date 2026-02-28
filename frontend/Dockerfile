# ============================================================================
# Dockerfile for MTG Frontend (Commander Deck Advisor UI)
# ============================================================================
# Multi-stage build: Vite build → nginx static serving
# Final image size target: ~85MB
# ============================================================================

# ──────────────────────────────────────────────────────────────────────────
# Stage 1: Base dependencies
# ──────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS base

WORKDIR /app

# ──────────────────────────────────────────────────────────────────────────
# Stage 2: Dependencies installer
# ──────────────────────────────────────────────────────────────────────────
FROM base AS deps

# Copy root package files for workspace setup
COPY package*.json ./

# Copy mtg/frontend package files
COPY mtg/frontend/package*.json ./mtg/frontend/

# Install ALL dependencies (including devDependencies for Vite build)
RUN npm ci --workspace=mtg-deck-advisor --include-workspace-root

# ──────────────────────────────────────────────────────────────────────────
# Stage 3: Builder
# ──────────────────────────────────────────────────────────────────────────
FROM deps AS builder

# Build-time argument for MTG API URL (must be set at build time for Vite)
ARG VITE_MTG_API_URL=http://localhost:3002
ENV VITE_MTG_API_URL=${VITE_MTG_API_URL}

# Copy mtg/frontend source code
COPY mtg/frontend/vite.config.ts ./mtg/frontend/
COPY mtg/frontend/tsconfig.json ./mtg/frontend/
COPY mtg/frontend/index.html ./mtg/frontend/
COPY mtg/frontend/src ./mtg/frontend/src
COPY mtg/frontend/public ./mtg/frontend/public

# Build the Vite application
# Output: mtg/frontend/dist (static files)
RUN npm run build --workspace=mtg-deck-advisor

# ──────────────────────────────────────────────────────────────────────────
# Stage 4: Production runtime with nginx (FINAL IMAGE)
# ──────────────────────────────────────────────────────────────────────────
FROM nginx:alpine AS production

# Copy custom nginx configuration for SPA routing
RUN echo 'server { \
    listen 8080; \
    server_name _; \
    root /usr/share/nginx/html; \
    index index.html; \
    \
    # Gzip compression for better performance \
    gzip on; \
    gzip_vary on; \
    gzip_min_length 1024; \
    gzip_types text/plain text/css text/xml text/javascript application/javascript application/json application/xml+rss image/svg+xml; \
    \
    # Security headers \
    add_header X-Frame-Options "SAMEORIGIN" always; \
    add_header X-Content-Type-Options "nosniff" always; \
    add_header X-XSS-Protection "1; mode=block" always; \
    add_header Referrer-Policy "strict-origin-when-cross-origin" always; \
    \
    # CORS headers for MTG API (if needed) \
    # add_header Access-Control-Allow-Origin "https://mtg-api.maxtory.app" always; \
    \
    # Cache static assets aggressively \
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ { \
        expires 1y; \
        add_header Cache-Control "public, immutable"; \
    } \
    \
    # Cache HTML with shorter expiry \
    location ~* \.html$ { \
        expires 1h; \
        add_header Cache-Control "public, must-revalidate"; \
    } \
    \
    # SPA routing: all routes serve index.html \
    location / { \
        try_files $uri $uri/ /index.html; \
    } \
    \
    # Health check endpoint \
    location /health { \
        access_log off; \
        return 200 "healthy\n"; \
        add_header Content-Type text/plain; \
    } \
}' > /etc/nginx/conf.d/default.conf

# Copy built static files from builder stage
COPY --from=builder /app/mtg/frontend/dist /usr/share/nginx/html

# Create non-root user for nginx
RUN addgroup -g 1001 -S nginx-custom && \
    adduser -S nginx-custom -u 1001 && \
    chown -R nginx-custom:nginx-custom /usr/share/nginx/html && \
    chown -R nginx-custom:nginx-custom /var/cache/nginx && \
    chown -R nginx-custom:nginx-custom /var/log/nginx && \
    touch /var/run/nginx.pid && \
    chown -R nginx-custom:nginx-custom /var/run/nginx.pid

# Switch to non-root user
USER nginx-custom

# Expose port 8080 (Cloud Run requirement)
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8080/health || exit 1

# Start nginx
CMD ["nginx", "-g", "daemon off;"]

# ──────────────────────────────────────────────────────────────────────────
# Stage 5: Development (for docker-compose)
# ──────────────────────────────────────────────────────────────────────────
FROM deps AS development

# Copy source code (will be overridden by volume mount)
COPY mtg/frontend/vite.config.ts ./mtg/frontend/
COPY mtg/frontend/tsconfig.json ./mtg/frontend/
COPY mtg/frontend/index.html ./mtg/frontend/
COPY mtg/frontend/src ./mtg/frontend/src
COPY mtg/frontend/public ./mtg/frontend/public

WORKDIR /app

# Expose Vite dev server port
EXPOSE 5174

# Development mode with Vite HMR
CMD ["npm", "run", "dev", "--workspace=mtg-deck-advisor"]

# ──────────────────────────────────────────────────────────────────────────
# Build Instructions:
# ──────────────────────────────────────────────────────────────────────────
# Production:
#   docker build -t maxtory-mtg-frontend \
#     --build-arg VITE_MTG_API_URL=https://mtg-api.maxtory.app \
#     -f mtg/frontend/Dockerfile .
#
# Development:
#   docker build --target development -t maxtory-mtg-frontend-dev -f mtg/frontend/Dockerfile .
#
# Cloud Build:
#   gcloud builds submit --tag gcr.io/PROJECT_ID/maxtory-mtg-frontend \
#     --dockerfile=mtg/frontend/Dockerfile \
#     --build-arg VITE_MTG_API_URL=https://mtg-api.maxtory.app \
#     .
# ──────────────────────────────────────────────────────────────────────────
