"""Cliente Open-Meteo con cache TTL de 60 minutos y fallback fixture determinista."""

from __future__ import annotations

import math
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable

import httpx

WEATHER_TTL_SECONDS = 60 * 60


@dataclass(frozen=True)
class _CacheEntry:
    fetched_monotonic: float
    payload: dict[str, Any]


def _is_finite_number(value: Any) -> bool:
    return not isinstance(value, bool) and isinstance(value, (int, float)) and math.isfinite(value)


def build_deterministic_weather_fixture(
    latitude: float,
    longitude: float,
    observed_at: str | None = None,
) -> dict[str, Any]:
    return {
        "latitude": round(latitude, 4),
        "longitude": round(longitude, 4),
        "weather_temp_c": 27.4,
        "weather_humidity_pct": 64.0,
        "pressure_hpa": 1012.6,
        "wind_speed_kmh": 11.2,
        "weather_code": 2,
        "condition": "Parcialmente nublado",
        "observed_at": observed_at or "2026-11-18T12:00:00Z",
    }


def _describe_wmo_code(code: int) -> str:
    if code == 0:
        return "Despejado"
    if code in {1, 2, 3}:
        return "Parcialmente nublado"
    if code in {45, 48}:
        return "Niebla"
    if code in {51, 53, 55, 61, 63, 65, 80, 81, 82}:
        return "Lluvia"
    if code in {95, 96, 99}:
        return "Tormenta"
    return "Condicion variable"


class WeatherClient:
    """Consulta Open-Meteo con cache en memoria de 60 min y fallback determinista."""

    def __init__(
        self,
        *,
        base_url: str = "https://api.open-meteo.com/v1/forecast",
        ttl_seconds: int = WEATHER_TTL_SECONDS,
        timeout_seconds: float = 4.0,
        clock: Callable[[], float] | None = None,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self._base_url = base_url
        self._ttl_seconds = ttl_seconds
        self._timeout_seconds = timeout_seconds
        self._clock = clock or time.monotonic
        self._transport = transport
        self._cache: dict[tuple[float, float], _CacheEntry] = {}

    def clear_cache(self) -> None:
        self._cache.clear()

    def get_weather(
        self,
        latitude: float = 12.1364,
        longitude: float = -86.2514,
        *,
        force_refresh: bool = False,
        use_fixture: bool = False,
    ) -> dict[str, Any]:
        if not _is_finite_number(latitude) or latitude < -90.0 or latitude > 90.0:
            raise ValueError("latitude debe estar entre -90 y 90.")
        if not _is_finite_number(longitude) or longitude < -180.0 or longitude > 180.0:
            raise ValueError("longitude debe estar entre -180 y 180.")

        cache_key = (round(latitude, 2), round(longitude, 2))
        now_mono = self._clock()

        if not force_refresh and not use_fixture:
            entry = self._cache.get(cache_key)
            if entry is not None:
                elapsed = now_mono - entry.fetched_monotonic
                if elapsed < self._ttl_seconds:
                    remaining = max(0, int(self._ttl_seconds - elapsed))
                    return {
                        **entry.payload,
                        "cached": True,
                        "remaining_ttl_seconds": remaining,
                    }

        fetched_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

        if use_fixture:
            fixture = build_deterministic_weather_fixture(latitude, longitude)
            return {
                **fixture,
                "source": "fixture",
                "cached": False,
                "fallback": True,
                "ttl_seconds": self._ttl_seconds,
                "remaining_ttl_seconds": self._ttl_seconds,
                "fetched_at": fetched_at,
            }

        try:
            params = {
                "latitude": latitude,
                "longitude": longitude,
                "current": "temperature_2m,relative_humidity_2m,surface_pressure,weather_code,wind_speed_10m",
                "timezone": "auto",
            }
            with httpx.Client(
                timeout=self._timeout_seconds,
                transport=self._transport,
            ) as client:
                response = client.get(self._base_url, params=params)
                response.raise_for_status()
                data = response.json()

            current = data.get("current") if isinstance(data, dict) else None
            if not isinstance(current, dict):
                raise ValueError("Respuesta Open-Meteo sin bloque current.")

            temp_c = current.get("temperature_2m")
            humidity = current.get("relative_humidity_2m")
            pressure = current.get("surface_pressure", 1013.25)
            wind = current.get("wind_speed_10m", 0.0)
            weather_code = int(current.get("weather_code", 0))

            if not (
                _is_finite_number(temp_c)
                and _is_finite_number(humidity)
                and 0.0 <= float(humidity) <= 100.0
                and _is_finite_number(pressure)
                and _is_finite_number(wind)
            ):
                raise ValueError("Valores numericos no finitos desde Open-Meteo.")

            payload = {
                "latitude": round(latitude, 4),
                "longitude": round(longitude, 4),
                "weather_temp_c": round(float(temp_c), 2),
                "weather_humidity_pct": round(float(humidity), 2),
                "pressure_hpa": round(float(pressure), 2),
                "wind_speed_kmh": round(float(wind), 2),
                "weather_code": weather_code,
                "condition": _describe_wmo_code(weather_code),
                "observed_at": str(current.get("time") or fetched_at),
                "source": "open-meteo",
                "cached": False,
                "fallback": False,
                "ttl_seconds": self._ttl_seconds,
                "remaining_ttl_seconds": self._ttl_seconds,
                "fetched_at": fetched_at,
            }
            self._cache[cache_key] = _CacheEntry(fetched_monotonic=now_mono, payload=payload)
            return payload
        except (httpx.HTTPError, ValueError, KeyError, TypeError):
            fixture = build_deterministic_weather_fixture(latitude, longitude)
            return {
                **fixture,
                "source": "fixture",
                "cached": False,
                "fallback": True,
                "ttl_seconds": self._ttl_seconds,
                "remaining_ttl_seconds": 0,
                "fetched_at": fetched_at,
            }
