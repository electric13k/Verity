#!/usr/bin/env bash
# Verity v2 — internal mTLS certificate generator (plan §2 L3, Stage C).
#
# Builds a private internal CA and per-service leaf certs (server+client auth)
# for the internal gRPC mesh: gateway <-> brain <-> core, and node -> core.
# These secure ONLY the private-network hops; they are NOT the public TLS cert
# (that is Cloudflare Origin CA / Tunnel — see infra/cloudflare/).
#
# Output → infra/tls/out/ (gitignored). Nothing here is a secret to commit;
# the keys it PRODUCES are secrets and must never be committed (see .gitignore).
#
# Usage:
#   ./infra/tls/gen-certs.sh                 # generate CA (if absent) + all leaves
#   FORCE_CA=1 ./infra/tls/gen-certs.sh      # also regenerate the CA (rotates root)
#   LEAF_DAYS=90 CA_DAYS=3650 ./infra/tls/gen-certs.sh
#
# Requires: openssl. No network, no daemon.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
out="${OUT_DIR:-$here/out}"
CA_DAYS="${CA_DAYS:-3650}"     # root CA lifetime (~10y)
LEAF_DAYS="${LEAF_DAYS:-90}"   # leaf lifetime — short, rotate quarterly
SERVICES=(gateway brain core node)

mkdir -p "$out"
chmod 700 "$out"

log() { printf '  %s\n' "$*"; }

# ---- CA ---------------------------------------------------------------------
if [[ ! -f "$out/ca.crt" || "${FORCE_CA:-0}" == "1" ]]; then
  log "generating internal CA (${CA_DAYS}d)"
  openssl ecparam -name prime256v1 -genkey -noout -out "$out/ca.key"
  openssl req -x509 -new -key "$out/ca.key" -sha256 -days "$CA_DAYS" \
    -out "$out/ca.crt" \
    -subj "/O=Verity/OU=internal/CN=Verity Internal CA" \
    -addext "basicConstraints=critical,CA:TRUE,pathlen:0" \
    -addext "keyUsage=critical,keyCertSign,cRLSign"
  chmod 600 "$out/ca.key"
else
  log "reusing existing CA ($out/ca.crt) — set FORCE_CA=1 to rotate the root"
fi

# ---- leaves -----------------------------------------------------------------
# Each service is BOTH a server (accepts mesh connections) and a client (dials
# peers), so every leaf carries serverAuth + clientAuth. SANs cover the compose
# service DNS name plus localhost for single-box / dev runs.
for svc in "${SERVICES[@]}"; do
  log "issuing leaf for '$svc' (${LEAF_DAYS}d)"
  openssl ecparam -name prime256v1 -genkey -noout -out "$out/$svc.key"
  openssl req -new -key "$out/$svc.key" \
    -subj "/O=Verity/OU=internal/CN=$svc" -out "$out/$svc.csr"

  ext="$out/$svc.ext"
  cat > "$ext" <<EOF
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth,clientAuth
subjectAltName=DNS:$svc,DNS:localhost,IP:127.0.0.1
EOF

  openssl x509 -req -in "$out/$svc.csr" \
    -CA "$out/ca.crt" -CAkey "$out/ca.key" -CAcreateserial \
    -days "$LEAF_DAYS" -sha256 -extfile "$ext" -out "$out/$svc.crt"

  chmod 600 "$out/$svc.key"
  rm -f "$out/$svc.csr" "$ext"
done

# ---- verify -----------------------------------------------------------------
for svc in "${SERVICES[@]}"; do
  openssl verify -CAfile "$out/ca.crt" "$out/$svc.crt" >/dev/null \
    && log "verified $svc.crt against CA"
done

cat <<EOF

Done. Artifacts in: $out
  ca.crt            internal root (distribute to every service as the trust anchor)
  ca.key            ROOT PRIVATE KEY — keep offline / in KMS, never commit
  <svc>.crt/.key    per-service leaf (mount read-only into each container)

Wire-up: see infra/tls/WIRING.md. Rotation: see infra/tls/README.md.
EOF
