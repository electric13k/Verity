"""Brain configuration.

Law: boot degrades, never dies. Every setting here is optional at startup;
whatever is missing is reported by /healthz, and the features that need it
stay off until it appears. Secrets are user-supplied env vars — never
fetched, never invented, never logged.
"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str | None = None       # Postgres (M2)
    redis_url: str | None = None          # queues, office jobs (M2)
    qdrant_url: str | None = None         # via core service (M3)
    cognee_url: str | None = None         # primary memory engine (M3)
    core_grpc_addr: str | None = None     # Rust core (M1)
    ollama_cloud_api_key: str | None = None  # house models, env-gated (M3)
    encryption_key: str | None = None     # AES-256-GCM for user provider keys (M2)

    def missing(self) -> list[str]:
        """Env-var names (upper-cased) for every unset setting."""
        return [name.upper() for name, value in self.model_dump().items() if value is None]


settings = Settings()
