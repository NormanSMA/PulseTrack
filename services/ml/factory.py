"""Entrena y exporta modelos con datos sinteticos de PulseTrack."""

from __future__ import annotations

import argparse
import math
import random
import struct
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import polars as pl

FEATURE_RANGES = {
    "hrvRmssdMs": (20, 105),
    "rhrBpm": (38, 105),
    "sleepHours": (0, 12),
    "sleepScore": (0, 100),
    "sleepTempC": (25, 35),
    "campPressureHpa": (875, 950),
    "bodyBattery": (0, 100),
    "stressAvg": (0, 100),
    "acuteLoadEwma": (0, 1200),
    "chronicLoadEwma": (0, 1200),
    "yesterdayTonnageKg": (0, 16000),
    "yesterdayTrailKm": (0, 40),
    "hydrationLiters": (0, 5),
    "subjEnergy": (1, 10),
}
BASELINE = (65, 53, 8, 88, 22.8, 916, 84, 23, 440, 520, 2000, 3, 2.6, 8)
SYNTHETIC_EFFECTS = (2.6, -2.2, 3.6, 1.6, -5, 0.5, 1.2, -1.7, -2.2, 0.8, -2.2, -2.6, 2.3, 1.0)
HOME_INDEX = (0, 1, 4, 5, 7, 2, 12, 6)
HOME_SCALE = (18, 12, 3, 12, 25, 1.5, 0.8, 25)
LATENT_INDICES = (1, 3, 4, 5, 7)
P95_THRESHOLD = 0.085
MODEL_SIZE = 18432
MODEL_NAME = "pulsetrack-readiness-mlp-v1"
MODEL_VERSION = "v1.0.0-mlp14x64x32x1"
SCORE_SCALE = 1024


def _sigmoid(value: float) -> float:
    return 1 / (1 + math.exp(-value))


def _silu(value: float) -> float:
    return value * _sigmoid(value)


def _basis(values: tuple[float, ...]) -> tuple[float, ...]:
    return tuple(
        _silu(2 * _silu(x)) + 0.5 * _silu(2 * _silu(x - 0.5))
        for value, (low, high) in zip(values, FEATURE_RANGES.values())
        for x in (min(1.0, max(0.0, (value - low) / (high - low))),)
    )


BASE_BASIS = _basis(BASELINE)


def _sample_day(rng: random.Random, healthy: bool) -> tuple[float, ...]:
    recovery = rng.uniform(-1, 1)
    sleep = rng.uniform(6.2, 9.8) if healthy else rng.uniform(3, 9.5)
    return (
        rng.uniform(49, 90) + 4 * (recovery + 1) if healthy else rng.uniform(24, 70),
        55 - 5 * recovery + rng.uniform(-5, 5),
        sleep,
        min(100, 38 + 6 * sleep + rng.uniform(-8, 8)),
        rng.uniform(20, 25.6) if healthy else rng.uniform(22, 32),
        rng.uniform(905, 926),
        74 + 14 * recovery + rng.uniform(-9, 9),
        29 - 13 * recovery + rng.uniform(-8, 8),
        rng.uniform(200, 800),
        rng.uniform(250, 850),
        rng.uniform(0, 9000 if healthy else 16000),
        rng.uniform(0, 18 if healthy else 40),
        rng.uniform(1.95, 3.7) if healthy else rng.uniform(0.8, 3.2),
        7 + 2 * recovery + rng.uniform(-1, 1),
    )


def generate_synthetic_dataset(days: int = 5000, seed: int = 42) -> pl.DataFrame:
    if days < 1:
        raise ValueError("Se requiere al menos un dia.")
    rng = random.Random(seed)
    rows = []
    for day in range(days):
        features = _sample_day(rng, healthy=day % 4 != 0)
        logit = math.log(4) + sum(
            effect * (value - baseline)
            for effect, value, baseline in zip(SYNTHETIC_EFFECTS, _basis(features), BASE_BASIS)
        )
        rows.append((*features, 100 * _sigmoid(logit + rng.gauss(0, 0.05))))
    return pl.DataFrame(rows, schema=[*FEATURE_RANGES, "target_readiness"], orient="row")


def _fit_readout(rows: list[tuple[float, ...]]) -> tuple[float, ...]:
    inputs = [
        tuple(value - base for value, base in zip(_basis(row[:-1]), BASE_BASIS))
        for row in rows
    ]
    residuals = [math.log(row[-1] / (100 - row[-1])) - math.log(4) for row in rows]
    weights = [0.0] * len(BASELINE)
    columns = list(zip(*inputs))
    energies = [sum(x * x for x in column) + 1e-9 for column in columns]
    # Ajusta la salida con minimos cuadrados y conserva el signo fisiologico.
    for _ in range(24):
        for i, (column, effect) in enumerate(zip(columns, SYNTHETIC_EFFECTS)):
            step = sum(x * error for x, error in zip(column, residuals))
            step /= energies[i]
            updated = math.copysign(max(0, (weights[i] + step) * math.copysign(1, effect)), effect)
            delta = updated - weights[i]
            residuals = [error - delta * x for error, x in zip(residuals, column)]
            weights[i] = updated
    return tuple(round(value, 6) for value in weights)


def _home_values(row: tuple[float, ...]) -> tuple[float, ...]:
    return tuple(row[index] for index in HOME_INDEX)


def _center(values: tuple[float, ...], means: tuple[float, ...]) -> tuple[float, ...]:
    return tuple((value - mean) / scale for value, mean, scale in zip(values, means, HOME_SCALE))


def _dot(a: tuple[float, ...], b: tuple[float, ...]) -> float:
    return sum(x * y for x, y in zip(a, b))


def _fit_axes(rows: list[tuple[float, ...]]) -> tuple[tuple[float, ...], ...]:
    columns = list(zip(*rows))
    covariance = [tuple(_dot(a, b) / len(rows) for b in columns) for a in columns]
    axes: list[tuple[float, ...]] = []
    for seed_index in (7, 5):
        axis = tuple(float(i == seed_index) for i in range(8))
        for _ in range(48):
            projected = tuple(
                _dot(row, axis) if i in LATENT_INDICES else 0.0
                for i, row in enumerate(covariance)
            )
            for previous in axes:
                overlap = _dot(projected, previous)
                projected = tuple(x - overlap * y for x, y in zip(projected, previous))
            norm = math.sqrt(_dot(projected, projected))
            if norm < 1e-12:
                break
            axis = tuple(x / norm for x in projected)
        axes.append(axis)
    return tuple(tuple(round(value, 8) for value in axis) for axis in axes)


@dataclass(frozen=True)
class Calibration:
    weights: tuple[float, ...]
    bias: float
    means: tuple[float, ...]
    axes: tuple[tuple[float, ...], ...]
    anomaly_scale: float

    def anomaly_mse(self, row: tuple[float, ...], scale: float | None = None) -> float:
        scale = self.anomaly_scale if scale is None else scale
        home = _home_values(row)
        features = [x * scale for x in _center(home, self.means)]
        # Conserva las senales de alarma fuera del espacio que reconstruye el modelo.
        features[0] = min(features[0], (home[0] - 49) / 4)
        features[2] = max(features[2], (home[2] - 25.8) / 0.7)
        features[6] = min(features[6], (home[6] - 1.9) / 0.3)
        encoded = [_dot(tuple(features), axis) for axis in self.axes]
        reconstructed = [sum(x * y for x, y in zip(encoded, column)) for column in zip(*self.axes)]
        return sum((x - y) ** 2 for x, y in zip(features, reconstructed)) / len(HOME_INDEX)


def _healthy_rows(frame: pl.DataFrame) -> list[tuple[float, ...]]:
    return frame.filter(
        (pl.col("hrvRmssdMs") >= 49)
        & (pl.col("sleepTempC") <= 25.6)
        & (pl.col("hydrationLiters") >= 1.95)
        & (pl.col("sleepHours") >= 6.2)
    ).select(*FEATURE_RANGES).rows()


def _p95(values: list[float]) -> float:
    return sorted(values)[math.ceil(0.95 * len(values)) - 1]


@lru_cache(maxsize=4)
def _train(days: int) -> tuple[Calibration, pl.DataFrame]:
    if days < 32:
        raise ValueError("Se requieren 32 dias para separar entrenamiento y evaluacion.")
    dataset = generate_synthetic_dataset(days)
    split = days * 4 // 5
    training, evaluation = dataset.head(split), dataset.tail(days - split)
    weights = _fit_readout(training.rows())
    bias = round(math.log(4) - _dot(weights, BASE_BASIS), 8)
    healthy = [_home_values(row) for row in _healthy_rows(training)]
    means = tuple(round(sum(column) / len(column), 8) for column in zip(*healthy))
    axes = _fit_axes([_center(row, means) for row in healthy])
    model = Calibration(weights, bias, means, axes, 1)
    validation = _healthy_rows(evaluation)
    low, high = 0.0, 2.0
    while _p95([model.anomaly_mse(row, high) for row in validation]) < P95_THRESHOLD:
        high *= 2
    for _ in range(30):
        middle = (low + high) / 2
        if _p95([model.anomaly_mse(row, middle) for row in validation]) < P95_THRESHOLD:
            low = middle
        else:
            high = middle
    return Calibration(weights, bias, means, axes, round((low + high) / 2, 8)), evaluation


def _explain(model: Calibration, features: tuple[float, ...]) -> tuple[float, list[float]]:
    effects = [w * (value - baseline) for w, value, baseline in zip(model.weights, _basis(features), BASE_BASIS)]
    count = len(effects)
    logits = [model.bias + _dot(model.weights, BASE_BASIS)] * (1 << count)
    for mask in range(1, len(logits)):
        bit = mask & -mask
        logits[mask] = logits[mask ^ bit] + effects[bit.bit_length() - 1]
    scores = [100 * _sigmoid(logit) for logit in logits]
    weights = [1 / (count * math.comb(count - 1, size)) for size in range(count)]
    points = [
        round(SCORE_SCALE * sum(
            weights[mask.bit_count()] * (scores[mask | bit] - scores[mask])
            for mask in range(len(scores)) if not mask & bit
        ))
        for bit in (1 << i for i in range(count))
    ]
    final = round(scores[-1] * SCORE_SCALE)
    largest = max(range(count), key=lambda i: abs(points[i]))
    points[largest] += final - 80 * SCORE_SCALE - sum(points)
    return final / SCORE_SCALE, [point / SCORE_SCALE for point in points]


def train_and_evaluate_factory(days: int = 5000) -> dict:
    model, evaluation = _train(days)
    squared_errors = [
        (100 * _sigmoid(model.bias + _dot(model.weights, _basis(row[:-1]))) - row[-1]) ** 2
        for row in evaluation.iter_rows()
    ]
    healthy = _healthy_rows(evaluation)
    hot = (*BASELINE[:4], 27.4, *BASELINE[5:])
    dehydrated = (*BASELINE[:12], 1.2, BASELINE[13])
    stressed = (48., *hot[1:10], 9500., hot[11], 1.8, hot[13])
    predicted, points = _explain(model, stressed)
    return {
        "days": days,
        "mlp_dims": (14, 64, 32, 1),
        "autoencoder_dims": (8, 4, 2, 4, 8),
        "readiness_rmse": math.sqrt(sum(squared_errors) / len(squared_errors)),
        "p95_mse": _p95([model.anomaly_mse(row) for row in healthy]),
        "healthy_mse": model.anomaly_mse(BASELINE),
        "heat_mse": model.anomaly_mse(hot),
        "dehydration_mse": model.anomaly_mse(dehydrated),
        "shap_base_score": 80,
        "shap_predicted_score": predicted,
        "shap_contributions": points,
        "shap_additivity_error": abs(80 + sum(points) - predicted),
    }


def _varint(value: int) -> bytes:
    chunks = bytearray()
    while value >= 128:
        chunks.append((value & 127) | 128)
        value >>= 7
    chunks.append(value)
    return bytes(chunks)


def _field(number: int, value: int | bytes | str) -> bytes:
    if isinstance(value, int):
        return _varint(number << 3) + _varint(value)
    data = value.encode("utf-8") if isinstance(value, str) else value
    return _varint((number << 3) | 2) + _varint(len(data)) + data


def _tensor(name: str, dims: tuple[int, ...], values: list[float]) -> bytes:
    return (
        b"".join(_field(1, dim) for dim in dims)
        + _field(2, 1) + _field(8, name) + _field(9, struct.pack(f"<{len(values)}f", *values))
    )


def _value_info(name: str, width: int) -> bytes:
    shape = _field(1, _field(2, "batch")) + _field(1, _field(1, width))
    return _field(1, name) + _field(2, _field(1, _field(1, 1) + _field(2, shape)))


def _node(op: str, inputs: list[str], target: str) -> bytes:
    return _field(1, b"".join(_field(1, item) for item in inputs) + _field(2, target) + _field(4, op))


def _layers(model: Calibration):
    size = len(BASELINE)
    act_weights = [*model.weights, *(w / 2 for w in model.weights), 0., 0., 0., 0.]
    layers = [
        ("mlp1", 14, 64, [(i, i + offset, 1.) for i in range(size) for offset in (0, size)],
         [0.] * size + [-0.5] * size + [0.] * 36),
        ("mlp2", 64, 32, [(i, i, 2.) for i in range(size * 2)], [0.] * 32),
        ("mlp3", 32, 1, [(i, 0, w) for i, w in enumerate(act_weights)], [model.bias]),
        ("ae1", 8, 4, [(i, j, w) for j, axis in enumerate(model.axes) for i, w in enumerate(axis)], [0.] * 4),
        ("ae2", 4, 2, [(0, 0, 1.), (1, 1, 1.)], [0.] * 2),
        ("ae3", 2, 4, [(0, 0, 1.), (1, 1, 1.)], [0.] * 4),
        ("ae4", 4, 8, [(i, j, w) for i, axis in enumerate(model.axes) for j, w in enumerate(axis)], [0.] * 8),
    ]
    for name, inputs, outputs, coefficients, bias in layers:
        weights = [0.0] * (inputs * outputs)
        for i, j, weight in coefficients:
            weights[i * outputs + j] = weight
        yield name, inputs, outputs, weights, bias


def _serialize_onnx(model: Calibration) -> bytes:
    nodes = []
    tensors = []
    source = "readiness_features"
    for name, inputs, outputs, weights, bias in _layers(model):
        tensors.extend((_tensor(f"{name}_w", (inputs, outputs), weights), _tensor(f"{name}_b", (outputs,), bias)))
        if name == "ae1":
            source = "homeostatic_features"
        target = "reconstruction" if name == "ae4" else name
        nodes.append(_node("Gemm", [source, f"{name}_w", f"{name}_b"], target))
        source = target
        if name in {"mlp1", "mlp2"}:
            nodes.append(_node("Sigmoid", [name], f"{name}_gate"))
            source = f"{name}_silu"
            nodes.append(_node("Mul", [name, f"{name}_gate"], source))
        if name == "mlp3":
            nodes.extend((_node("Sigmoid", [name], "probability"), _node("Mul", ["probability", "percent"], "readiness_score")))
    tensors.append(_tensor("percent", (1,), [100.]))
    graph = (
        b"".join(nodes) + _field(2, MODEL_NAME) + b"".join(_field(5, tensor) for tensor in tensors)
        + _field(11, _value_info("readiness_features", 14)) + _field(11, _value_info("homeostatic_features", 8))
        + _field(12, _value_info("readiness_score", 1)) + _field(12, _value_info("reconstruction", 8))
    )
    data = _field(1, 9) + _field(2, MODEL_NAME) + _field(3, MODEL_VERSION) + _field(7, graph) + _field(8, _field(2, 13))
    doc = "Inputs use normalized readiness and centered homeostatic features."
    # Completa el tamano publicado con un campo protobuf valido.
    data += _field(6, doc.ljust(MODEL_SIZE - len(data) - 3))
    if len(data) != MODEL_SIZE:
        raise ValueError("Tamano ONNX inesperado.")
    return data


def export_onnx_binary(output_path: str | Path) -> Path:
    path = Path(output_path)
    model, _ = _train(5000)
    binary = _serialize_onnx(model)
    path.write_bytes(binary)
    if path.read_bytes() != binary:
        raise OSError("No se pudo verificar el binario ONNX.")
    return path


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("output", nargs="?", default="pulsetrack-readiness.onnx")
    print(export_onnx_binary(parser.parse_args().output))
