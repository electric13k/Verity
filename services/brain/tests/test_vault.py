import pytest
from cryptography.exceptions import InvalidTag

from app import vault
from app.config import settings

KEY = "11" * 32  # test-only key


@pytest.fixture(autouse=True)
def _key(monkeypatch):
    monkeypatch.setattr(settings, "encryption_key", KEY)


def test_roundtrip():
    nonce, ct = vault.encrypt("sk-secret-123", user_id="user_a")
    assert vault.decrypt(nonce, ct, user_id="user_a") == "sk-secret-123"
    assert ct != b"sk-secret-123"


def test_wrong_user_fails_closed():
    """A ciphertext moved to another user's row must not decrypt."""
    nonce, ct = vault.encrypt("sk-secret-123", user_id="user_a")
    with pytest.raises(InvalidTag):
        vault.decrypt(nonce, ct, user_id="user_b")


def test_wrong_key_fails(monkeypatch):
    nonce, ct = vault.encrypt("sk-secret-123", user_id="user_a")
    monkeypatch.setattr(settings, "encryption_key", "22" * 32)
    with pytest.raises(InvalidTag):
        vault.decrypt(nonce, ct, user_id="user_a")


def test_missing_key_degrades(monkeypatch):
    monkeypatch.setattr(settings, "encryption_key", None)
    monkeypatch.delenv("ENCRYPTION_KEY", raising=False)
    with pytest.raises(vault.VaultUnavailable):
        vault.encrypt("x", user_id="user_a")


def test_bad_key_degrades(monkeypatch):
    monkeypatch.setattr(settings, "encryption_key", "not-hex")
    with pytest.raises(vault.VaultUnavailable):
        vault.encrypt("x", user_id="user_a")
