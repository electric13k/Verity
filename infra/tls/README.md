# Internal mTLS — Verity v2 (Stage C, plan §2 L3)

Private-network mutual TLS for the internal gRPC mesh (gateway↔brain↔core,
node→core). Separate from public TLS (Cloudflare Origin CA / Tunnel — see
`infra/cloudflare/`).

## Contents

| File | Purpose |
|---|---|
| `gen-certs.sh` | Builds the internal CA + per-service leaf certs (server+client auth). |
| `WIRING.md` | Exact per-service code change to enable mTLS (`VERITY_MTLS=1`). |
| `.gitignore` | Keeps generated keys/certs out of git — they are secrets. |
| `out/` | Generated artifacts (gitignored): `ca.crt`, `ca.key`, `<svc>.crt/.key`. |

## Generate

```bash
./infra/tls/gen-certs.sh            # CA (if absent) + gateway/brain/core/node leaves
```

Leaves are short-lived (default 90 days) on purpose. The CA is long-lived
(~10y) and its **private key (`ca.key`) is the crown jewel** — keep it offline
or in a KMS/secrets manager, never on an app host, never in git.

## Rotation

**Leaf rotation (routine, every ~60 days — before the 90-day expiry):**

1. `./infra/tls/gen-certs.sh` — reissues all leaves against the existing CA
   (the CA is reused unless `FORCE_CA=1`). Existing `ca.crt` trust is unchanged,
   so a rolling restart works.
2. Redeploy services picking up the new leaf files (rolling, one service at a
   time). Because every service already trusts `ca.crt`, old and new leaves are
   both valid during the roll — no coordinated downtime.
3. Confirm each `/healthz` is green after its restart.

**CA rotation (rare — root compromise or scheduled multi-year refresh):**

Because a new CA breaks trust for every peer, do it in trust-then-swap order:

1. Generate a new CA alongside the old: keep both `ca.crt` values concatenated
   into the trust bundle mounted at `VERITY_TLS_CA` (services trust BOTH roots).
   Roll every service to the combined bundle first.
2. `FORCE_CA=1 ./infra/tls/gen-certs.sh` then reissue leaves signed by the new
   CA; roll them out (peers still trust them via the combined bundle).
3. Once all leaves are on the new CA, drop the old root from the bundle and roll
   once more. Now only the new CA is trusted.

At no step is the mesh left where a live peer presents a leaf no other peer
trusts — that would fail closed and take the app down.

## Verify a cert

```bash
openssl verify -CAfile infra/tls/out/ca.crt infra/tls/out/core.crt
openssl x509 -in infra/tls/out/core.crt -noout -text | grep -A1 'Alternative Name'
```

## Safety notes

- `VERITY_MTLS` defaults to `0`. Turn it to `1` only after **all four** services
  ship the `WIRING.md` change and all leaves are mounted — a partially-wired
  mesh fails closed and violates boot-degrades.
- The generator sets `out/` to mode 700 and keys to 600. Never loosen these,
  never commit `out/`.
