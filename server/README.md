Server (Node + Express + Socket.IO)

Run:
  npm install
  npm run dev

The server listens on port 3000 by default.

Auth integration:
- Set AUTH_URL to point at the Rust auth service (default http://localhost:8080). In Docker Compose it can be http://auth:8080.
- Login endpoint: POST /auth/login { userId?, name?, expSeconds? } → { ok, token, userId }
- Protected endpoints: /contacts (GET/POST/DELETE) now require Authorization: Bearer <token>. If ownerId is omitted, the token subject is used.
