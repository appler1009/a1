# Build stage
FROM oven/bun:1-alpine AS builder
RUN apt-get update && apt-get install -y libc6 libgomp1 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package.json bun.lock* ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
COPY client/package.json ./client/

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source files
COPY shared ./shared
COPY server ./server
COPY client ./client
COPY tsconfig.json ./

# Build all packages
RUN bun run build

# Production stage
FROM oven/bun:1-alpine AS production

WORKDIR /app

# Copy built files
COPY --from=builder /app/shared/dist ./shared/dist
COPY --from=builder /app/server/dist ./server/dist
COPY --from=builder /app/client/dist ./client/dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/shared/node_modules ./shared/node_modules
COPY --from=builder /app/server/node_modules ./server/node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/server/package.json ./server/

# Create data directory
RUN mkdir -p /app/data

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
ENV STORAGE_TYPE=fs
ENV STORAGE_ROOT=/app/data

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD ["bun", "-e", "const r = await fetch('http://localhost:3000/health'); if (!r.ok) process.exit(1);"]

# Start server
CMD ["bun", "server/dist/index.js"]
