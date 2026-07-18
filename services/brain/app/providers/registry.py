"""Provider resolution. Model selectors are "provider:model", e.g.
"anthropic:claude-sonnet-5", "openai:gpt-4.1", "ollama:llama3.3",
"verity:qwythos" (house models, env-gated), "echo:echo" (dev only).

Key sources, in order: the user's vaulted key (once DB persistence lands),
then server env for house/dev use. Keys never leave this module except
inside a provider instance.
"""

import os

from app.config import settings
from app.providers.anthropic import AnthropicProvider
from app.providers.base import Provider, ProviderError
from app.providers.echo import EchoProvider
from app.providers.openai_compat import OpenAICompatProvider

DEFAULT_SELECTOR_ENV = "VERITY_DEFAULT_MODEL"

OLLAMA_CLOUD_URL = "https://ollama.com/v1"


def resolve(selector: str) -> tuple[Provider, str]:
    """selector → (provider, model). Raises ProviderError with a message
    safe to surface to the user (no secrets)."""
    selector = selector or os.environ.get(DEFAULT_SELECTOR_ENV, "")
    if not selector:
        if os.environ.get("VERITY_DEV_MODE") == "1":
            return EchoProvider(), "echo"
        raise ProviderError("no model selected and no default configured")
    provider_name, _, model = selector.partition(":")
    if not model:
        raise ProviderError(f"model selector must be provider:model, got {selector!r}")

    match provider_name:
        case "echo":
            if os.environ.get("VERITY_DEV_MODE") != "1":
                raise ProviderError("echo provider is dev-mode only")
            return EchoProvider(), model
        case "anthropic":
            key = os.environ.get("ANTHROPIC_API_KEY", "")
            if not key:
                raise ProviderError("no Anthropic key configured")
            return AnthropicProvider(api_key=key), model
        case "openai":
            key = os.environ.get("OPENAI_API_KEY", "")
            if not key:
                raise ProviderError("no OpenAI key configured")
            return OpenAICompatProvider(api_key=key), model
        case "ollama":
            # Local ollama needs no key.
            base = os.environ.get("OLLAMA_BASE_URL", "http://127.0.0.1:11434/v1")
            return OpenAICompatProvider(api_key="ollama", base_url=base, name="ollama"), model
        case "verity":
            # House models ("provided by Verity"): availability is purely
            # env-gated, no user config row. Per-user daily caps land with
            # DB persistence.
            key = settings.ollama_cloud_api_key or ""
            if not key:
                raise ProviderError("house models are not enabled on this server")
            return OpenAICompatProvider(
                api_key=key, base_url=OLLAMA_CLOUD_URL, name="verity"
            ), model
        case _:
            raise ProviderError(f"unknown provider {provider_name!r}")
