# Multi-stage build for smaller image
FROM rust:1 AS builder
WORKDIR /app
COPY Cargo.toml Cargo.lock* ./
# Cache deps
RUN mkdir src && echo "fn main() {}" > src/main.rs && cargo build --release || true
COPY src ./src
RUN cargo build --release

FROM gcr.io/distroless/cc-debian12
WORKDIR /app
COPY --from=builder /app/target/release/echo-auth /app/echo-auth
ENV RUST_LOG=info
EXPOSE 8080
CMD ["/app/echo-auth"]
