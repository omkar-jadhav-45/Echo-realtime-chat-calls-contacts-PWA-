### Server Dockerfile (multi-stage)
FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
# Prefer reproducible installs; fall back to npm install if lockfile is absent
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
COPY . .
RUN npm run build

FROM node:18-alpine AS runner
WORKDIR /app
COPY package*.json ./
COPY --from=builder /app/dist ./dist
ENV NODE_ENV=production
# Install only production deps; tolerate missing lockfile
RUN if [ -f package-lock.json ]; then npm ci --only=production; else npm install --only=production; fi
EXPOSE 3000
CMD ["node", "dist/index.js"]
