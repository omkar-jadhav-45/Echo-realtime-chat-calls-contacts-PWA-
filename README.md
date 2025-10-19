# Echo — realtime chat, calls, contacts (PWA)

<!-- Replace OWNER and REPO with your GitHub org/user and repo name if different -->

[![CI](https://github.com/OWNER/REPO/actions/workflows/ci.yml/badge.svg)](https://github.com/OWNER/REPO/actions/workflows/ci.yml)
[![CD (Pages)](https://github.com/OWNER/REPO/actions/workflows/cd.yml/badge.svg)](https://github.com/OWNER/REPO/actions/workflows/cd.yml)
[![GitHub Pages](https://img.shields.io/badge/Pages-live-blue?logo=github)](https://OWNER.github.io/REPO/)

Echo is a full-stack, realtime chat and calling app with a modern 3D UI, a JWT auth microservice, and a secure contacts API. It ships with a Vite/React PWA frontend, a Node/Express + Socket.IO server, and a Rust (Axum) auth service.

Highlights
- Realtime messaging with Socket.IO
- 1:1 and group mesh calls (WebRTC) with screen share
- Contacts API scoped by user identity (JWT)
- Rust auth service: Argon2 hashing, JWT issue/verify, secret rotation via KID
- PWA: installable app with offline fallback and caching
- Docker Compose for local stack; GitHub Actions for CI (build) and CD (GHCR images + GitHub Pages)


## Project layout

Monorepo folders:
- `frontend/` — Vite + React + TypeScript client (PWA)
- `server/` — Node + Express + Socket.IO backend API and signaling
- `auth-rs/` — Rust Axum auth microservice (JWT, hashing)
- `scripts/` — DevOps utilities (health checks, helpers)
- `docker-compose.yml` — Local multi-service stack


## Architecture (at a glance)

```
       +-----------------+        WebSocket/HTTP        +------------------+
       |   Frontend PWA  | <--------------------------> |   Server (API)   |
       |  (Vite + React) |                              | Express + Socket |
       +--------+--------+                              +----+------+------+
        ^                                            |      |
        |  HTTP (Auth)                                |      | persistence
        |                                            v      v
       +--------+--------+                               +-----+  +-----+
       |  Auth Service   |                               | Mongo|  |Redis|
       |  (Rust / Axum)  |                               +-----+  +-----+
       +-----------------+
```

- Frontend talks to Server over HTTP and WebSocket (Socket.IO). Service worker enables offline shell and caching.
- Server protects contacts endpoints via JWT verification against the Auth service.
- Auth issues JWTs (HS256) with KID header and verifies tokens across rotated secrets.
- MongoDB stores messages/contacts if available; falls back to in-memory when absent. Redis is optional for presence sets.


## Prerequisites

- Node.js 18+ and npm
- Rust toolchain (stable) for `auth-rs`
- Docker Desktop (optional, for `docker compose`)


## Quick start (local, separate processes)

Open three terminals or use your preferred process manager.

1) Auth service (Rust Axum)

```powershell
cd auth-rs
$env:JWT_SECRET="change-me"; $env:RUST_LOG="info"; cargo run
# Serves on http://localhost:8080
```

Environment (auth-rs):
- `JWT_SECRET`: single HMAC secret (dev default exists)
- or `JWT_SECRETS`: kid:secret pairs, comma-separated (e.g., `kid1:s1,kid2:s2`)
- `JWT_ACTIVE_KID`: which KID to use for issuing (defaults to first)
- `PORT`: default 8080

2) Server (Node/Express + Socket.IO)

```powershell
cd server
npm install
```

Key env (server):
- `PORT`: default 3000
- `AUTH_URL`: default http://localhost:8080

3) Frontend (Vite/React PWA)

# App at http://localhost:5173
```

## Deploying on Railway

Two supported ways:

1) Root Dockerfile (recommended)
  - Create a Railway service from this repo root. It will detect `Dockerfile` and build only the server using Node 18 LTS.
  - Set variables: `MONGODB_URI`, `AUTH_URL`, optional `REDIS_URL`. `PORT` is provided by Railway.

2) Nixpacks with Procfile
  - If Railway doesn’t use Docker, it will run the `Procfile` (`web: npm start`). Root `package.json` is set to build and start only the server.
  - Same variables as above.

Frontend and Auth
  - Deploy `frontend/` and `auth-rs/` as separate services if desired (each has its own Dockerfile). For the frontend, set `VITE_SOCKET_URL` to the server’s public URL.

Notes
  - Our Dockerfiles and Nixpacks config prefer `npm ci` when a lockfile exists, otherwise they fall back to `npm install` to prevent CI failures like “npm ci did not complete successfully”.
  - The root `engines` pin Node to an LTS compatible with the Docker images.
Key env (frontend):
- `VITE_SOCKET_URL`: Socket/HTTP base for server (defaults to http://localhost:3000). Used by build.


## One-command stack (Docker Compose)

```powershell
docker compose up --build
```

Services and ports:
- Frontend: http://localhost:5173 (served via container’s web server)
- Server API: http://localhost:3000
- Auth service: http://localhost:8080
- MongoDB: 27017; Redis: 6379

Compose env wiring:
- Server `AUTH_URL=http://auth:8080`, `MONGODB_URI=mongodb://mongo:27017/echo`, `REDIS_URL=redis://redis:6379`
- Frontend builds with `VITE_SOCKET_URL=http://server:3000`
- Auth uses `JWT_SECRET=change-me`, `PORT=8080`, `RUST_LOG=info`


## PWA and install

The app includes a web app manifest and a service worker for a lightweight offline experience.
- Manifest: `frontend/public/manifest.webmanifest`
- Service worker: `frontend/public/sw.js` (network-first for navigations; cache-first for same-origin GETs)
- Offline fallback: `frontend/public/offline.html`

Install (Chrome/Edge desktop):
1. Navigate to your deployed URL (or preview build)
2. Click the “Install” icon in the address bar

Install (Android Chrome):
1. Open the site → prompt appears, or Menu → Install app

Note: For GitHub Pages deployments, asset paths use Vite’s base URL so service worker/manifest work under `/<repo>/`.


## APIs (quick reference)

Auth service (Rust, default http://localhost:8080)
- `POST /token` — body `{ sub: string, exp_seconds?: number }` → `{ token }`
- `POST /token/verify` — body `{ token: string }` → `{ sub, exp }`
- `POST /hash` — body `{ password: string }` → `{ hash }`
- `POST /verify` — body `{ password: string, hash: string }` → `{ valid: boolean }`

Server (Node/Express, default http://localhost:3000)
- `GET /` — `{ status: "Echo server running" }`
- `POST /auth/login` — `{ userId?, name?, expSeconds? }` → `{ ok, token, userId, name? }`
- `GET /messages?room=...` — last messages from store
- Contacts (JWT required via `Authorization: Bearer <token>`)
  - `GET /contacts?ownerId=...` → `{ ok, contacts: [{ name, contactId, online }] }`
  - `POST /contacts` — `{ ownerId?, name?, contactId? }` → `{ ok }`
  - `DELETE /contacts?ownerId=...&name=...&contactId=...` → `{ ok }`

Socket.IO (selected events)
- `join`, `users`, `message`
- WebRTC signaling: `webrtc:offer`, `webrtc:answer`, `webrtc:ice`, `webrtc:end`
- Calls: `call:invite`, `call:join`, `call:leave`, `call:endAll`, `call:busy`, `call:upgrade` (+ response)


## CI/CD

GitHub Actions workflows build and deploy:
- CI: builds server (tsc), frontend (vite), and auth (cargo). Uploads frontend dist as artifact.
- CD: pushes Docker images to GHCR and deploys the frontend to GitHub Pages.

Requirements for Pages deploy:
- In repo Settings → Pages: enable GitHub Pages (GitHub Actions)
- In repo Settings → Actions → Variables: set `VITE_SOCKET_URL` to your public backend URL
- The workflow sets Vite `BASE_PATH` to `/${repo}/` automatically for project pages

Produced links:
- GitHub Pages: `https://<your-username>.github.io/<repo>/` (e.g., Echo → `.../Echo/`)
- Container images in GHCR: `ghcr.io/<owner>/echo-server`, `echo-frontend`, `echo-auth`


## Health checks and troubleshooting

Scripted check (PowerShell):
- `scripts/check-services.ps1` — probes auth health, server root, login, and protected contacts.

Common issues:
- Server cannot reach Auth: check `AUTH_URL` and that `auth-rs` is running; see server logs
- Unauthorized on contacts: ensure frontend has a token (login flow) and attaches `Authorization`
- Pages deploy loads but sockets fail: set `VITE_SOCKET_URL` to your public server URL before building/deploying
- Service worker cache weirdness: hard refresh or unregister SW in DevTools → Application → Service Workers


## Development tips

- Frontend dev server: `npm run dev` (HMR)
- Server: `npm run dev` with ts-node or nodemon (as configured) or `npm run build && npm start`
- Auth service: `cargo run` (set `JWT_SECRET`)
- Public tunnels for quick demos: use a tunneling tool (e.g., `localtunnel`) to expose 3000/5173

### Apache header automation
- A pre-commit hook injects a short SPDX Apache-2.0 header into staged source files.
- Run manually for the whole repo: `npm run headers`
- Run for just staged files: `npm run headers:staged`


## License

This project is licensed under the Apache License 2.0 — see the [LICENSE](./LICENSE) file for details.

## Creator

- Name: Omkar Jadhav
- Email: omkarnjadhav6898.in@gmail.com

## Deploying to Railway

Railway builds from the repo root. This repo includes:

- Root `Procfile`: `web: npm start` → runs the server only
- Root scripts: `npm run build` builds the server, `npm start` runs it
- Service Dockerfiles (`server/`, `frontend/`) for container-based deploys

Environment variables to set in Railway:

- `MONGODB_URI` — connection string to MongoDB (Railway plugin or external)
- `REDIS_URL` — optional but recommended for presence/typing (Railway plugin)
- `AUTH_URL` — URL of the auth service you deploy (can be another Railway service)
- `PORT` — provided by Railway; the server reads it automatically

If you also deploy the `frontend/` as a separate Railway service, use the `frontend/Dockerfile` and set `VITE_SOCKET_URL` to your public backend URL before building.

