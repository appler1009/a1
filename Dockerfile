# Production stage
FROM oven/bun:latest

WORKDIR /app

# Install ffmpeg (for pydub/audio)
RUN apt-get update && apt-get install -y curl ffmpeg && rm -rf /var/lib/apt/lists/*

# Copy package files and install dependencies inside container
# (Don't copy node_modules from host — native modules must be built for Linux)
COPY package.json bun.lock ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
COPY client/package.json ./client/

# Install dependencies for the Linux arm64 environment
RUN bun install --frozen-lockfile

# Copy pre-built TypeScript/source files (build locally first: bun run build)
COPY shared/dist ./shared/dist
COPY server/dist ./server/dist
COPY client/dist ./client/dist

# Create data directory
RUN mkdir -p /app/data

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

# Start server
CMD ["bun", "server/dist/index.js"]
