//! Compute-network coordinator (M7): the server side of the scattered-
//! compute network. Backed by Postgres (schema from migration 0002) and the
//! pure consensus verifier in `consensus.rs`.
//!
//! Tenant/owner law: identity ALWAYS comes from gRPC metadata
//! (`x-verity-user-id`), never from a request body. A `node_id` in a body is
//! only a handle; every node call re-checks that the handle's stored owner
//! equals the metadata owner, and fails closed on mismatch. So a caller can
//! never act as a node it does not own, and the sybil-pair guard reasons
//! about owners the coordinator recorded — not owners a node self-asserts.
//!
//! Node output is UNTRUSTED external content: the coordinator only SHA-256s
//! it to compare digests (BOP — it never enters a prompt).

use sha2::{Digest, Sha256};
use sqlx::{PgPool, Row};
use tonic::{Request, Response, Status};
use uuid::Uuid;

use crate::consensus::{self, Verdict, WorkResult};
use crate::pb;
use crate::pb::coordinator_service_server::CoordinatorService;
use crate::qdrant::tenant_user_id;

pub struct CoordinatorGrpc {
    pool: Option<PgPool>,
}

impl CoordinatorGrpc {
    pub fn new(pool: Option<PgPool>) -> Self {
        Self { pool }
    }

    fn pool(&self) -> Result<&PgPool, Status> {
        self.pool
            .as_ref()
            .ok_or_else(|| Status::unavailable("compute network not configured (DATABASE_URL)"))
    }
}

/// Canonical digest of a node's output. The consensus criterion is byte-equal
/// output from temp-0 seed-7 inference; we hash coordinator-side so a node
/// cannot lie about the digest of the output it submitted.
fn digest_output(output: &str) -> String {
    let mut h = Sha256::new();
    h.update(output.as_bytes());
    hex::encode(h.finalize())
}

fn parse_uuid(s: &str, field: &str) -> Result<Uuid, Status> {
    Uuid::parse_str(s).map_err(|_| Status::invalid_argument(format!("invalid {field}")))
}

fn db_err(e: sqlx::Error) -> Status {
    // Message is generic; details go to structured logs, not the wire.
    tracing::error!(error = %e, "coordinator db error");
    Status::unavailable("compute datastore error")
}

/// Ensure a users row exists for `owner` (lazy creation, matching the
/// gateway's first-authenticated-request pattern) so the FKs on
/// compute_nodes / compute_jobs hold.
async fn ensure_user(pool: &PgPool, owner: &str) -> Result<(), Status> {
    sqlx::query("insert into users (id) values ($1) on conflict (id) do nothing")
        .bind(owner)
        .execute(pool)
        .await
        .map_err(db_err)?;
    Ok(())
}

/// Confirm the node handle belongs to the metadata owner. Fail closed:
/// unknown node or owner mismatch is permission denied.
async fn assert_node_owned(pool: &PgPool, node: Uuid, owner: &str) -> Result<(), Status> {
    let stored: Option<String> =
        sqlx::query_scalar("select owner_id from compute_nodes where id = $1")
            .bind(node)
            .fetch_optional(pool)
            .await
            .map_err(db_err)?;
    match stored {
        Some(o) if o == owner => Ok(()),
        _ => Err(Status::permission_denied("node not owned by caller")),
    }
}

#[tonic::async_trait]
impl CoordinatorService for CoordinatorGrpc {
    async fn health(
        &self,
        _req: Request<pb::HealthRequest>,
    ) -> Result<Response<pb::HealthResponse>, Status> {
        let missing: Vec<String> = if self.pool.is_some() {
            vec![]
        } else {
            vec!["DATABASE_URL".into()]
        };
        Ok(Response::new(pb::HealthResponse {
            status: if missing.is_empty() {
                pb::health_response::Status::Ok as i32
            } else {
                pb::health_response::Status::Degraded as i32
            },
            service: "coordinator".into(),
            version: env!("CARGO_PKG_VERSION").into(),
            missing_config: missing,
        }))
    }

    async fn submit_job(
        &self,
        req: Request<pb::SubmitJobRequest>,
    ) -> Result<Response<pb::SubmitJobResponse>, Status> {
        let user_id = tenant_user_id(req.metadata())?; // job owner from metadata only
        let pool = self.pool()?;
        let r = req.into_inner();
        if r.model.is_empty() || r.prompt.is_empty() {
            return Err(Status::invalid_argument("model and prompt are required"));
        }
        ensure_user(pool, &user_id).await?;

        let input_digest = digest_output(&format!("{}\n{}", r.model, r.prompt));
        let mut tx = pool.begin().await.map_err(db_err)?;
        let job_id: Uuid = sqlx::query_scalar(
            "insert into compute_jobs (user_id, model, input_digest, status) \
             values ($1, $2, $3, 'pending') returning id",
        )
        .bind(&user_id)
        .bind(&r.model)
        .bind(&input_digest)
        .fetch_one(&mut *tx)
        .await
        .map_err(db_err)?;

        // Payload carries the executor input. Stored as jsonb via a bound
        // string + ::jsonb cast so core needs no json-decode path.
        let payload = serde_json::json!({ "model": r.model, "prompt": r.prompt }).to_string();
        let work_unit_id: Uuid = sqlx::query_scalar(
            "insert into work_units (job_id, payload, status) \
             values ($1, $2::jsonb, 'pending') returning id",
        )
        .bind(job_id)
        .bind(&payload)
        .fetch_one(&mut *tx)
        .await
        .map_err(db_err)?;
        tx.commit().await.map_err(db_err)?;

        tracing::info!(%job_id, %work_unit_id, "job submitted");
        Ok(Response::new(pb::SubmitJobResponse {
            job_id: job_id.to_string(),
            work_unit_id: work_unit_id.to_string(),
        }))
    }

    async fn register_node(
        &self,
        req: Request<pb::RegisterNodeRequest>,
    ) -> Result<Response<pb::RegisterNodeResponse>, Status> {
        let owner_id = tenant_user_id(req.metadata())?; // node owner from metadata only
        let pool = self.pool()?;
        let r = req.into_inner();
        if r.name.is_empty() {
            return Err(Status::invalid_argument("node name is required"));
        }
        ensure_user(pool, &owner_id).await?;

        let node_id: Uuid = sqlx::query_scalar(
            "insert into compute_nodes (owner_id, name, platform, models, last_seen) \
             values ($1, $2, $3, $4, now()) returning id",
        )
        .bind(&owner_id)
        .bind(&r.name)
        .bind(&r.platform)
        .bind(&r.models)
        .fetch_one(pool)
        .await
        .map_err(db_err)?;

        tracing::info!(%node_id, "node registered");
        Ok(Response::new(pb::RegisterNodeResponse {
            node_id: node_id.to_string(),
        }))
    }

    async fn claim_work(
        &self,
        req: Request<pb::ClaimWorkRequest>,
    ) -> Result<Response<pb::ClaimWorkResponse>, Status> {
        let owner_id = tenant_user_id(req.metadata())?;
        let pool = self.pool()?;
        let node = parse_uuid(&req.into_inner().node_id, "node_id")?;
        assert_node_owned(pool, node, &owner_id).await?;

        // Heartbeat.
        let _ = sqlx::query("update compute_nodes set last_seen = now() where id = $1")
            .bind(node)
            .execute(pool)
            .await
            .map_err(db_err)?;

        let mut tx = pool.begin().await.map_err(db_err)?;
        // Redundancy-2 cap + sybil-pair guard, all under a row lock so two
        // concurrent claimers can never over-assign a unit. SKIP LOCKED lets
        // the loser find other work (or nothing) instead of blocking.
        let candidate = sqlx::query(
            "select wu.id as id, wu.payload->>'model' as model, wu.payload->>'prompt' as prompt \
             from work_units wu \
             where wu.status in ('pending','assigned') \
               and (select count(*) from assignments a where a.work_unit_id = wu.id) < 2 \
               and not exists (select 1 from assignments a where a.work_unit_id = wu.id and a.node_id = $1) \
               and not exists (select 1 from assignments a join compute_nodes n on n.id = a.node_id \
                               where a.work_unit_id = wu.id and n.owner_id = $2) \
             order by wu.created_at \
             for update of wu skip locked \
             limit 1",
        )
        .bind(node)
        .bind(&owner_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(db_err)?;

        let Some(row) = candidate else {
            tx.commit().await.map_err(db_err)?;
            return Ok(Response::new(pb::ClaimWorkResponse {
                has_work: false,
                ..Default::default()
            }));
        };

        let wu_id: Uuid = row.get("id");
        let model: String = row.try_get("model").unwrap_or_default();
        let prompt: String = row.try_get("prompt").unwrap_or_default();

        sqlx::query("insert into assignments (work_unit_id, node_id) values ($1, $2)")
            .bind(wu_id)
            .bind(node)
            .execute(&mut *tx)
            .await
            .map_err(db_err)?;
        sqlx::query("update work_units set status = 'assigned' where id = $1 and status = 'pending'")
            .bind(wu_id)
            .execute(&mut *tx)
            .await
            .map_err(db_err)?;
        tx.commit().await.map_err(db_err)?;

        tracing::info!(work_unit_id = %wu_id, %node, "work claimed");
        Ok(Response::new(pb::ClaimWorkResponse {
            has_work: true,
            work_unit_id: wu_id.to_string(),
            model,
            prompt,
        }))
    }

    async fn submit_result(
        &self,
        req: Request<pb::SubmitResultRequest>,
    ) -> Result<Response<pb::SubmitResultResponse>, Status> {
        let owner_id = tenant_user_id(req.metadata())?;
        let pool = self.pool()?;
        let r = req.into_inner();
        let node = parse_uuid(&r.node_id, "node_id")?;
        let wu_id = parse_uuid(&r.work_unit_id, "work_unit_id")?;
        assert_node_owned(pool, node, &owner_id).await?;

        // Coordinator hashes the (untrusted) output; the node never sets the
        // digest itself.
        let digest = digest_output(&r.output);

        let mut tx = pool.begin().await.map_err(db_err)?;
        // Lock the unit so the two results serialize; only the tx that sees
        // both digests present (and the unit still open) runs consensus.
        let status: Option<String> =
            sqlx::query_scalar("select status from work_units where id = $1 for update")
                .bind(wu_id)
                .fetch_optional(&mut *tx)
                .await
                .map_err(db_err)?;
        let Some(status) = status else {
            return Err(Status::not_found("unknown work unit"));
        };

        let updated = sqlx::query(
            "update assignments set result_digest = $1, completed_at = now() \
             where work_unit_id = $2 and node_id = $3",
        )
        .bind(&digest)
        .bind(wu_id)
        .bind(node)
        .execute(&mut *tx)
        .await
        .map_err(db_err)?;
        if updated.rows_affected() == 0 {
            return Err(Status::failed_precondition("node has no assignment on this unit"));
        }

        let rows = sqlx::query(
            "select a.node_id as node_id, n.owner_id as owner_id, a.result_digest as digest \
             from assignments a join compute_nodes n on n.id = a.node_id \
             where a.work_unit_id = $1",
        )
        .bind(wu_id)
        .fetch_all(&mut *tx)
        .await
        .map_err(db_err)?;

        // Only decide once, while the unit is still open (idempotent under the lock).
        let both_in = rows.len() == 2
            && rows.iter().all(|r| {
                r.try_get::<Option<String>, _>("digest")
                    .ok()
                    .flatten()
                    .map_or(false, |d| !d.is_empty())
            });

        let verdict_str = if status == "assigned" && both_in {
            let mk = |r: &sqlx::postgres::PgRow| WorkResult {
                node_id: r.get::<Uuid, _>("node_id").to_string(),
                owner_id: r.get::<String, _>("owner_id"),
                result_digest: r
                    .try_get::<Option<String>, _>("digest")
                    .ok()
                    .flatten()
                    .unwrap_or_default(),
            };
            let a = mk(&rows[0]);
            let b = mk(&rows[1]);
            match consensus::verify_pair(&a, &b) {
                Ok(Verdict::Verified { digest }) => {
                    sqlx::query("update work_units set status = 'verified' where id = $1")
                        .bind(wu_id)
                        .execute(&mut *tx)
                        .await
                        .map_err(db_err)?;
                    for (node_id, delta, reason) in consensus::credit_deltas(&a, &b, &Verdict::Verified { digest }) {
                        let nid = parse_uuid(&node_id, "node_id")?;
                        sqlx::query(
                            "insert into credit_entries (node_id, delta, reason, work_unit_id) \
                             values ($1, $2, $3, $4)",
                        )
                        .bind(nid)
                        .bind(delta)
                        .bind(reason)
                        .bind(wu_id)
                        .execute(&mut *tx)
                        .await
                        .map_err(db_err)?;
                    }
                    // Close the job when all its units are verified.
                    sqlx::query(
                        "update compute_jobs set status = 'done' \
                         where id = (select job_id from work_units where id = $1) \
                           and not exists (select 1 from work_units w \
                                           where w.job_id = compute_jobs.id and w.status <> 'verified')",
                    )
                    .bind(wu_id)
                    .execute(&mut *tx)
                    .await
                    .map_err(db_err)?;
                    "verified"
                }
                Ok(Verdict::Conflicted) => {
                    sqlx::query("update work_units set status = 'conflicted' where id = $1")
                        .bind(wu_id)
                        .execute(&mut *tx)
                        .await
                        .map_err(db_err)?;
                    "conflicted"
                }
                // Guard already prevents same-owner pairs at claim time; if a
                // sybil pair somehow lands, treat as unverifiable, no credit.
                Err(_) => {
                    sqlx::query("update work_units set status = 'conflicted' where id = $1")
                        .bind(wu_id)
                        .execute(&mut *tx)
                        .await
                        .map_err(db_err)?;
                    "conflicted"
                }
            }
        } else {
            "pending"
        };
        tx.commit().await.map_err(db_err)?;

        tracing::info!(work_unit_id = %wu_id, verdict = verdict_str, "result submitted");
        Ok(Response::new(pb::SubmitResultResponse {
            verdict: verdict_str.into(),
        }))
    }

    async fn get_credits(
        &self,
        req: Request<pb::GetCreditsRequest>,
    ) -> Result<Response<pb::GetCreditsResponse>, Status> {
        let owner_id = tenant_user_id(req.metadata())?;
        let pool = self.pool()?;
        let node = parse_uuid(&req.into_inner().node_id, "node_id")?;
        assert_node_owned(pool, node, &owner_id).await?;

        let balance: i64 =
            sqlx::query_scalar("select coalesce(sum(delta), 0)::bigint from credit_entries where node_id = $1")
                .bind(node)
                .fetch_one(pool)
                .await
                .map_err(db_err)?;
        Ok(Response::new(pb::GetCreditsResponse { balance }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn output_digest_is_stable_and_sensitive() {
        assert_eq!(digest_output("hello"), digest_output("hello"));
        assert_ne!(digest_output("hello"), digest_output("world"));
        // 32-byte sha256 hex.
        assert_eq!(digest_output("x").len(), 64);
    }

    // Fail-closed: identity is checked before anything else. No metadata =>
    // Unauthenticated, and it never reaches the (absent) datastore.
    #[tokio::test]
    async fn submit_job_without_tenant_fails_closed() {
        let svc = CoordinatorGrpc::new(None);
        let req = Request::new(pb::SubmitJobRequest {
            model: "m".into(),
            prompt: "p".into(),
        });
        let err = svc.submit_job(req).await.unwrap_err();
        assert_eq!(err.code(), tonic::Code::Unauthenticated);
    }

    #[tokio::test]
    async fn claim_without_tenant_fails_closed() {
        let svc = CoordinatorGrpc::new(None);
        let req = Request::new(pb::ClaimWorkRequest {
            node_id: Uuid::new_v4().to_string(),
        });
        let err = svc.claim_work(req).await.unwrap_err();
        assert_eq!(err.code(), tonic::Code::Unauthenticated);
    }

    // Boot degrades, never dies: with tenant present but no DB, the surface
    // answers UNAVAILABLE rather than crashing.
    #[tokio::test]
    async fn degrades_without_database() {
        let svc = CoordinatorGrpc::new(None);
        let mut req = Request::new(pb::SubmitJobRequest {
            model: "m".into(),
            prompt: "p".into(),
        });
        req.metadata_mut()
            .insert("x-verity-user-id", "alice".parse().unwrap());
        let err = svc.submit_job(req).await.unwrap_err();
        assert_eq!(err.code(), tonic::Code::Unavailable);
    }
}
