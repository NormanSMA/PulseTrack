"""Microservicio FastAPI de ingesta biomedica PulseTrack (ADR-001)."""

from __future__ import annotations

import hmac
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException, Query
from pydantic import BaseModel, Field

from .config import load_settings
from .garmin_client import (
    AuthorityViolationError,
    BiometricValidationError,
    sync_garmin,
)
from .renpho_bridge import (
    bridge_renpho_records,
    build_deterministic_renpho_fixture,
)
from .weather_client import WeatherClient

DEFAULT_USER_ID = "00000000-0000-4000-8000-000000000001"

settings = load_settings()
weather_client = WeatherClient(
    base_url=settings.open_meteo_base_url,
    ttl_seconds=settings.weather_ttl_seconds,
)

app = FastAPI(
    title="PulseTrack Ingest Service",
    version="0.2.0",
)


def _verify_service_token(
    x_service_token: str | None = Header(default=None, alias="X-Service-Token"),
) -> None:
    runtime_settings = load_settings()
    expected = runtime_settings.service_secret
    if runtime_settings.mode == "live" and not expected:
        raise HTTPException(
            status_code=503,
            detail="PULSETRACK_SERVICE_SECRET es obligatorio cuando INGEST_MODE=live.",
        )
    if expected:
        provided = (x_service_token or "").strip()
        if not provided or not hmac.compare_digest(provided, expected):
            raise HTTPException(
                status_code=401,
                detail="Token de servicio X-Service-Token ausente o invalido.",
            )


class GarminSyncRequest(BaseModel):
    user_id: str = Field(default=DEFAULT_USER_ID, min_length=1)
    date: str | None = None
    source: str | None = "garmin"
    force: bool = False
    use_fixture: bool = True
    records: list[dict[str, Any]] | None = None
    ambient_buffer: list[dict[str, Any]] | None = None


class RenphoSyncRequest(BaseModel):
    user_id: str = Field(default=DEFAULT_USER_ID, min_length=1)
    source: str | None = "renpho"
    use_fixture: bool = True
    records: list[dict[str, Any]] | None = None


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "service": "pulsetrack-ingest",
        "authority": "adr-001",
        "mode": settings.mode,
    }


@app.post("/v1/sync/garmin", dependencies=[Depends(_verify_service_token)])
def post_sync_garmin(payload: GarminSyncRequest) -> dict[str, Any]:
    try:
        result = sync_garmin(
            user_id=payload.user_id,
            target_date=payload.date,
            source=payload.source,
            use_fixture=payload.use_fixture,
            records=payload.records,
            ambient_buffer=payload.ambient_buffer,
        )
    except AuthorityViolationError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except BiometricValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    return {
        "ok": True,
        "authority": result.authority,
        "mode": result.mode,
        "false_active_kcal_injected": result.false_active_kcal_injected,
        "ambient_samples_merged": result.ambient_samples_merged,
        "records": result.records,
    }


@app.post("/v1/sync/renpho", dependencies=[Depends(_verify_service_token)])
def post_sync_renpho(payload: RenphoSyncRequest) -> dict[str, Any]:
    if payload.source is not None:
        normalized = payload.source.strip().lower().replace(" ", "_")
        if normalized in {"apple_health", "apple-health", "applehealth", "healthkit"}:
            raise HTTPException(
                status_code=403,
                detail="ADR-001: apple_health esta prohibido en body_composition.",
            )

    raw_records = (
        payload.records
        if payload.records is not None
        else build_deterministic_renpho_fixture(payload.user_id)
    )
    try:
        result = bridge_renpho_records(
            records=raw_records,
            user_id=payload.user_id,
            inject_garmin_sync=True,
        )
    except AuthorityViolationError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc

    return {
        "ok": True,
        "authority": "renpho->garmin",
        "processed": result.processed,
        "duplicates_skipped": result.duplicates_skipped,
        "rejected": result.rejected,
        "rejected_reasons": result.rejected_reasons,
        "records": result.records,
    }


@app.get("/v1/weather")
def get_weather(
    lat: float = Query(default=settings.default_latitude),
    lon: float = Query(default=settings.default_longitude),
    force_refresh: bool = Query(default=False),
    use_fixture: bool = Query(default=False),
) -> dict[str, Any]:
    try:
        data = weather_client.get_weather(
            latitude=lat,
            longitude=lon,
            force_refresh=force_refresh,
            use_fixture=use_fixture,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {"ok": True, "weather": data}
