"""Puente RENPHO -> Garmin con Polars, validacion estricta y deduplicacion (ADR-001)."""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

import polars as pl

from .garmin_client import AuthorityViolationError, FORBIDDEN_SOURCES

ALLOWED_BODY_SOURCES = frozenset({"renpho", "garmin"})


@dataclass(frozen=True)
class RenphoBridgeResult:
    processed: int
    duplicates_skipped: int
    rejected: int
    rejected_reasons: list[str]
    records: list[dict[str, Any]]


def _validate_body_source(source: Any) -> str:
    raw = "renpho" if source is None else str(source).strip().lower().replace(" ", "_")
    if raw in FORBIDDEN_SOURCES:
        raise AuthorityViolationError(
            "ADR-001: apple_health esta prohibido en body_composition."
        )
    if raw not in ALLOWED_BODY_SOURCES:
        raise AuthorityViolationError(
            f"Fuente '{source}' no permitida en body_composition. Permitidas: renpho, garmin."
        )
    return raw


def _parse_finite_float(
    value: Any,
    field_name: str,
    *,
    required: bool = False,
    min_val: float | None = None,
    exclusive_min: float | None = None,
    max_val: float | None = None,
) -> tuple[float | None, str | None]:
    if value is None:
        if required:
            return None, f"{field_name} es obligatorio"
        return None, None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None, f"{field_name} no es numerico"
    fval = float(value)
    if not math.isfinite(fval):
        return None, f"{field_name} es NaN o infinito"
    if exclusive_min is not None and fval <= exclusive_min:
        return None, f"{field_name} debe ser > {exclusive_min}"
    if min_val is not None and fval < min_val:
        return None, f"{field_name} debe ser >= {min_val}"
    if max_val is not None and fval > max_val:
        return None, f"{field_name} debe ser <= {max_val}"
    return round(fval, 2), None


def _parse_optional_int(
    value: Any,
    field_name: str,
    *,
    min_val: int | None = None,
    exclusive_min: int | None = None,
    max_val: int | None = None,
) -> tuple[int | None, str | None]:
    if value is None:
        return None, None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None, f"{field_name} no es entero"
    if isinstance(value, float) and (not math.isfinite(value) or not value.is_integer()):
        return None, f"{field_name} debe ser entero finito"
    ival = int(value)
    if exclusive_min is not None and ival <= exclusive_min:
        return None, f"{field_name} debe ser > {exclusive_min}"
    if min_val is not None and ival < min_val:
        return None, f"{field_name} debe ser >= {min_val}"
    if max_val is not None and ival > max_val:
        return None, f"{field_name} debe ser <= {max_val}"
    return ival, None


def build_deterministic_renpho_fixture(user_id: str) -> list[dict[str, Any]]:
    return [
        {
            "user_id": user_id,
            "measured_at": "2026-11-18T06:35:00Z",
            "source": "renpho",
            "weight_kg": 76.4,
            "body_fat_pct": 14.8,
            "muscle_mass_kg": 61.7,
            "water_pct": 60.4,
            "visceral_fat": 6,
            "bmr_kcal": 1795,
        }
    ]


def bridge_renpho_records(
    records: list[dict[str, Any]],
    user_id: str = "00000000-0000-4000-8000-000000000001",
    inject_garmin_sync: bool = True,
) -> RenphoBridgeResult:
    """Valida mediciones RENPHO con Polars, deduplica e inyecta synced_to_garmin = true."""
    valid_rows: list[dict[str, Any]] = []
    rejected_reasons: list[str] = []

    for idx, row in enumerate(records):
        source = _validate_body_source(row.get("source", "renpho"))
        measured_at = str(row.get("measured_at") or "").strip()
        if not measured_at:
            rejected_reasons.append(f"row[{idx}]: measured_at es obligatorio")
            continue

        weight_kg, err = _parse_finite_float(
            row.get("weight_kg"), "weight_kg", required=True, exclusive_min=0.0, max_val=500.0
        )
        if err:
            rejected_reasons.append(f"row[{idx}]: {err}")
            continue

        body_fat_pct, err = _parse_finite_float(
            row.get("body_fat_pct"), "body_fat_pct", min_val=0.0, max_val=100.0
        )
        if err:
            rejected_reasons.append(f"row[{idx}]: {err}")
            continue

        muscle_mass_kg, err = _parse_finite_float(
            row.get("muscle_mass_kg"), "muscle_mass_kg", min_val=0.0, max_val=300.0
        )
        if err:
            rejected_reasons.append(f"row[{idx}]: {err}")
            continue

        water_pct, err = _parse_finite_float(
            row.get("water_pct"), "water_pct", min_val=0.0, max_val=100.0
        )
        if err:
            rejected_reasons.append(f"row[{idx}]: {err}")
            continue

        visceral_fat, err = _parse_optional_int(
            row.get("visceral_fat"), "visceral_fat", min_val=0, max_val=60
        )
        if err:
            rejected_reasons.append(f"row[{idx}]: {err}")
            continue

        bmr_kcal, err = _parse_optional_int(
            row.get("bmr_kcal"), "bmr_kcal", exclusive_min=0, max_val=10000
        )
        if err:
            rejected_reasons.append(f"row[{idx}]: {err}")
            continue

        valid_rows.append(
            {
                "user_id": str(row.get("user_id") or user_id).strip(),
                "measured_at": measured_at,
                "source": source,
                "weight_kg": weight_kg,
                "body_fat_pct": body_fat_pct,
                "muscle_mass_kg": muscle_mass_kg,
                "water_pct": water_pct,
                "visceral_fat": visceral_fat,
                "bmr_kcal": bmr_kcal,
                "synced_to_garmin": bool(inject_garmin_sync),
            }
        )

    if not valid_rows:
        return RenphoBridgeResult(
            processed=0,
            duplicates_skipped=0,
            rejected=len(rejected_reasons),
            rejected_reasons=rejected_reasons,
            records=[],
        )

    df = pl.DataFrame(
        valid_rows,
        schema={
            "user_id": pl.String,
            "measured_at": pl.String,
            "source": pl.String,
            "weight_kg": pl.Float64,
            "body_fat_pct": pl.Float64,
            "muscle_mass_kg": pl.Float64,
            "water_pct": pl.Float64,
            "visceral_fat": pl.Int64,
            "bmr_kcal": pl.Int64,
            "synced_to_garmin": pl.Boolean,
        },
    )

    before_dedup = df.height
    deduped = df.unique(
        subset=["user_id", "measured_at", "source"],
        keep="last",
        maintain_order=True,
    )
    duplicates_skipped = before_dedup - deduped.height

    return RenphoBridgeResult(
        processed=deduped.height,
        duplicates_skipped=duplicates_skipped,
        rejected=len(rejected_reasons),
        rejected_reasons=rejected_reasons,
        records=deduped.to_dicts(),
    )
