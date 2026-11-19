"""Suite pytest determinista para el microservicio de ingesta PulseTrack."""

from __future__ import annotations

import base64
import json
import os
import sys
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from services.ingest import main as ingest_main
from services.ingest.garmin_client import (
    AuthorityViolationError,
    BiometricValidationError,
    normalize_garmin_biometrics,
)
from services.ingest.garth_vault import (
    GarthVault,
    VaultAuthorityError,
    VaultDecryptError,
    VaultKeyError,
)
from services.ingest.renpho_bridge import bridge_renpho_records
from services.ingest.weather_client import WEATHER_TTL_SECONDS, WeatherClient


def _generate_test_b64_key() -> str:
    return base64.urlsafe_b64encode(os.urandom(32)).decode("ascii")


def test_garth_vault_roundtrip_and_aad(monkeypatch: pytest.MonkeyPatch) -> None:
    key_b64 = _generate_test_b64_key()
    monkeypatch.setenv("PULSETRACK_VAULT_KEY", key_b64)

    vault = GarthVault.from_env()
    session_payload = {"oauth1_token": "tok-1", "oauth2_access": "tok-2", "expires_in": 3600}
    user_id = "11111111-1111-4111-8111-111111111111"

    encrypted = vault.encrypt_session(session_payload, user_id=user_id, provider="garmin")
    assert isinstance(encrypted, bytes)
    assert b"tok-1" not in encrypted

    decrypted = vault.decrypt_session(encrypted, user_id=user_id, provider="garmin")
    assert decrypted == session_payload

    # Alterar un byte debe fallar autenticacion GCM
    tampered = bytearray(encrypted)
    tampered[-1] ^= 0xFF
    with pytest.raises(VaultDecryptError):
        vault.decrypt_session(bytes(tampered), user_id=user_id, provider="garmin")

    # AAD distinto (otro usuario) debe fallar
    with pytest.raises(VaultDecryptError):
        vault.decrypt_session(
            encrypted,
            user_id="22222222-2222-4222-8222-222222222222",
            provider="garmin",
        )


def test_garth_vault_rejects_missing_key_and_apple_health(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("PULSETRACK_VAULT_KEY", raising=False)
    with pytest.raises(VaultKeyError):
        GarthVault.from_env()

    monkeypatch.setenv("PULSETRACK_VAULT_KEY", "short-invalid-key")
    with pytest.raises(VaultKeyError):
        GarthVault.from_env()

    vault = GarthVault(_generate_test_b64_key())
    with pytest.raises(VaultAuthorityError):
        vault.encrypt_session(
            {"token": "x"},
            user_id="11111111-1111-4111-8111-111111111111",
            provider="apple_health",
        )


def test_garmin_passive_camp_buffer_zero_false_kcal() -> None:
    bio_rows = [
        {
            "user_id": "u-1",
            "date": "2026-11-18",
            "source": "garmin",
            "active_kcal": 0,
            "resting_kcal": 1750,
            "sleep_minutes": 450,
            "hrv_ms": 71.2,
            "resting_hr": 50,
            "sleep_score": 90,
            "body_battery": 85,
            "stress_avg": 21,
        }
    ]
    ambient_rows = [
        {"date": "2026-11-18", "camp_temp_c": 16.0, "camp_pressure_hpa": 1010.0},
        {"date": "2026-11-18", "camp_temp_c": 17.0, "camp_pressure_hpa": 1012.0},
    ]

    result = normalize_garmin_biometrics(bio_rows, ambient_buffer=ambient_rows, user_id="u-1")
    assert result.false_active_kcal_injected == 0
    assert result.ambient_samples_merged == 2
    assert len(result.records) == 1
    row = result.records[0]
    assert row["active_kcal"] == 0
    assert row["camp_false_active_kcal"] == 0
    assert row["camp_temp_c"] == 16.5
    assert row["camp_pressure_hpa"] == 1011.0


def test_garmin_rejects_apple_health_and_nan() -> None:
    with pytest.raises(AuthorityViolationError):
        normalize_garmin_biometrics(
            [{"user_id": "u-1", "date": "2026-11-18", "source": "apple_health", "active_kcal": 300}]
        )

    with pytest.raises(BiometricValidationError):
        normalize_garmin_biometrics(
            [
                {
                    "user_id": "u-1",
                    "date": "2026-11-18",
                    "source": "garmin",
                    "active_kcal": 300,
                    "hrv_ms": float("nan"),
                }
            ]
        )


def test_renpho_bridge_dedup_validation_and_garmin_flag() -> None:
    records = [
        {
            "user_id": "u-1",
            "measured_at": "2026-11-18T06:30:00Z",
            "source": "renpho",
            "weight_kg": 76.2,
            "body_fat_pct": 14.9,
            "water_pct": 60.1,
            "visceral_fat": 6,
            "bmr_kcal": 1790,
        },
        # Duplicado exacto de clave compuesta -> sobrescribe / deduplica
        {
            "user_id": "u-1",
            "measured_at": "2026-11-18T06:30:00Z",
            "source": "renpho",
            "weight_kg": 76.4,
            "body_fat_pct": 14.8,
            "water_pct": 60.4,
            "visceral_fat": 6,
            "bmr_kcal": 1795,
        },
        # Peso invalido <= 0
        {
            "user_id": "u-1",
            "measured_at": "2026-11-18T06:31:00Z",
            "source": "renpho",
            "weight_kg": 0,
        },
        # Peso NaN
        {
            "user_id": "u-1",
            "measured_at": "2026-11-18T06:32:00Z",
            "source": "renpho",
            "weight_kg": float("nan"),
        },
    ]

    result = bridge_renpho_records(records, user_id="u-1", inject_garmin_sync=True)
    assert result.processed == 1
    assert result.duplicates_skipped == 1
    assert result.rejected == 2
    assert result.records[0]["weight_kg"] == 76.4
    assert result.records[0]["synced_to_garmin"] is True

    with pytest.raises(AuthorityViolationError):
        bridge_renpho_records(
            [
                {
                    "user_id": "u-1",
                    "measured_at": "2026-11-18T06:30:00Z",
                    "source": "apple_health",
                    "weight_kg": 76.0,
                }
            ]
        )


def test_weather_client_ttl_cache_and_fallback() -> None:
    calls = {"count": 0}
    now = {"t": 1000.0}

    def ok_handler(request: httpx.Request) -> httpx.Response:
        calls["count"] += 1
        return httpx.Response(
            200,
            json={
                "current": {
                    "time": "2026-11-18T12:00",
                    "temperature_2m": 28.5,
                    "relative_humidity_2m": 62.0,
                    "surface_pressure": 1011.4,
                    "weather_code": 1,
                    "wind_speed_10m": 9.8,
                }
            },
        )

    client = WeatherClient(
        ttl_seconds=WEATHER_TTL_SECONDS,
        clock=lambda: now["t"],
        transport=httpx.MockTransport(ok_handler),
    )

    first = client.get_weather(12.1364, -86.2514)
    assert first["source"] == "open-meteo"
    assert first["cached"] is False
    assert first["fallback"] is False
    assert first["weather_temp_c"] == 28.5
    assert calls["count"] == 1

    # Dentro de 60 min -> hit de cache sin llamada HTTP adicional
    now["t"] += 1200.0
    second = client.get_weather(12.1364, -86.2514)
    assert second["cached"] is True
    assert calls["count"] == 1

    # Pasados 60 min -> expira y vuelve a consultar
    now["t"] += WEATHER_TTL_SECONDS
    third = client.get_weather(12.1364, -86.2514)
    assert third["cached"] is False
    assert calls["count"] == 2

    # Error de red -> fallback fixture determinista
    def failing_handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("upstream down")

    fallback_client = WeatherClient(transport=httpx.MockTransport(failing_handler))
    fb = fallback_client.get_weather(12.1364, -86.2514)
    assert fb["source"] == "fixture"
    assert fb["fallback"] is True
    assert fb["weather_temp_c"] == 27.4


def test_fastapi_endpoints_end_to_end() -> None:
    client = TestClient(ingest_main.app)

    health_res = client.get("/health")
    assert health_res.status_code == 200
    assert health_res.json()["status"] == "ok"

    garmin_ok = client.post(
        "/v1/sync/garmin",
        json={"user_id": "u-1", "date": "2026-11-18", "source": "garmin", "use_fixture": True},
    )
    assert garmin_ok.status_code == 200
    garmin_body = garmin_ok.json()
    assert garmin_body["authority"] == "garmin"
    assert garmin_body["false_active_kcal_injected"] == 0
    assert garmin_body["records"][0]["camp_temp_c"] == 18.4

    garmin_forbidden = client.post(
        "/v1/sync/garmin",
        json={"user_id": "u-1", "source": "apple_health"},
    )
    assert garmin_forbidden.status_code == 403

    renpho_ok = client.post(
        "/v1/sync/renpho",
        json={"user_id": "u-1", "source": "renpho", "use_fixture": True},
    )
    assert renpho_ok.status_code == 200
    renpho_body = renpho_ok.json()
    assert renpho_body["processed"] == 1
    assert renpho_body["records"][0]["synced_to_garmin"] is True

    renpho_forbidden = client.post(
        "/v1/sync/renpho",
        json={"user_id": "u-1", "source": "apple_health"},
    )
    assert renpho_forbidden.status_code == 403

    weather_fixture = client.get("/v1/weather", params={"use_fixture": "true"})
    assert weather_fixture.status_code == 200
    weather_body = weather_fixture.json()
    assert weather_body["ok"] is True
    assert weather_body["weather"]["source"] == "fixture"
    assert json.loads(weather_fixture.text)["weather"]["weather_humidity_pct"] == 64.0


def test_service_token_enforcement_and_user_id_isolation(monkeypatch: pytest.MonkeyPatch) -> None:
    client = TestClient(ingest_main.app)

    # Modo live sin PULSETRACK_SERVICE_SECRET debe fallar cerrado (503)
    monkeypatch.setenv("INGEST_MODE", "live")
    monkeypatch.delenv("PULSETRACK_SERVICE_SECRET", raising=False)
    live_no_secret = client.post(
        "/v1/sync/garmin",
        json={"user_id": "auth-user", "source": "garmin", "use_fixture": True},
    )
    assert live_no_secret.status_code == 503

    # Con secreto definido, exige X-Service-Token valido
    monkeypatch.setenv("PULSETRACK_SERVICE_SECRET", "super-secret-ingest-key")
    unauth = client.post(
        "/v1/sync/garmin",
        json={"user_id": "auth-user", "source": "garmin", "use_fixture": True},
    )
    assert unauth.status_code == 401

    wrong_token = client.post(
        "/v1/sync/renpho",
        headers={"X-Service-Token": "wrong-token"},
        json={"user_id": "auth-user", "source": "renpho", "use_fixture": True},
    )
    assert wrong_token.status_code == 401

    # Con token valido, filas internas no pueden suplantar user_id
    ok_res = client.post(
        "/v1/sync/garmin",
        headers={"X-Service-Token": "super-secret-ingest-key"},
        json={
            "user_id": "auth-user",
            "source": "garmin",
            "use_fixture": False,
            "records": [
                {
                    "user_id": "attacker-id",
                    "date": "2026-11-18",
                    "source": "garmin",
                    "active_kcal": 500,
                    "resting_kcal": 1750,
                    "sleep_minutes": 440,
                }
            ],
        },
    )
    assert ok_res.status_code == 200
    assert ok_res.json()["records"][0]["user_id"] == "auth-user"
