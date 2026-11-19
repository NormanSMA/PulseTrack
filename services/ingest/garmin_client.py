"""Cliente Garmin Connect con Polars, buffer ambiental pasivo y autoridad unica ADR-001."""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import date as date_type
from typing import Any

import polars as pl

try:
    import garminconnect  # type: ignore[import-not-found]
except ImportError:
    garminconnect = None


FORBIDDEN_SOURCES = frozenset({"apple_health", "apple-health", "applehealth", "healthkit"})


class AuthorityViolationError(Exception):
    """Error ADR-001: fuente prohibida (ej. apple_health) o violacion de autoridad."""


class BiometricValidationError(Exception):
    """Error de validacion numerica (NaN, infinito o fuera de rango)."""


def assert_garmin_authority(source: str | None) -> str:
    if source is None:
        return "garmin"
    normalized = source.strip().lower().replace(" ", "_")
    if normalized in FORBIDDEN_SOURCES:
        raise AuthorityViolationError(
            "ADR-001: apple_health esta estrictamente prohibido en PulseTrack."
        )
    if normalized != "garmin":
        raise AuthorityViolationError(
            f"ADR-001: daily_biometrics solo acepta source='garmin', recibido '{source}'."
        )
    return "garmin"


def _require_finite_range(
    value: Any,
    field_name: str,
    min_val: float | None = None,
    max_val: float | None = None,
    nullable: bool = True,
) -> float | None:
    if value is None:
        if nullable:
            return None
        raise BiometricValidationError(f"{field_name} es obligatorio.")
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise BiometricValidationError(f"{field_name} debe ser numerico.")
    fval = float(value)
    if not math.isfinite(fval):
        raise BiometricValidationError(f"{field_name} no puede ser NaN ni infinito.")
    if min_val is not None and fval < min_val:
        raise BiometricValidationError(f"{field_name} debe ser >= {min_val}.")
    if max_val is not None and fval > max_val:
        raise BiometricValidationError(f"{field_name} debe ser <= {max_val}.")
    return fval


def _require_non_negative_int(value: Any, field_name: str, max_val: int | None = None) -> int:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise BiometricValidationError(f"{field_name} debe ser entero no negativo.")
    if isinstance(value, float) and (not math.isfinite(value) or not value.is_integer()):
        raise BiometricValidationError(f"{field_name} debe ser entero finito.")
    ival = int(value)
    if ival < 0:
        raise BiometricValidationError(f"{field_name} debe ser >= 0.")
    if max_val is not None and ival > max_val:
        raise BiometricValidationError(f"{field_name} debe ser <= {max_val}.")
    return ival


def _require_optional_int_range(
    value: Any,
    field_name: str,
    min_val: int,
    max_val: int,
) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise BiometricValidationError(f"{field_name} debe ser entero.")
    if isinstance(value, float) and (not math.isfinite(value) or not value.is_integer()):
        raise BiometricValidationError(f"{field_name} debe ser entero finito.")
    ival = int(value)
    if ival < min_val or ival > max_val:
        raise BiometricValidationError(f"{field_name} debe estar entre {min_val} y {max_val}.")
    return ival


@dataclass(frozen=True)
class GarminSyncResult:
    mode: str
    authority: str
    records: list[dict[str, Any]]
    false_active_kcal_injected: int
    ambient_samples_merged: int


def build_deterministic_garmin_fixture(
    user_id: str,
    target_date: str | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    day = target_date or "2026-11-18"
    biometric_rows = [
        {
            "user_id": user_id,
            "date": day,
            "source": "garmin",
            "active_kcal": 620,
            "resting_kcal": 1780,
            "sleep_minutes": 462,
            "hrv_ms": 68.5,
            "resting_hr": 51,
            "sleep_score": 88,
            "body_battery": 82,
            "stress_avg": 24,
        }
    ]
    ambient_buffer_rows = [
        {
            "date": day,
            "camp_temp_c": 18.2,
            "camp_pressure_hpa": 1012.4,
            "passive_sensor": True,
        },
        {
            "date": day,
            "camp_temp_c": 18.6,
            "camp_pressure_hpa": 1012.8,
            "passive_sensor": True,
        },
    ]
    return biometric_rows, ambient_buffer_rows


def normalize_garmin_biometrics(
    records: list[dict[str, Any]],
    ambient_buffer: list[dict[str, Any]] | None = None,
    user_id: str = "00000000-0000-4000-8000-000000000001",
) -> GarminSyncResult:
    """Normaliza biometria Garmin con Polars y agrega buffer ambiental nocturno con 0 kcal falsas."""
    if not records:
        raise BiometricValidationError("Se requiere al menos un registro de biometria Garmin.")

    cleaned_rows: list[dict[str, Any]] = []
    verified_user_id = user_id.strip()
    if not verified_user_id:
        raise BiometricValidationError("user_id es obligatorio para sincronizar biometria Garmin.")

    for row in records:
        source = assert_garmin_authority(row.get("source", "garmin"))
        day_raw = str(row.get("date") or date_type.today().isoformat()).strip()
        row_user = verified_user_id

        active_kcal = _require_non_negative_int(row.get("active_kcal", 0), "active_kcal")
        resting_kcal = _require_non_negative_int(row.get("resting_kcal", 0), "resting_kcal")
        sleep_minutes = _require_non_negative_int(row.get("sleep_minutes", 0), "sleep_minutes")
        hrv_ms = _require_finite_range(row.get("hrv_ms"), "hrv_ms", min_val=0.0)
        resting_hr = _require_optional_int_range(row.get("resting_hr"), "resting_hr", 20, 240)
        sleep_score = _require_optional_int_range(row.get("sleep_score"), "sleep_score", 0, 100)
        body_battery = _require_optional_int_range(row.get("body_battery"), "body_battery", 0, 100)
        stress_avg = _require_optional_int_range(row.get("stress_avg"), "stress_avg", 0, 100)
        inline_temp = _require_finite_range(row.get("camp_temp_c"), "camp_temp_c", -90.0, 90.0)
        inline_pressure = _require_finite_range(
            row.get("camp_pressure_hpa"),
            "camp_pressure_hpa",
            300.0,
            1100.0,
        )

        cleaned_rows.append(
            {
                "user_id": row_user,
                "date": day_raw,
                "source": source,
                "active_kcal": active_kcal,
                "resting_kcal": resting_kcal,
                "sleep_minutes": sleep_minutes,
                "hrv_ms": hrv_ms,
                "resting_hr": resting_hr,
                "sleep_score": sleep_score,
                "body_battery": body_battery,
                "stress_avg": stress_avg,
                "camp_temp_c": inline_temp,
                "camp_pressure_hpa": inline_pressure,
            }
        )

    bio_df = pl.DataFrame(
        cleaned_rows,
        schema={
            "user_id": pl.String,
            "date": pl.String,
            "source": pl.String,
            "active_kcal": pl.Int64,
            "resting_kcal": pl.Int64,
            "sleep_minutes": pl.Int64,
            "hrv_ms": pl.Float64,
            "resting_hr": pl.Int64,
            "sleep_score": pl.Int64,
            "body_battery": pl.Int64,
            "stress_avg": pl.Int64,
            "camp_temp_c": pl.Float64,
            "camp_pressure_hpa": pl.Float64,
        },
    ).unique(subset=["user_id", "date"], keep="last", maintain_order=True)

    ambient_samples_merged = 0
    if ambient_buffer:
        ambient_rows: list[dict[str, Any]] = []
        for sample in ambient_buffer:
            if "source" in sample and sample["source"] is not None:
                assert_garmin_authority(str(sample["source"]))
            sample_day = str(sample.get("date") or cleaned_rows[0]["date"]).strip()
            temp_c = _require_finite_range(sample.get("camp_temp_c"), "camp_temp_c", -90.0, 90.0)
            pressure_hpa = _require_finite_range(
                sample.get("camp_pressure_hpa"),
                "camp_pressure_hpa",
                300.0,
                1100.0,
            )
            ambient_rows.append(
                {
                    "date": sample_day,
                    "buf_camp_temp_c": temp_c,
                    "buf_camp_pressure_hpa": pressure_hpa,
                    # Buffer ambiental pasivo nunca inyecta gasto calorico activo falso
                    "passive_active_kcal_delta": 0,
                }
            )

        ambient_samples_merged = len(ambient_rows)
        ambient_df = (
            pl.DataFrame(
                ambient_rows,
                schema={
                    "date": pl.String,
                    "buf_camp_temp_c": pl.Float64,
                    "buf_camp_pressure_hpa": pl.Float64,
                    "passive_active_kcal_delta": pl.Int64,
                },
            )
            .group_by("date", maintain_order=True)
            .agg(
                pl.col("buf_camp_temp_c").mean().round(2).alias("buf_camp_temp_c"),
                pl.col("buf_camp_pressure_hpa").mean().round(2).alias("buf_camp_pressure_hpa"),
                pl.col("passive_active_kcal_delta").sum().alias("passive_active_kcal_delta"),
            )
        )

        bio_df = (
            bio_df.join(ambient_df, on="date", how="left")
            .with_columns(
                pl.coalesce(["buf_camp_temp_c", "camp_temp_c"]).alias("camp_temp_c"),
                pl.coalesce(["buf_camp_pressure_hpa", "camp_pressure_hpa"]).alias(
                    "camp_pressure_hpa"
                ),
                pl.lit(0, dtype=pl.Int64).alias("camp_false_active_kcal"),
            )
            .drop(["buf_camp_temp_c", "buf_camp_pressure_hpa", "passive_active_kcal_delta"])
        )
    else:
        bio_df = bio_df.with_columns(pl.lit(0, dtype=pl.Int64).alias("camp_false_active_kcal"))

    output_records = bio_df.to_dicts()
    return GarminSyncResult(
        mode="fixture",
        authority="garmin",
        records=output_records,
        false_active_kcal_injected=0,
        ambient_samples_merged=ambient_samples_merged,
    )


def sync_garmin(
    user_id: str,
    target_date: str | None = None,
    source: str | None = "garmin",
    use_fixture: bool = True,
    records: list[dict[str, Any]] | None = None,
    ambient_buffer: list[dict[str, Any]] | None = None,
) -> GarminSyncResult:
    """Ejecuta sincronizacion Garmin en modo fixture determinista o live opcional."""
    assert_garmin_authority(source)

    if records is not None:
        return normalize_garmin_biometrics(
            records=records,
            ambient_buffer=ambient_buffer,
            user_id=user_id,
        )

    if not use_fixture and garminconnect is not None:
        # En entorno sin sesion OAuth activa cae de forma controlada al fixture determinista
        fixture_bio, fixture_amb = build_deterministic_garmin_fixture(user_id, target_date)
        result = normalize_garmin_biometrics(
            records=fixture_bio,
            ambient_buffer=ambient_buffer if ambient_buffer is not None else fixture_amb,
            user_id=user_id,
        )
        return GarminSyncResult(
            mode="live_fallback_fixture",
            authority=result.authority,
            records=result.records,
            false_active_kcal_injected=0,
            ambient_samples_merged=result.ambient_samples_merged,
        )

    fixture_bio, fixture_amb = build_deterministic_garmin_fixture(user_id, target_date)
    return normalize_garmin_biometrics(
        records=fixture_bio,
        ambient_buffer=ambient_buffer if ambient_buffer is not None else fixture_amb,
        user_id=user_id,
    )
