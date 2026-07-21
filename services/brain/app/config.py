"""Brain configuration.

Law: boot degrades, never dies. Every setting here is optional at startup;
whatever is missing is reported by /healthz, and the features that need it
stay off until it appears. Secrets are user-supplied env vars — never
fetched, never invented, never logged.
"""

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # DATABASE_URL may be a direct Postgres DSN (session mode / local pg) or a
    # Supabase transaction-pooler string (host ...pooler.supabase.com:6543,
    # usually with ?sslmode=require). The pool disables prepared-statement
    # caching so the transaction pooler works — see app/db.py.
    database_url: str | None = None       # Postgres / Supabase pooler (M2)
    redis_url: str | None = None          # queues, office jobs (M2)
    qdrant_url: str | None = None         # via core service (M3)
    cognee_url: str | None = None         # remote (HTTP) cognee, optional (M3)
    obsidian_vault_path: str | None = None  # durable fallback brain store (markdown vault)
    core_grpc_addr: str | None = None     # Rust core (M1)
    ollama_cloud_api_key: str | None = None  # house models, env-gated (M3)
    encryption_key: str | None = None     # AES-256-GCM for user provider keys (M2)

    # cognee = PRIMARY memory engine (in-process library, dataset-per-user).
    # Optional extra: enable with VERITY_COGNEE=1 AND `pip install
    # verity-brain[cognee]`. When off, unimportable, or unable to init, memory
    # degrades to the Obsidian vault, then the in-process store — boot never
    # dies. cognee needs an embedding/LLM; pass the provider through below, or
    # let cognee read its own LLM_* env. If no model is available cognee calls
    # fail per-request and recall/learn degrade to the fallback store.
    cognee_enabled: bool = Field(default=False, validation_alias="VERITY_COGNEE")
    cognee_data_dir: str | None = None       # cognee knowledge-graph storage root
    cognee_llm_provider: str | None = None   # e.g. openai / anthropic / ollama
    cognee_llm_model: str | None = None      # e.g. gpt-4o-mini
    cognee_llm_api_key: str | None = None    # secret; handed to cognee, never logged

    def missing(self) -> list[str]:
        """Env-var names (upper-cased) for every unset setting."""
        return [name.upper() for name, value in self.model_dump().items() if value is None]


settings = Settings()
