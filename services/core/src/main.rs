//! Verity core — Rust service. Private subnet only; reached over gRPC from
//! the gateway and brain. HTTP /healthz stays for probes.
//!
//! Law: every Qdrant query built here carries a mandatory payload filter
//! `user_id == tenant_ctx.user_id`, with tenant_ctx taken from gRPC
//! metadata only — never from request bodies.

use axum::{routing::get, Json, Router};
use serde::Serialize;
use tonic::{transport::Server, Request, Response, Status};

pub mod pb {
    tonic::include_proto!("verity.v1");
}

use pb::core_service_server::{CoreService, CoreServiceServer};

const VERSION: &str = env!("CARGO_PKG_VERSION");

/// Env vars core can start without; absence is reported, never fatal.
/// (Addresses have Stage A defaults and are not listed.)
const OPTIONAL_CONFIG: &[&str] = &["QDRANT_URL"];

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

fn health_status() -> (&'static str, Vec<String>) {
    let missing = missing_config();
    (
        if missing.is_empty() { "ok" } else { "degraded" },
        missing,
    )
}

async fn healthz() -> Json<Health> {
    let (status, missing) = health_status();
    Json(Health {
        status,
        service: "core",
        version: VERSION,
        missing_config: missing,
    })
}

#[derive(Default)]
struct CoreGrpc;

#[tonic::async_trait]
impl CoreService for CoreGrpc {
    async fn health(
        &self,
        _req: Request<pb::HealthRequest>,
    ) -> Result<Response<pb::HealthResponse>, Status> {
        let (status, missing) = health_status();
        Ok(Response::new(pb::HealthResponse {
            status: if status == "ok" {
                pb::health_response::Status::Ok as i32
            } else {
                pb::health_response::Status::Degraded as i32
            },
            service: "core".into(),
            version: VERSION.into(),
            missing_config: missing,
        }))
    }

    async fn echo(
        &self,
        req: Request<pb::EchoRequest>,
    ) -> Result<Response<pb::EchoResponse>, Status> {
        let request_id = req
            .metadata()
            .get("x-verity-request-id")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string();
        tracing::info!(%request_id, "echo");
        Ok(Response::new(pb::EchoResponse {
            message: format!("core-echo: {}", req.into_inner().message),
        }))
    }

    async fn vector_search(
        &self,
        _req: Request<pb::VectorSearchRequest>,
    ) -> Result<Response<pb::VectorSearchResponse>, Status> {
        // Lands in M3 with the mandatory tenant filter; refusing now is the
        // fail-closed default.
        Err(Status::unimplemented("vector_search lands in M3"))
    }
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt().json().init();

    let missing = missing_config();
    if !missing.is_empty() {
        tracing::warn!(?missing, "starting degraded");
    }

    // HTTP healthz
    let http_addr = std::env::var("CORE_HTTP_ADDR").unwrap_or_else(|_| "127.0.0.1:8200".into());
    let app = Router::new().route("/healthz", get(healthz));
    let listener = tokio::net::TcpListener::bind(&http_addr)
        .await
        .expect("bind core http addr");
    tracing::info!(%http_addr, version = VERSION, "core http listening");
    tokio::spawn(async move {
        axum::serve(listener, app).await.expect("http server exited");
    });

    // gRPC
    let grpc_addr = std::env::var("CORE_GRPC_ADDR")
        .unwrap_or_else(|_| "127.0.0.1:9200".into())
        .parse()
        .expect("parse CORE_GRPC_ADDR");
    tracing::info!(%grpc_addr, "core grpc listening");
    Server::builder()
        .add_service(CoreServiceServer::new(CoreGrpc))
        .serve(grpc_addr)
        .await
        .expect("grpc server exited");
}
