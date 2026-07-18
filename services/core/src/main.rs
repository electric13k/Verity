//! Verity core — Rust service. Private subnet only; reached over gRPC from
//! brain/gateway (tonic wiring lands in M1; this M0 skeleton exposes HTTP
//! healthz with the degrade-never-die contract).
//!
//! Law: every Qdrant query built here carries a mandatory payload filter
//! `user_id == tenant_ctx.user_id`, with tenant_ctx taken from gRPC
//! metadata only — never from request bodies.

use axum::{routing::get, Json, Router};
use serde::Serialize;

const VERSION: &str = env!("CARGO_PKG_VERSION");

/// Env vars core can start without; absence is reported, never fatal.
const OPTIONAL_CONFIG: &[&str] = &["QDRANT_URL", "CORE_GRPC_ADDR"];

fn missing_config() -> Vec<String> {
    OPTIONAL_CONFIG
        .iter()
        .filter(|k| std::env::var(k).map_or(true, |v| v.is_empty()))
        .map(|k| k.to_string())
        .collect()
}

#[derive(Serialize)]
struct Health {
    status: &'static str,
    service: &'static str,
    version: &'static str,
    missing_config: Vec<String>,
}

async fn healthz() -> Json<Health> {
    let missing = missing_config();
    Json(Health {
        status: if missing.is_empty() { "ok" } else { "degraded" },
        service: "core",
        version: VERSION,
        missing_config: missing,
    })
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt().json().init();

    let missing = missing_config();
    if !missing.is_empty() {
        tracing::warn!(?missing, "starting degraded");
    }

    let addr = std::env::var("CORE_HTTP_ADDR").unwrap_or_else(|_| "127.0.0.1:8200".into());
    let app = Router::new().route("/healthz", get(healthz));
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .expect("bind core http addr");
    tracing::info!(%addr, version = VERSION, "core listening");
    axum::serve(listener, app).await.expect("server exited");
}
