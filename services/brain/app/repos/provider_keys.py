"""Provider-keys repo. Stores ONLY ciphertext + nonce (AES-256-GCM, AAD =
user_id, encrypted in app.vault). Plaintext key material never touches the
database or logs. All queries filter by user_id (tenant law)."""

from __future__ import annotations

from app.db import db, ensure_user


async def put(user_id: str, provider: str, nonce: bytes, ciphertext: bytes) -> None:
    pool = db.require()
    async with pool.acquire() as conn:
        async with conn.transaction():
            await ensure_user(conn, user_id)
            await conn.execute(
                "insert into provider_keys (user_id, provider, key_ciphertext, nonce) "
                "values ($1, $2, $3, $4) "
                "on conflict (user_id, provider) do update "
                "set key_ciphertext = excluded.key_ciphertext, nonce = excluded.nonce",
                user_id, provider, ciphertext, nonce,
            )


async def get_material(user_id: str, provider: str) -> tuple[bytes, bytes] | None:
    """Returns (nonce, ciphertext) for decryption, or None. Never returns
    plaintext — callers decrypt via app.vault with the AAD-bound user_id."""
    pool = db.require()
    async with pool.acquire() as conn:
        r = await conn.fetchrow(
            "select nonce, key_ciphertext from provider_keys "
            "where user_id = $1 and provider = $2",
            user_id, provider,
        )
    if not r:
        return None
    return bytes(r["nonce"]), bytes(r["key_ciphertext"])


async def list_providers(user_id: str) -> list[str]:
    """Provider names the user has configured — never any key material."""
    pool = db.require()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "select provider from provider_keys where user_id = $1 order by provider",
            user_id,
        )
    return [r["provider"] for r in rows]


async def delete(user_id: str, provider: str) -> bool:
    pool = db.require()
    async with pool.acquire() as conn:
        result = await conn.execute(
            "delete from provider_keys where user_id = $1 and provider = $2",
            user_id, provider,
        )
    return result.endswith("1")
