# Verity v2 — Production Hardening & Scale-Out Backlog

Captured for **after the master plan (M0–M9) and the competitor gaps (G1–G12) are complete.**
Systems-engineering concerns the user flagged to "keep in mind." Each is mapped to its real
status so this is actionable, not a wishlist. Do NOT pull these forward ahead of the plan.

## Already in the build (done or in flight)
| Concern | Where it lives |
|---|---|
| Rate limiting | gateway token buckets per user-id (`ratelimit.go`), per-route buckets; Redis at Stage B |
| RPC | gRPC between gateway↔brain↔core↔node (proto = single source of truth) |
| Caching | Redis (rate buckets, queues); CDN/edge caching at Cloudflare (M6) |
| Encryption | AES-256-GCM key vault at rest; TLS/mTLS internal (M6 tooling) |
| Database | Postgres (Supabase Stage A); indexed hot paths; pooler-compatible |
| Containerization / Docker | M6 IaC — per-service Dockerfiles + prod compose (public/private split) |
| CI/CD | `.github/workflows/ci.yml` (typecheck + audits + cross-tenant tests) |
| Error logging | structured logging with secret redaction across all services |
| git / GitHub / cherry-pick | branch workflow in use throughout |
| DB optimization | indexing + query windowing + pagination (done); frontend perf pass (done) |
| WebSockets | plan §1 gateway does "SSE/WS fan-out" — SSE live now; WS upgrade path reserved |

## In the master plan (scheduled, mostly account-gated)
| Concern | Milestone / gate |
|---|---|
| Cloud (AWS/GCP VPC), deployments, staging | M6 Stage B/C — gated on cloud account |
| Firewall / WAF | M6 Cloudflare WAF — gated on Cloudflare account |
| Load balancer | M6/Stage C — in front of the public gateway |
| Serverless / Lambda / Workers | frontend on Cloudflare Pages/Workers (M6); edge functions as needed |
| Object storage (S3) | uploads + artifacts at scale (M6+) — swap local files → S3/R2 |
| Model inference optimization (TensorRT/quantization) | §5 verity-9b serving (GGUF/Ollama, consensus) — GPU gate |
| Embedded database (SQLite) | M8 Tauri desktop offline state + node-daemon local store |
| FTP / file transfer | superseded by multipart upload + object storage; add only if a real need appears |

## Post-launch scale-out (Phase Ω — after v1 retirement)
Pull these in only when real load metrics justify them — premature scale-out is how solo
projects die (ponytail law).
| Concern | Trigger to build it |
|---|---|
| Kubernetes | when compose/single-VM can't hold the load; container orchestration + HPA |
| Message queues (SQS / RabbitMQ / Kafka) | G12 async run-queue (Redis) is the buildable slice now; graduate to a broker when jobs cross machines / need durability + fan-out |
| Async workers / background cloud agents | G12 foundation → detached office/flow execution across nodes |
| Sharding / partitioning | Postgres table partitioning (messages, memories, credit_entries) at high row counts; tenant sharding later |
| DynamoDB / NoSQL | only if a specific access pattern outgrows Postgres; not by default |
| Observability: QPS, throughput, availability, latency SLOs | metrics + tracing (OpenTelemetry) + dashboards + alerting; load testing |
| Caching proxy / read replicas | read-heavy scale; CDN + Postgres replicas |
| Long/short polling fallback | for clients where SSE/WS is blocked (corporate proxies) |
| High availability | multi-AZ, health-checked failover, graceful degradation (degrade-never-die already helps) |

**Discipline:** every item here waits its turn. The plan ships a working, secure product first;
scale-out is earned by measured load, not anticipated.
