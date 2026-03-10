# ============================================
# Polymarket Watcher - Multi-stage Dockerfile
# ============================================

# Stage 1: Builder
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files and install all deps (including dev)
COPY package*.json ./
RUN npm ci

# Copy source code and build
COPY tsconfig.json ./
COPY src ./src
COPY config ./config
RUN npm run build

# Stage 2: Runner
FROM node:20-alpine AS runner

WORKDIR /app

# Copy built application and production dependencies
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/config ./config

# Environment defaults
ENV NODE_ENV=production
ENV PORT=80

# Expose port
EXPOSE 80

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:80/health || exit 1

# Start application
CMD ["node", "dist/index.js"]
