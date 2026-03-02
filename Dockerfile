# Production stage
FROM oven/bun:latest

WORKDIR /app

# Install Python, ffmpeg (for pydub/audio), and uv (for MCP servers like markitdown-mcp)
RUN apt-get update && apt-get install -y curl python3 ffmpeg && rm -rf /var/lib/apt/lists/* \
    && curl -LsSf https://astral.sh/uv/install.sh | sh \
    && apt-get update && apt-get remove -y curl && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

# Add uv to PATH
ENV PATH="/root/.local/bin:$PATH"
RUN uv --version && \
    ln -s /root/.local/bin/uvx /usr/local/bin/uvx || true

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
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

# Start server
CMD ["bun", "server/dist/index.js"]
