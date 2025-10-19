# Root Dockerfile: build and run the Node server only
# Use Node 18 LTS to match engines
FROM node:18-alpine AS builder
WORKDIR /app/server
# Install server deps
COPY server/package*.json ./
# Prefer reproducible installs; fall back gracefully if no lockfile
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
COPY server/ .
RUN npm run build

FROM node:18-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# Install only runtime deps for the server
COPY server/package*.json ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi
COPY --from=builder /app/server/dist ./dist
EXPOSE 3000
CMD ["node", "dist/index.js"]
