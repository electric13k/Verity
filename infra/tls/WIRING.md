# mTLS wiring spec (follow-up for service owners)

Stage C secures the internal gRPC mesh with mutual TLS (plan §2 L3). The certs
and CA come from `infra/tls/gen-certs.sh`. **This pass does not edit service
source** (owned by other agents); this file is the precise change each service
needs. One shared law across all four: **degrade to plaintext when
`VERITY_MTLS != "1"`** so dev/Stage-A single-box runs keep working and boot
never dies.

## Shared conventions

- Env flag: `VERITY_MTLS=1` turns mTLS on. Unset/`0` ⇒ current plaintext path.
- Cert paths (mount the leaf read-only per container):
  - `VERITY_TLS_CA`   → `ca.crt`   (trust anchor, all services)
  - `VERITY_TLS_CERT` → `<svc>.crt` (this service's leaf)
  - `VERITY_TLS_KEY`  → `<svc>.key` (this service's private key)
- Peer identity: the leaf CN/SAN is the compose service name (`brain`, `core`,
  …), so dial targets must use those names (compose already does:
  `BRAIN_GRPC_ADDR=brain:9100`, `CORE_GRPC_ADDR=core:9200`,
  `COORDINATOR_GRPC_ADDR=http://core:9200`). ServerName for verification = the
  hostname in the dial address.
- Every leaf has `serverAuth,clientAuth`, so servers verify clients and clients
  verify servers (true mutual TLS).

Add these three env vars (all optional, empty default) to each service block in
`infra/docker/compose.prod.yaml` when mTLS is turned on, and mount the leaf +
`ca.crt`. Absent ⇒ plaintext, per the flag.

---

## gateway (Go) — client to brain & core

File: `services/gateway/spine.go`, `newSpine()`. Today both conns use
`insecure.NewCredentials()`. Replace the credential construction with a helper
gated on `VERITY_MTLS`:

```go
// creds returns mTLS transport credentials when VERITY_MTLS=1, else insecure.
func meshCreds() (credentials.TransportCredentials, error) {
    if os.Getenv("VERITY_MTLS") != "1" {
        return insecure.NewCredentials(), nil
    }
    cert, err := tls.LoadX509KeyPair(os.Getenv("VERITY_TLS_CERT"), os.Getenv("VERITY_TLS_KEY"))
    if err != nil { return nil, err }
    caPEM, err := os.ReadFile(os.Getenv("VERITY_TLS_CA"))
    if err != nil { return nil, err }
    pool := x509.NewCertPool()
    if !pool.AppendCertsFromPEM(caPEM) { return nil, errors.New("bad CA PEM") }
    return credentials.NewTLS(&tls.Config{
        Certificates: []tls.Certificate{cert}, // present gateway leaf (client auth)
        RootCAs:      pool,                     // verify brain/core against our CA
        MinVersion:   tls.VersionTLS13,
    }), nil
}
```

Then in `newSpine()`: `tc, err := meshCreds()` once and pass
`grpc.WithTransportCredentials(tc)` to both `grpc.NewClient` calls. ServerName
is taken from the dial host (`brain`, `core`) automatically. Imports to add:
`crypto/tls`, `crypto/x509`, `errors`, `google.golang.org/grpc/credentials`.

## brain (Python, grpcio) — server

File: `services/brain/app/grpc_server.py`, `serve()`. Today:
`server.add_insecure_port(addr)`. Gate it:

```python
import os
if os.environ.get("VERITY_MTLS") == "1":
    with open(os.environ["VERITY_TLS_KEY"], "rb") as f: key = f.read()
    with open(os.environ["VERITY_TLS_CERT"], "rb") as f: crt = f.read()
    with open(os.environ["VERITY_TLS_CA"], "rb") as f: ca = f.read()
    creds = grpc.ssl_server_credentials(
        [(key, crt)],
        root_certificates=ca,
        require_client_auth=True,          # reject peers without a CA-signed leaf
    )
    server.add_secure_port(addr, creds)
else:
    server.add_insecure_port(addr)         # dev / Stage A
```

## core (Rust, tonic) — server

File: `services/core/src/main.rs`, the `Server::builder()...serve()` block. Wrap
with a `ServerTlsConfig` when the flag is set:

```rust
let mut builder = Server::builder();
if std::env::var("VERITY_MTLS").as_deref() == Ok("1") {
    let cert = std::fs::read(std::env::var("VERITY_TLS_CERT")?)?;
    let key  = std::fs::read(std::env::var("VERITY_TLS_KEY")?)?;
    let ca   = std::fs::read(std::env::var("VERITY_TLS_CA")?)?;
    let tls = tonic::transport::ServerTlsConfig::new()
        .identity(tonic::transport::Identity::from_pem(cert, key))
        .client_ca_root(tonic::transport::Certificate::from_pem(ca)); // require client cert
    builder = builder.tls_config(tls)?;
}
builder
    .add_service(CoreServiceServer::new(CoreGrpc))
    .add_service(CoordinatorServiceServer::new(CoordinatorGrpc::new(pool)))
    .serve(grpc_addr).await?;
```

Enable tonic's TLS feature in `services/core/Cargo.toml`:
`tonic = { version = "0.12", features = ["tls"] }`.

## node (Rust, tonic) — client to core (coordinator)

File: `services/node/src/main.rs`, `worker_loop()` where it calls
`CoordinatorServiceClient::connect(cfg.coordinator_addr...)`. Replace the bare
connect with a channel that carries a `ClientTlsConfig` when the flag is set:

```rust
let channel = if std::env::var("VERITY_MTLS").as_deref() == Ok("1") {
    let cert = std::fs::read(std::env::var("VERITY_TLS_CERT")?)?;
    let key  = std::fs::read(std::env::var("VERITY_TLS_KEY")?)?;
    let ca   = std::fs::read(std::env::var("VERITY_TLS_CA")?)?;
    let tls = tonic::transport::ClientTlsConfig::new()
        .ca_certificate(tonic::transport::Certificate::from_pem(ca))
        .identity(tonic::transport::Identity::from_pem(cert, key)) // present node leaf
        .domain_name("core");                                      // must match core's SAN
    tonic::transport::Channel::from_shared(cfg.coordinator_addr.clone())?
        .tls_config(tls)?.connect().await?
} else {
    tonic::transport::Channel::from_shared(cfg.coordinator_addr.clone())?.connect().await?
};
let mut client = CoordinatorServiceClient::new(channel);
```

Also add `features = ["tls"]` to tonic in `services/node/Cargo.toml`, and when
mTLS is on the address must be `https://core:9200` (the plaintext default is
`http://core:9200`).

---

## Compose additions (when turning mTLS on)

For gateway, brain, core, node add:

```yaml
    environment:
      VERITY_MTLS: ${VERITY_MTLS:-0}
      VERITY_TLS_CA:   /etc/verity/tls/ca.crt
      VERITY_TLS_CERT: /etc/verity/tls/<svc>.crt
      VERITY_TLS_KEY:  /etc/verity/tls/<svc>.key
    volumes:
      - ./tls/out/ca.crt:/etc/verity/tls/ca.crt:ro
      - ./tls/out/<svc>.crt:/etc/verity/tls/<svc>.crt:ro
      - ./tls/out/<svc>.key:/etc/verity/tls/<svc>.key:ro
```

(Paths relative to `infra/docker/`; the leaf `<svc>` differs per service.)
Keep the default `0` so the mesh stays plaintext until every service ships the
change above — a half-wired mesh would otherwise fail closed and take the app
down, violating boot-degrades.
