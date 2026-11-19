from __future__ import annotations

import hashlib
import sys
from pathlib import Path
from tempfile import NamedTemporaryFile

import polars as pl
import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from services.ml.factory import FEATURE_RANGES, export_onnx_binary, generate_synthetic_dataset, train_and_evaluate_factory


@pytest.fixture(scope="module")
def metrics() -> dict:
    return train_and_evaluate_factory()


def test_synthetic_dataset_has_5000_days_and_fourteen_features():
    dataset = generate_synthetic_dataset(5000)
    assert dataset.shape == (5000, 15)
    assert dataset.columns == [*FEATURE_RANGES, "target_readiness"]
    assert dataset.dtypes == [pl.Float64] * 15
    assert dataset["target_readiness"].is_between(0, 100).all()


def test_synthetic_dataset_respects_seed():
    assert generate_synthetic_dataset(64).equals(generate_synthetic_dataset(64, seed=42))
    assert not generate_synthetic_dataset(64).equals(generate_synthetic_dataset(64, seed=43))


def test_mlp_fits_held_out_days(metrics):
    assert metrics["days"] == 5000
    assert metrics["mlp_dims"] == (14, 64, 32, 1)
    assert 0 < metrics["readiness_rmse"] < 2


def test_autoencoder_calibrates_healthy_percentile(metrics):
    assert metrics["autoencoder_dims"] == (8, 4, 2, 4, 8)
    assert metrics["p95_mse"] == pytest.approx(0.085, abs=1e-7)
    assert metrics["healthy_mse"] < metrics["p95_mse"]


def test_autoencoder_detects_heat_and_dehydration_separately(metrics):
    assert metrics["heat_mse"] > metrics["p95_mse"]
    assert metrics["dehydration_mse"] > metrics["p95_mse"]


def test_shap_is_additive_with_several_changed_features(metrics):
    points = metrics["shap_contributions"]
    assert len(points) == 14
    assert sum(value != 0 for value in points) == 4
    assert metrics["shap_base_score"] + sum(points) == metrics["shap_predicted_score"]
    assert metrics["shap_additivity_error"] == 0


def test_onnx_binary_matches_typescript_model():
    with NamedTemporaryFile(suffix=".onnx", delete_on_close=False) as temporary:
        target = Path(temporary.name)
        temporary.close()
        assert export_onnx_binary(str(target)) == target
        data = target.read_bytes()
    assert 1024 < len(data) == 18432 < 500 * 1024
    assert data[:2] == b"\x08\x09"
    assert b"pulsetrack-readiness-mlp-v1" in data
    assert b"readiness_score" in data and b"reconstruction" in data
    assert hashlib.sha256(data).hexdigest() == "0174fe4ef3ecc2c20acf2f7056d7f68ab1c0d2657b6bc031b56ad4d08cd7792a"
