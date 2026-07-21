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

    # G2 web tools. The headless-browser fetch service (backlog G11) has a
    # sensible private-net default, so web_fetch is "configured" out of the box
    # and simply DEGRADES (clean "web fetch unavailable" result) when the
    # service is unreachable — no new required env. web_search is unconfigured
    # until a provider key/url appears; it degrades to "search not configured"
    # (never fabricates results). Provider auto-selects from whichever of
    # Tavily / Brave / SearXNG is configured, unless pinned by
    # WEB_SEARCH_PROVIDER. Keys are secrets — never logged.
    fetch_service_url: str = Field(
        default="http://fetch:8400", validation_alias="FETCH_SERVICE_URL"
    )
    web_search_provider: str | None = None   # tavily | brave | searxng (else auto)
    tavily_api_key: str | None = None        # secret
    brave_api_key: str | None = None         # secret
    searxng_url: str | None = None           # self-hosted SearXNG JSON endpoint

    # G9 file-output deliverables + G7 knowledge base: on-disk, tenant-scoped
    # roots (no new DB table, no new required env — default to a temp dir).
    output_files_dir: str | None = None      # deliverable store root (else tempdir)
    kb_dir: str | None = None                # KB doc-index root (else tempdir)
    # G9 image generation is provider-gated; unset → generate_image degrades.
    image_api_key: str | None = None         # secret; enables generate_image

    def missing(self) -> list[str]:
        """Env-var names (upper-cased) for every unset setting.

        Optional feature toggles whose absence just means "that feature is off"
        (web-search keys, image key, the on-disk store roots that default to a
        temp dir) are excluded so /healthz reports genuinely-needed config, not
        every off-by-default capability."""
        return [
            name.upper()
            for name, value in self.model_dump().items()
            if value is None and name.upper() not in _NON_BLOCKING
        ]


# Settings whose absence is a normal, fully-degraded state — excluded from the
# /healthz "missing" list so it stays about config a deploy genuinely needs.
_NON_BLOCKING = frozenset(
    {
        "WEB_SEARCH_PROVIDER", "TAVILY_API_KEY", "BRAVE_API_KEY", "SEARXNG_URL",
        "OUTPUT_FILES_DIR", "KB_DIR", "IMAGE_API_KEY",
    }
)


settings = Settings()
