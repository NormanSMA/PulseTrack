"""Boveda AES-256-GCM para tokens OAuth (oauth_vault) usando PULSETRACK_VAULT_KEY."""

from __future__ import annotations

import base64
import binascii
import json
import os
from typing import Any

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

ALLOWED_VAULT_PROVIDERS = frozenset({"garmin", "renpho", "hevy"})
NONCE_SIZE_BYTES = 12
KEY_SIZE_BYTES = 32
TAG_SIZE_BYTES = 16


class VaultError(Exception):
    """Error base de cifrado o politica en GarthVault."""


class VaultKeyError(VaultError):
    """Error cuando falta o es invalida la clave PULSETRACK_VAULT_KEY."""


class VaultDecryptError(VaultError):
    """Error cuando el payload cifrado fue alterado o la clave no coincide."""


class VaultAuthorityError(VaultError):
    """Error ADR-001 cuando se intenta almacenar un proveedor prohibido."""


def _decode_key(raw_key: str | None) -> bytes:
    if not raw_key or not raw_key.strip():
        raise VaultKeyError("PULSETRACK_VAULT_KEY no esta definida en el entorno.")

    candidate = raw_key.strip()

    # Formato hexadecimal de 64 caracteres (32 bytes)
    if len(candidate) == KEY_SIZE_BYTES * 2:
        try:
            key_bytes = bytes.fromhex(candidate)
            if len(key_bytes) == KEY_SIZE_BYTES:
                return key_bytes
        except ValueError:
            pass

    # Formato base64 / urlsafe-base64
    padded = candidate + "=" * ((4 - len(candidate) % 4) % 4)
    for decoder in (base64.urlsafe_b64decode, base64.b64decode):
        try:
            key_bytes = decoder(padded.encode("ascii"))
            if len(key_bytes) == KEY_SIZE_BYTES:
                return key_bytes
        except (binascii.Error, ValueError):
            continue

    raise VaultKeyError(
        "PULSETRACK_VAULT_KEY debe codificar exactamente 32 bytes (AES-256) en base64 o hex."
    )


def _validate_provider(provider: str) -> str:
    normalized = provider.strip().lower()
    if normalized in {"apple_health", "apple-health", "applehealth", "healthkit"}:
        raise VaultAuthorityError("ADR-001: apple_health esta prohibido en oauth_vault.")
    if normalized not in ALLOWED_VAULT_PROVIDERS:
        raise VaultAuthorityError(
            f"Proveedor '{provider}' no permitido. Permitidos: {sorted(ALLOWED_VAULT_PROVIDERS)}."
        )
    return normalized


class GarthVault:
    """Cifra y descifra tokens OAuth/Garth con AES-256-GCM sin claves hardcodeadas."""

    def __init__(self, key_material: str | None = None) -> None:
        env_key = key_material if key_material is not None else os.getenv("PULSETRACK_VAULT_KEY")
        self._key = _decode_key(env_key)
        self._aesgcm = AESGCM(self._key)

    @classmethod
    def from_env(cls) -> "GarthVault":
        return cls(os.getenv("PULSETRACK_VAULT_KEY"))

    def encrypt_token(self, plaintext: str, aad: bytes | None = None) -> bytes:
        if not isinstance(plaintext, str) or len(plaintext) == 0:
            raise VaultError("El token a cifrar debe ser una cadena no vacia.")
        nonce = os.urandom(NONCE_SIZE_BYTES)
        ciphertext = self._aesgcm.encrypt(nonce, plaintext.encode("utf-8"), aad)
        return nonce + ciphertext

    def decrypt_token(self, blob: bytes, aad: bytes | None = None) -> str:
        if not isinstance(blob, (bytes, bytearray)) or len(blob) <= NONCE_SIZE_BYTES + TAG_SIZE_BYTES:
            raise VaultDecryptError("Blob cifrado invalido o truncado.")
        raw = bytes(blob)
        nonce = raw[:NONCE_SIZE_BYTES]
        ciphertext = raw[NONCE_SIZE_BYTES:]
        try:
            plaintext = self._aesgcm.decrypt(nonce, ciphertext, aad)
        except InvalidTag as exc:
            raise VaultDecryptError("Fallo la autenticacion AES-256-GCM del token.") from exc
        return plaintext.decode("utf-8")

    def encrypt_session(
        self,
        tokens: dict[str, Any],
        user_id: str,
        provider: str = "garmin",
    ) -> bytes:
        normalized_provider = _validate_provider(provider)
        if not user_id or not user_id.strip():
            raise VaultError("user_id es obligatorio para asociar AAD.")
        aad = f"{user_id.strip()}:{normalized_provider}".encode("utf-8")
        serialized = json.dumps(tokens, separators=(",", ":"), sort_keys=True)
        return self.encrypt_token(serialized, aad=aad)

    def decrypt_session(
        self,
        blob: bytes,
        user_id: str,
        provider: str = "garmin",
    ) -> dict[str, Any]:
        normalized_provider = _validate_provider(provider)
        if not user_id or not user_id.strip():
            raise VaultError("user_id es obligatorio para validar AAD.")
        aad = f"{user_id.strip()}:{normalized_provider}".encode("utf-8")
        decoded = self.decrypt_token(blob, aad=aad)
        parsed = json.loads(decoded)
        if not isinstance(parsed, dict):
            raise VaultDecryptError("El payload descifrado de sesion no es un objeto JSON.")
        return parsed
