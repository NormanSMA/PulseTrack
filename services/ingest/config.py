"""Configuracion por variables de entorno para el servicio de ingesta."""

from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class IngestSettings:
    mode: str
    vault_key_env: str | None
    weather_ttl_seconds: int
    open_meteo_base_url: str
    default_latitude: float
    default_longitude: float
    supabase_url: str | None
    supabase_service_role_key: str | None


def load_settings() -> IngestSettings:
    mode_raw = os.getenv("INGEST_MODE", "fixture").strip().lower()
    mode = "live" if mode_raw == "live" else "fixture"

    ttl_raw = os.getenv("WEATHER_TTL_SECONDS", "3600").strip()
    try:
        weather_ttl_seconds = max(60, int(ttl_raw))
    except ValueError:
        weather_ttl_seconds = 3600

    try:
        default_latitude = float(os.getenv("DEFAULT_WEATHER_LAT", "12.1364"))
    except ValueError:
        default_latitude = 12.1364

    try:
        default_longitude = float(os.getenv("DEFAULT_WEATHER_LON", "-86.2514"))
    except ValueError:
        default_longitude = -86.2514

    return IngestSettings(
        mode=mode,
        vault_key_env=os.getenv("PULSETRACK_VAULT_KEY"),
        weather_ttl_seconds=weather_ttl_seconds,
        open_meteo_base_url=os.getenv(
            "OPEN_METEO_BASE_URL",
            "https://api.open-meteo.com/v1/forecast",
        ),
        default_latitude=default_latitude,
        default_longitude=default_longitude,
        supabase_url=os.getenv("SUPABASE_URL"),
        supabase_service_role_key=os.getenv("SUPABASE_SERVICE_ROLE_KEY"),
    )
