"""Postgres access for the brain (asyncpg).

Law: boot degrades, never dies. Without DATABASE_URL (or when the database is
unreachable at startup) the pool stays None; persistence-dependent RPCs answer
UNAVAILABLE with a clear message and /healthz reports DATABASE_URL missing.
The gRPC server always starts.

DATABASE_URL may be a direct Postgres DSN (local pg / Supabase *session*-mode
pooler on 5432) OR a Supabase *transaction*-mode pooler string (host
``*.pooler.supabase.com`` on port 6543). The transaction pooler multiplexes
connections through PgBouncer, which does not support the server-side prepared
statements asyncpg caches by default — so we create the pool with
``statement_cache_size=0``. That is safe for direct connections too (it only
disables client-side statement caching), so one code path serves both. SSL:
asyncpg honours ``sslmode`` in the DSN (Supabase strings carry
``?sslmode=require``), so no extra ssl handling is needed here.

Tenant law: this module never derives identity. Every repo function takes a
required ``user_id`` (from gateway gRPC metadata) and filters on it — a
forgotten filter is a missing required argument, so it fails to compile/run
rather than leaking cross-tenant. Repo functions live in app/repos/*.
"""

import logging

import asyncpg

from app.config import settings

log = logging.getLogger("brain.db")


class DBUnavailable(RuntimeError):
    """Raised when a persistence operation is attempted with no pool.

    Servicers translate this to gRPC UNAVAILABLE with a user-safe message.
    """


class Database:
    def __init__(self) -> None:
        self.pool: asyncpg.Pool | None = None

    async def connect(self) -> None:
        url = settings.database_url
        if not url:
            log.warning("DATABASE_URL not set; persistence features degraded")
            return
        try:
            self.pool = await asyncpg.create_pool(
                dsn=url,
                min_size=1,
                max_size=8,
                command_timeout=30,
                # Supabase transaction pooler (PgBouncer) rejects the prepared
                # statements asyncpg caches by default; 0 disables the cache and
                # is harmless on direct/session connections. See module docstring.
                statement_cache_size=0,
            )
            log.info("db pool ready")
        except Exception as exc:  # degrade, never die
            log.warning(
                "DATABASE_URL set but unreachable (%s); persistence degraded", exc
            )
            self.pool = None

    async def close(self) -> None:
        if self.pool is not None:
            await self.pool.close()
            self.pool = None

    @property
    def available(self) -> bool:
        return self.pool is not None

    def require(self) -> asyncpg.Pool:
        if self.pool is None:
            raise DBUnavailable(
                "database not configured (DATABASE_URL); this feature is unavailable"
            )
        return self.pool


db = Database()


async def ensure_user(conn: asyncpg.Connection, user_id: str) -> None:
    """Lazily create the user row (schema v1: rows created on first request).

    Every tenant-owned table references users(id); write paths call this first
    so a first-time user's inserts don't fail the FK.
    """
    await conn.execute(
        "insert into users (id) values ($1) on conflict (id) do nothing", user_id
    )
