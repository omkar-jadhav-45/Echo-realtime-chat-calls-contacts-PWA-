FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
# Prefer reproducible installs; fall back to npm install if lockfile is absent
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
COPY . .
RUN npm run build

FROM nginx:stable-alpine
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
