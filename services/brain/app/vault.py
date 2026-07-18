"""AES-256-GCM vault for user-supplied provider API keys.

- Key material comes from ENCRYPTION_KEY (64 hex chars = 32 bytes),
  user-supplied env / KMS — never generated or fetched by agents.
- AAD binds every ciphertext to its owning user_id: a ciphertext copied
  onto another user's row fails to decrypt (tenant law, fail closed).
- Plaintext keys never appear in logs or the database; only
  (nonce, ciphertext) are stored (provider_keys table).
"""

import os
import secrets

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.config import settings

NONCE_LEN = 12


class VaultUnavailable(RuntimeError):
    """ENCRYPTION_KEY missing/invalid — vault features degrade, boot survives."""


def _aesgcm() -> AESGCM:
    key_hex = settings.encryption_key or os.environ.get("ENCRYPTION_KEY", "")
    if not key_hex:
        raise VaultUnavailable("ENCRYPTION_KEY not set (64 hex chars)")
    try:
        key = bytes.fromhex(key_hex)
    except ValueError as exc:
        raise VaultUnavailable("ENCRYPTION_KEY must be hex") from exc
    if len(key) != 32:
        raise VaultUnavailable("ENCRYPTION_KEY must be 32 bytes (64 hex chars)")
    return AESGCM(key)


def encrypt(plaintext: str, *, user_id: str) -> tuple[bytes, bytes]:
    """Returns (nonce, ciphertext) with the user_id bound as AAD."""
    aes = _aesgcm()
    nonce = secrets.token_bytes(NONCE_LEN)
    ct = aes.encrypt(nonce, plaintext.encode(), user_id.encode())
    return nonce, ct


def decrypt(nonce: bytes, ciphertext: bytes, *, user_id: str) -> str:
    """Raises InvalidTag if the ciphertext was not encrypted for user_id."""
    aes = _aesgcm()
    return aes.decrypt(nonce, ciphertext, user_id.encode()).decode()


__all__ = ["encrypt", "decrypt", "VaultUnavailable", "InvalidTag"]
