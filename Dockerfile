# Production stage — slim with onnxruntime dependencies
FROM oven/bun:slim

WORKDIR /app

# Install system dependencies required by onnxruntime-node
RUN apt-get update && apt-get install -y \
  libc6 \
  libgomp1 \
  libstdc++6 \
  curl \
  && rm -rf /var/lib/apt/lists/*

# Copy pre-built files (build locally first: bun run build)
COPY shared/dist ./shared/dist
COPY server/dist ./server/dist
COPY client/dist ./client/dist
COPY node_modules ./node_modules
COPY shared/node_modules ./shared/node_modules
COPY server/node_modules ./server/node_modules
COPY package.json ./
COPY server/package.json ./server/

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
  CMD curl -f http://localhost:3000/health || exit 1

# Start server
CMD ["bun", "server/dist/index.js"]
