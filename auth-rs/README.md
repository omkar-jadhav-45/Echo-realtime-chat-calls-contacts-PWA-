# Echo Auth Service (Rust)

A minimal authentication microservice built with Axum. Provides:
- Password hashing and verification using Argon2
- JWT issuance and verification (HS256)
- Basic health endpoint

## Endpoints
- GET /health → "ok"
- POST /hash → { password } → { hash }
- POST /verify → { password, hash } → { valid }
- POST /token → { sub, exp_seconds? } → { token }
- POST /token/verify → { token } → { sub, exp }

## Configuration
Environment variables:
- JWT_SECRET: HMAC secret for HS256 tokens (required in production) – single key mode
- JWT_SECRETS: Comma-separated list of kid:secret pairs for key rotation (e.g., "k1:secret1,k2:secret2")
- JWT_ACTIVE_KID: When using JWT_SECRETS, the KID to use for issuing new tokens (defaults to the first in JWT_SECRETS)
- PORT: Service port (default 8080)
- RUST_LOG: tracing filter (e.g., info,debug)

Copy `.env.example` to `.env` and adjust values.

## Run (Windows PowerShell)
- Build & run (dev):
  - cd auth-rs; cargo run
- Set env and run:
  - $env:JWT_SECRET = "super-secret"; $env:RUST_LOG = "info"; cargo run

## Quick smoke tests
- Health: Invoke-RestMethod -Uri http://localhost:8080/health -Method GET
- Hash: Invoke-RestMethod -Uri http://localhost:8080/hash -Method POST -ContentType 'application/json' -Body '{"password":"test"}'
- Verify: Invoke-RestMethod -Uri http://localhost:8080/verify -Method POST -ContentType 'application/json' -Body '{"password":"test","hash":"<paste-from-hash>"}'
- Token: Invoke-RestMethod -Uri http://localhost:8080/token -Method POST -ContentType 'application/json' -Body '{"sub":"user-123","exp_seconds":3600}'
- Token verify: Invoke-RestMethod -Uri http://localhost:8080/token/verify -Method POST -ContentType 'application/json' -Body '{"token":"<paste-token>"}'

## Notes
- This service doesn’t persist users; it only provides crypto primitives (hash/verify) and JWT handling. Integrate with your user store in the Node server.
- Use HTTPS and rotate JWT_SECRET in production. Consider key IDs and rotation strategy.
