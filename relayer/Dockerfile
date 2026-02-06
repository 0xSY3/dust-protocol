# Relayer Service Dockerfile
FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install --production express cors ethers@5

# Copy relayer code
COPY relayer/ ./relayer/

# Expose port
EXPOSE 3001

# Environment variables (set these when running)
ENV RELAYER_PORT=3001
ENV RPC_URL=https://rpc.thanos-sepolia.tokamak.network
# RELAYER_PRIVATE_KEY must be set at runtime

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/health || exit 1

# Run relayer
CMD ["node", "relayer/index.js"]
