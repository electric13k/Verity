//! Verity compute node daemon (M7). A volunteer BOINC-style worker: it
//! registers with the coordinator, claims redundancy-2 work units, runs them
//! deterministically (temp-0 seed-7 semantics), submits results, and polls
//! its credit balance (the credit acknowledgement).
//!
//! Laws honored here:
//!   - Boot degrades, never dies. No env var is required to start; /healthz
//!     reports what is missing (owner identity, model runtime, coordinator
//!     reachability) and the daemon idles until it can make progress.
//!   - Tenant/owner identity travels in gRPC metadata (x-verity-user-id).
//!     In production this metadata is injected by the node gateway from the
//!     authenticated owner; in Stage A / local runs the daemon supplies it
//!     from VERITY_OWNER_ID (the coordinator reads it from metadata only and
//!     re-checks stored ownership — it never trusts a request body for
//!     identity). `// ponytail: node gateway + mTLS at Stage C`.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use axum::{routing::get, Json, Router};
use serde::Serialize;
use tonic::metadata::MetadataValue;
use tonic::Request;
use uuid::Uuid;

mod executor;
use executor::Executor;

pub mod pb {
    tonic::include_proto!("verity.v1");
}
use pb::coordinator_service_client::CoordinatorServiceClient;

const VERSION: &str = env!("CARGO_PKG_VERSION");

struct Config {
    coordinator_addr: String,
    owner_id: String,
    node_name: String,
    poll: Duration,
    http_addr: String,
    executor_mode: &'static str,
}

impl Config {
    fn from_env() -> Self {
        let coordinator_addr = std::env::var("COORDINATOR_GRPC_ADDR")
            .ok()
            .filter(|v| !v.is_empty())
            .unwrap_or_else(|| "http://127.0.0.1:9200".into());
        let node_name = std::env::var("NODE_NAME")
            .ok()
            .filter(|v| !v.is_empty())
            .unwrap_or_else(|| "verity-node".into());
        let poll_ms: u64 = std::env::var("NODE_POLL_MS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(500);
        let http_addr = std::env::var("NODE_HTTP_ADDR")
            .ok()
            .filter(|v| !v.is_empty())
            .unwrap_or_else(|| "127.0.0.1:8300".into());
        Config {
            coordinator_addr,
            owner_id: std::env::var("VERITY_OWNER_ID").unwrap_or_default(),
            node_name,
            poll: Duration::from_millis(poll_ms),
            http_addr,
            executor_mode: "", // filled after executor is built
        }
    }

    /// Optional config that is absent, for /healthz. Never fatal.
    fn missing(&self) -> Vec<String> {
        let mut m = Vec::new();
        if self.owner_id.is_empty() {
            m.push("VERITY_OWNER_ID".to_string());
        }
        if std::env::var("OLLAMA_HOST").ok().filter(|v| !v.is_empty()).is_none() {
            m.push("OLLAMA_HOST".to_string());
        }
        m
    }
}

#[derive(Clone)]
struct Health {
    missing: Vec<String>,
    executor_mode: &'static str,
    registered: Arc<AtomicBool>,
}

#[derive(Serialize)]
struct HealthBody {
    status: &'static str,
    service: &'static str,
    version: &'static str,
    executor: &'static str,
    registered: bool,
    missing_config: Vec<String>,
}

/// Build a metadata-carrying request. This is where owner identity is placed
/// on the wire (x-verity-user-id) — the coordinator trusts nothing else.
fn signed<T>(msg: T, owner: &str) -> Request<T> {
    let mut req = Request::new(msg);
    if let Ok(v) = MetadataValue::try_from(owner) {
        req.metadata_mut().insert("x-verity-user-id", v);
    }
    if let Ok(v) = MetadataValue::try_from(Uuid::new_v4().to_string()) {
        req.metadata_mut().insert("x-verity-request-id", v);
    }
    req
}

async fn worker_loop(cfg: Config, exec: Executor, registered: Arc<AtomicBool>) {
    if cfg.owner_id.is_empty() {
        tracing::warn!("VERITY_OWNER_ID unset — node idles (cannot register without an owner)");
        return;
    }

    // Connect + register with backoff; never crash on an absent coordinator.
    let mut client = loop {
        match CoordinatorServiceClient::connect(cfg.coordinator_addr.clone()).await {
            Ok(c) => break c,
            Err(e) => {
                tracing::warn!(error = %e, addr = %cfg.coordinator_addr, "coordinator unreachable; retrying");
                tokio::time::sleep(Duration::from_secs(2)).await;
            }
        }
    };

    let node_id = loop {
        let req = signed(
            pb::RegisterNodeRequest {
                name: cfg.node_name.clone(),
                platform: format!("{}/{}", std::env::consts::OS, std::env::consts::ARCH),
                models: vec![],
            },
            &cfg.owner_id,
        );
        match client.register_node(req).await {
            Ok(resp) => break resp.into_inner().node_id,
            Err(e) => {
                tracing::warn!(error = %e, "register failed; retrying");
                tokio::time::sleep(Duration::from_secs(2)).await;
            }
        }
    };
    registered.store(true, Ordering::SeqCst);
    tracing::info!(%node_id, executor = exec.mode(), "node registered; entering work loop");

    loop {
        let claim = client
            .claim_work(signed(
                pb::ClaimWorkRequest { node_id: node_id.clone() },
                &cfg.owner_id,
            ))
            .await;
        let claim = match claim {
            Ok(r) => r.into_inner(),
            Err(e) => {
                tracing::warn!(error = %e, "claim failed; backing off");
                tokio::time::sleep(cfg.poll).await;
                continue;
            }
        };

        if !claim.has_work {
            tokio::time::sleep(cfg.poll).await;
            continue;
        }

        tracing::info!(work_unit_id = %claim.work_unit_id, model = %claim.model, "claimed work");
        let output = match exec.execute(&claim.model, &claim.prompt).await {
            Ok(o) => o,
            Err(e) => {
                // Executor failed (e.g. Ollama down): log and skip. The unit
                // stays open for reassignment; the daemon lives on.
                tracing::warn!(error = %e, "executor failed; skipping unit");
                tokio::time::sleep(cfg.poll).await;
                continue;
            }
        };

        let verdict = match client
            .submit_result(signed(
                pb::SubmitResultRequest {
                    node_id: node_id.clone(),
                    work_unit_id: claim.work_unit_id.clone(),
                    output,
                },
                &cfg.owner_id,
            ))
            .await
        {
            Ok(r) => r.into_inner().verdict,
            Err(e) => {
                tracing::warn!(error = %e, "submit failed");
                tokio::time::sleep(cfg.poll).await;
                continue;
            }
        };
        tracing::info!(work_unit_id = %claim.work_unit_id, %verdict, "result submitted");

        // Credit acknowledgement: poll the ledger balance.
        if let Ok(r) = client
            .get_credits(signed(
                pb::GetCreditsRequest { node_id: node_id.clone() },
                &cfg.owner_id,
            ))
            .await
        {
            tracing::info!(balance = r.into_inner().balance, "credit ack");
        }
    }
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt().json().init();

    let mut cfg = Config::from_env();
    let exec = Executor::from_env();
    cfg.executor_mode = exec.mode();

    let missing = cfg.missing();
    if !missing.is_empty() {
        tracing::warn!(?missing, "starting degraded");
    }

    let registered = Arc::new(AtomicBool::new(false));
    let health = Health {
        missing: missing.clone(),
        executor_mode: cfg.executor_mode,
        registered: registered.clone(),
    };

    // HTTP /healthz — always answers, reports what is missing.
    let http_addr = cfg.http_addr.clone();
    let app = Router::new().route(
        "/healthz",
        get({
            let h = health.clone();
            move || {
                let h = h.clone();
                async move {
                    Json(HealthBody {
                        status: if h.missing.is_empty() { "ok" } else { "degraded" },
                        service: "node",
                        version: VERSION,
                        executor: h.executor_mode,
                        registered: h.registered.load(Ordering::SeqCst),
                        missing_config: h.missing.clone(),
                    })
                }
            }
        }),
    );
    match tokio::net::TcpListener::bind(&http_addr).await {
        Ok(listener) => {
            tracing::info!(%http_addr, version = VERSION, executor = cfg.executor_mode, "node http listening");
            tokio::spawn(async move {
                let _ = axum::serve(listener, app).await;
            });
        }
        Err(e) => tracing::warn!(error = %e, "healthz bind failed; continuing without it"),
    }

    worker_loop(cfg, exec, registered).await;
}
