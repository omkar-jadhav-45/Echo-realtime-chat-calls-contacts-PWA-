// SPDX-License-Identifier: Apache-2.0
// Copyright 2025 Echo contributors
use std::net::SocketAddr;

use argon2::{password_hash::{rand_core::OsRng, PasswordHasher, PasswordVerifier, SaltString}, Argon2};
use axum::{extract::State, http::StatusCode, response::IntoResponse, routing::{get, post}, Json, Router};
use dotenvy::dotenv;
use jsonwebtoken as jwt;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tracing::{error, info};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[derive(Clone)]
struct AppState {
    // Vec of (kid, secret bytes). First element is used as default when no active_kid specified.
    secrets: Vec<(String, Vec<u8>)>,
    active_kid: String,
}

#[derive(Debug, Error)]
enum ApiError {
    #[error("bad request")] BadRequest,
    #[error("unauthorized")] Unauthorized,
    #[error("internal error")] Internal,
}

impl IntoResponse for ApiError {
    fn into_response(self) -> axum::response::Response {
        let code = match self {
            ApiError::BadRequest => StatusCode::BAD_REQUEST,
            ApiError::Unauthorized => StatusCode::UNAUTHORIZED,
            ApiError::Internal => StatusCode::INTERNAL_SERVER_ERROR,
        };
        (code, self.to_string()).into_response()
    }
}

#[derive(Deserialize)]
struct HashReq { password: String }
#[derive(Serialize)]
struct HashRes { hash: String }

#[derive(Deserialize)]
struct VerifyReq { password: String, hash: String }
#[derive(Serialize)]
struct VerifyRes { valid: bool }

#[derive(Deserialize)]
struct TokenReq { sub: String, exp_seconds: Option<u64> }
#[derive(Serialize, Deserialize)]
struct Claims { sub: String, exp: u64 }
#[derive(Serialize)]
struct TokenRes { token: String }
#[derive(Deserialize)]
struct VerifyTokenReq { token: String }

#[tokio::main]
async fn main() {
    dotenv().ok();
    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::new(
            std::env::var("RUST_LOG").unwrap_or_else(|_| "info".to_string()),
        ))
        .with(tracing_subscriber::fmt::layer())
        .init();

    // Secret rotation support
    // Preferred: JWT_SECRETS="kid1:secret1,kid2:secret2" and optional JWT_ACTIVE_KID="kid2"
    // Fallback: JWT_SECRET (uses kid "default")
    let (secrets, active_kid) = {
        if let Ok(mult) = std::env::var("JWT_SECRETS") {
            let mut list: Vec<(String, Vec<u8>)> = vec![];
            for part in mult.split(',') {
                if let Some((kid, sec)) = part.split_once(':') {
                    let k = kid.trim().to_string();
                    let s = sec.trim().as_bytes().to_vec();
                    if !k.is_empty() && !s.is_empty() { list.push((k, s)); }
                }
            }
            let active = std::env::var("JWT_ACTIVE_KID").ok().filter(|v| !v.is_empty())
                .unwrap_or_else(|| list.first().map(|x| x.0.clone()).unwrap_or_else(|| "default".to_string()));
            if list.is_empty() {
                let secret = std::env::var("JWT_SECRET").unwrap_or_else(|_| "dev-secret-change-me".to_string());
                (vec![("default".to_string(), secret.into_bytes())], "default".to_string())
            } else {
                (list, active)
            }
        } else {
            let secret = std::env::var("JWT_SECRET").unwrap_or_else(|_| "dev-secret-change-me".to_string());
            (vec![("default".to_string(), secret.into_bytes())], "default".to_string())
        }
    };
    let state = AppState { secrets, active_kid };

    let app = Router::new()
        .route("/health", get(|| async { "ok" }))
        .route("/hash", post(hash_password))
        .route("/verify", post(verify_password))
        .route("/token", post(issue_token))
        .route("/token/verify", post(verify_token))
        .with_state(state);

    let port: u16 = std::env::var("PORT").ok().and_then(|s| s.parse().ok()).unwrap_or(8080);
    let addr: SocketAddr = ([0, 0, 0, 0], port).into();
    info!(%port, "auth service listening");
    let listener = tokio::net::TcpListener::bind(addr).await.expect("bind");
    axum::serve(listener, app).await.unwrap();
}

async fn hash_password(Json(req): Json<HashReq>) -> Result<Json<HashRes>, ApiError> {
    if req.password.is_empty() { return Err(ApiError::BadRequest); }
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();
    let hash = argon2
        .hash_password(req.password.as_bytes(), &salt)
        .map_err(|_| ApiError::Internal)?
        .to_string();
    Ok(Json(HashRes { hash }))
}

async fn verify_password(Json(req): Json<VerifyReq>) -> Result<Json<VerifyRes>, ApiError> {
    if req.password.is_empty() || req.hash.is_empty() { return Err(ApiError::BadRequest); }
    let parsed = password_hash::PasswordHash::new(&req.hash).map_err(|_| ApiError::BadRequest)?;
    let ok = Argon2::default().verify_password(req.password.as_bytes(), &parsed).is_ok();
    Ok(Json(VerifyRes { valid: ok }))
}

async fn issue_token(State(state): State<AppState>, Json(req): Json<TokenReq>) -> Result<Json<TokenRes>, ApiError> {
    if req.sub.is_empty() { return Err(ApiError::BadRequest); }
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|_| ApiError::Internal)?.as_secs();
    let exp = now + req.exp_seconds.unwrap_or(3600);
    let claims = Claims { sub: req.sub, exp };

    let mut header = jwt::Header { alg: jwt::Algorithm::HS256, ..Default::default() };
    header.kid = Some(state.active_kid.clone());
    // Find active key by kid
    let secret_bytes = state
        .secrets
        .iter()
        .find(|(kid, _)| kid == &state.active_kid)
        .map(|(_, s)| s.as_slice())
        .unwrap_or_else(|| state.secrets.first().map(|(_, s)| s.as_slice()).unwrap_or(&[]));
    let key = jwt::EncodingKey::from_secret(secret_bytes);

    let token = jwt::encode(&header, &claims, &key).map_err(|e| { error!(?e, "jwt encode error"); ApiError::Internal })?;
    Ok(Json(TokenRes { token }))
}

async fn verify_token(State(state): State<AppState>, Json(req): Json<VerifyTokenReq>) -> Result<Json<Claims>, ApiError> {
    if req.token.is_empty() { return Err(ApiError::BadRequest); }
    let validation = jwt::Validation::new(jwt::Algorithm::HS256);
    // Try to use KID if present, else try all secrets
    let header = jwt::decode_header(&req.token).map_err(|_| ApiError::Unauthorized)?;
    let try_order: Vec<&[u8]> = if let Some(kid) = header.kid {
        if let Some((_, sec)) = state.secrets.iter().find(|(k, _)| *k == kid) {
            vec![sec.as_slice()]
        } else {
            state.secrets.iter().map(|(_, s)| s.as_slice()).collect()
        }
    } else {
        state.secrets.iter().map(|(_, s)| s.as_slice()).collect()
    };
    let mut last_err: Option<jwt::errors::Error> = None;
    for sec in try_order {
        let key = jwt::DecodingKey::from_secret(sec);
        match jwt::decode::<Claims>(&req.token, &key, &validation) {
            Ok(data) => {
                let claims = data.claims;
                // Additional exp check (Validation should already cover it if set)
                let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|_| ApiError::Internal)?.as_secs();
                if claims.exp < now { return Err(ApiError::Unauthorized); }
                return Ok(Json(claims));
            },
            Err(e) => { last_err = Some(e); }
        }
    }
    error!(?last_err, "jwt verify failed");
    Err(ApiError::Unauthorized)
}
