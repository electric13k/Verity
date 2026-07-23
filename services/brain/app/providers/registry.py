"""Provider resolution. Model selectors are "provider:model", e.g.
"anthropic:claude-sonnet-5", "openai:gpt-4.1", "ollama:llama3.3",
"verity:qwythos" (house models, env-gated), "echo:echo" (dev only).

Key sources, in order: the user's vaulted key (AES-256-GCM, decrypted with the
requester's user_id as AAD), then server env for house/dev use. Keys never
leave this module except inside a provider instance and are never logged.
"""

import logging
import os

from app import vault
from app.config import settings
from app.db import db
from app.providers.anthropic import AnthropicProvider
from app.providers.base import Provider, ProviderError
from app.providers.echo import EchoProvider
from app.providers.openai_compat import OpenAICompatProvider
from app.repos import provider_keys as pk_repo

log = logging.getLogger("brain.providers")

DEFAULT_SELECTOR_ENV = "VERITY_DEFAULT_MODEL"

OLLAMA_CLOUD_URL = "https://ollama.com/v1"
# Google exposes an OpenAI-compatible surface (chat/completions + function
# calling + streaming) at this base — the "openai-compat where possible" path
# (ai.google.dev/gemini-api/docs/openai). Gemini's functionDeclarations are
# mapped to OpenAI-style tools under the hood, so tool use rides the exact same
# tested OpenAICompatProvider code path as OpenAI.
GEMINI_OPENAI_URL = "https://generativelanguage.googleapis.com/v1beta/openai"

# Providers that take a user-suppliable key, and their env-fallback var. Drives
# both key resolution and the /v1/me capability report.
KEYED_PROVIDERS: dict[str, str] = {
    "anthropic": "ANTHROPIC_API_KEY",
    "openai": "OPENAI_API_KEY",
    "gemini": "GEMINI_API_KEY",
}
# House providers: availability is purely env-gated, no user key row.
HOUSE_PROVIDERS = ("verity",)


async def _vaulted_key(provider_name: str, user_id: str) -> str | None:
    """The user's decrypted key for this provider, or None. Any failure
    (no DB, no row, bad AAD/tag) degrades to None so env fallback applies."""
    if not db.available or not user_id:
        return None
    try:
        material = await pk_repo.get_material(user_id, provider_name)
    except Exception as exc:  # DB hiccup must not break chat
        log.warning("provider-key lookup failed for %s: %s", provider_name, exc)
        return None
    if not material:
        return None
    nonce, ciphertext = material
    try:
        return vault.decrypt(nonce, ciphertext, user_id=user_id)
    except Exception:  # InvalidTag / VaultUnavailable — never surface key state
        log.warning("provider-key decrypt failed for %s (vault/AAD)", provider_name)
        return None


def resolve(selector: str) -> tuple[Provider, str]:
    """Env-only resolution (house/dev, no per-user key). Prefer
    resolve_for_user() on tenant-scoped paths."""
    provider_name, model = _split(selector)
    return _resolve_with_key(provider_name, model, user_key=None)


async def resolve_for_user(selector: str, user_id: str) -> tuple[Provider, str]:
    """selector → (provider, model), consulting the user's vaulted key first
    then server env. Raises ProviderError with a user-safe message.

    House ("provided by Verity") models are additionally gated by the per-user
    daily cap read from the user's entitlements (not env-only): the cap lives in
    the plan/overrides, keyed to the metadata user_id, so no client edit can lift
    it. This is a READ-ONLY peek — the authoritative count is reserved at
    execution time (entitlements.service.reserve_house_call) — so fail-fast
    resolves (office/branch creation) never consume the cap."""
    provider_name, model = _split(selector)
    user_key = None
    if provider_name in KEYED_PROVIDERS:
        user_key = await _vaulted_key(provider_name, user_id)
    provider, resolved_model = _resolve_with_key(provider_name, model, user_key=user_key)
    if provider.name in HOUSE_PROVIDERS:
        # Imported lazily to avoid an entitlements→providers import cycle.
        from app.entitlements import service as entitlements

        await entitlements.enforce_house_cap(user_id)
    return provider, resolved_model


def _split(selector: str) -> tuple[str, str]:
    selector = selector or os.environ.get(DEFAULT_SELECTOR_ENV, "")
    if not selector:
        if os.environ.get("VERITY_DEV_MODE") == "1":
            return "echo", "echo"
        raise ProviderError("no model selected and no default configured")
    provider_name, _, model = selector.partition(":")
    if not model:
        raise ProviderError(f"model selector must be provider:model, got {selector!r}")
    return provider_name, model


def _resolve_with_key(
    provider_name: str, model: str, *, user_key: str | None
) -> tuple[Provider, str]:
    match provider_name:
        case "echo":
            if os.environ.get("VERITY_DEV_MODE") != "1":
                raise ProviderError("echo provider is dev-mode only")
            return EchoProvider(), model
        case "anthropic":
            key = user_key or os.environ.get("ANTHROPIC_API_KEY", "")
            if not key:
                raise ProviderError("no Anthropic key configured")
            return AnthropicProvider(api_key=key), model
        case "openai":
            key = user_key or os.environ.get("OPENAI_API_KEY", "")
            if not key:
                raise ProviderError("no OpenAI key configured")
            return OpenAICompatProvider(api_key=key), model
        case "gemini" | "google":
            # G10: user-key Google Gemini via its OpenAI-compatible endpoint.
            # Degrades (raises a user-safe error) when unkeyed; tool-calling
            # works through the shared OpenAI-compat path.
            key = (
                user_key
                or os.environ.get("GEMINI_API_KEY", "")
                or os.environ.get("GOOGLE_API_KEY", "")
            )
            if not key:
                raise ProviderError("no Gemini key configured")
            return OpenAICompatProvider(
                api_key=key, base_url=GEMINI_OPENAI_URL, name="gemini"
            ), model
        case "ollama":
            # Local ollama needs no key.
            base = os.environ.get("OLLAMA_BASE_URL", "http://127.0.0.1:11434/v1")
            return OpenAICompatProvider(api_key="ollama", base_url=base, name="ollama"), model
        case "verity":
            # House models ("provided by Verity"): availability is env-gated
            # (no user key row). The per-user DAILY cap is enforced in
            # resolve_for_user via the entitlement store (plan/overrides), not
            # here — this branch only decides availability.
            key = settings.ollama_cloud_api_key or ""
            if not key:
                raise ProviderError("house models are not enabled on this server")
            return OpenAICompatProvider(
                api_key=key, base_url=OLLAMA_CLOUD_URL, name="verity"
            ), model
        case _:
            raise ProviderError(f"unknown provider {provider_name!r}")


async def capabilities(user_id: str) -> list[dict]:
    """Per-provider capability report for /v1/me: configured (user key OR env
    fallback) and house (Verity-provided). Never exposes key material."""
    out: list[dict] = []
    for provider, env_var in KEYED_PROVIDERS.items():
        configured = bool(os.environ.get(env_var)) or bool(
            await _vaulted_key(provider, user_id)
        )
        out.append({"id": provider, "configured": configured, "house": False})
    for provider in HOUSE_PROVIDERS:
        out.append(
            {
                "id": provider,
                "configured": bool(settings.ollama_cloud_api_key),
                "house": True,
            }
        )
    return out
