"""Server-authoritative entitlements + usage metering (anti-tamper quotas).

The single public surface is ``service`` — the brain-side authority the gateway
calls before any metered action reaches the AI. See service.py for the laws
(server-only identity, fail-closed-when-required, idempotent metering, degrade
open in dev).
"""

from app.entitlements import service

__all__ = ["service"]
