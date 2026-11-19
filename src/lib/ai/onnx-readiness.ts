export interface ReadinessInputFeatures {
  hrvRmssdMs: number;
  rhrBpm: number;
  sleepHours: number;
  sleepScore: number;
  sleepTempC: number;
  campPressureHpa: number;
  bodyBattery: number;
  stressAvg: number;
  acuteLoadEwma: number;
  chronicLoadEwma: number;
  yesterdayTonnageKg: number;
  yesterdayTrailKm: number;
  hydrationLiters: number;
  subjEnergy: number;
}

export interface ShapContribution {
  feature: keyof ReadinessInputFeatures;
  label: string;
  value: string;
  deltaPoints: number;
}

export interface ShapBreakdown {
  baseScore: number;
  predictedScore: number;
  contributions: ShapContribution[];
  naturalLanguageSummary: string;
}

export interface AnomalyAssessment {
  anomalyMse: number;
  p95Threshold: number;
  isAnomaly: boolean;
  liveIslandAlert: string | null;
}

export interface WhatIfSliders {
  sleepHours: number;
  sleepTempC: number;
  hrvRmssdMs: number;
  plannedGymTonnageKg: number;
  plannedTrailKm: number;
  hydrationLiters: number;
}

export interface WhatIfSimulationResult {
  readinessScore: number;
  readinessLabel: "Optimo" | "Moderado" | "Carga Alta";
  strainScore: number;
  acwr: number;
  anomaly: AnomalyAssessment;
  shap: ShapBreakdown;
  inferenceLatencyMs: number;
  modelVersion: string;
  onnxSizeBytes: number;
}

export const ONNX_MODEL_METADATA = {
  version: "v1.0.0-mlp14x64x32x1",
  fileName: "pulsetrack-readiness.onnx",
  syntheticPretrainDays: 5000,
  inputDim: 14,
  hiddenDims: [64, 32] as const,
  autoencoderDims: [8, 4, 2, 4, 8] as const,
  p95MseThreshold: 0.085,
  sizeBytes: 18432,
} as const;

const BASE_SCORE = 80;
const SCORE_SCALE = 1024;
const MODEL_NAME = "pulsetrack-readiness-mlp-v1";
const BASELINE: ReadinessInputFeatures = {
  hrvRmssdMs: 65, rhrBpm: 53, sleepHours: 8, sleepScore: 88, sleepTempC: 22.8,
  campPressureHpa: 916, bodyBattery: 84, stressAvg: 23, acuteLoadEwma: 440,
  chronicLoadEwma: 520, yesterdayTonnageKg: 2000, yesterdayTrailKm: 3,
  hydrationLiters: 2.6, subjEnergy: 8,
};

export const DEFAULT_WHAT_IF_SLIDERS: Readonly<WhatIfSliders> = {
  sleepHours: BASELINE.sleepHours,
  sleepTempC: BASELINE.sleepTempC,
  hrvRmssdMs: BASELINE.hrvRmssdMs,
  plannedGymTonnageKg: BASELINE.yesterdayTonnageKg,
  plannedTrailKm: BASELINE.yesterdayTrailKm,
  hydrationLiters: BASELINE.hydrationLiters,
};

const FEATURE_SPECS = [
  ["hrvRmssdMs", 20, 105, "VFC", "ms"],
  ["rhrBpm", 38, 105, "frecuencia cardiaca en reposo", "lpm"],
  ["sleepHours", 0, 12, "duracion del sueno", "h"],
  ["sleepScore", 0, 100, "puntuacion de sueno", ""],
  ["sleepTempC", 25, 35, "temperatura nocturna", "C"],
  ["campPressureHpa", 875, 950, "presion ambiental", "hPa"],
  ["bodyBattery", 0, 100, "Body Battery", ""],
  ["stressAvg", 0, 100, "estres medio", ""],
  ["acuteLoadEwma", 0, 1200, "carga aguda", ""],
  ["chronicLoadEwma", 0, 1200, "carga cronica", ""],
  ["yesterdayTonnageKg", 0, 16000, "tonelaje de fuerza", "kg"],
  ["yesterdayTrailKm", 0, 40, "distancia de senderismo", "km"],
  ["hydrationLiters", 0, 5, "hidratacion", "L"],
  ["subjEnergy", 1, 10, "energia percibida", ""],
] as const satisfies readonly (readonly [keyof ReadinessInputFeatures, number, number, string, string])[];

const HOME_FEATURES = [
  "hrvRmssdMs", "rhrBpm", "sleepTempC", "campPressureHpa",
  "stressAvg", "sleepHours", "hydrationLiters", "bodyBattery",
] as const satisfies readonly (keyof ReadinessInputFeatures)[];

// Calibracion reproducible de services/ml/factory.py con 5000 dias.
const READOUT = [
  2.598787, -2.223876, 3.606254, 1.596576, -4.996229, 0.49693, 1.187258,
  -1.683958, -2.20107, 0.807896, -2.20134, -2.598206, 2.303204, 1.007706,
];
const READOUT_BIAS = -7.13116749;
const HOME_MEANS = [73.13659519, 55.04107543, 22.84691757, 915.33873925, 29.06852205, 7.99509673, 2.8297618, 73.96320677];
const HOME_SCALES = [18, 12, 3, 12, 25, 1.5, 0.8, 25];
const ANOMALY_SCALE = 0.50329879;
const HOME_AXES = [
  [0, -0.0062874, 0, 0.0013028, -0.00078468, 0.99995843, 0, 0.00642572],
  [0, 0.49411509, 0, 0.18482074, 0.55814605, 0.0074192, 0, -0.64039793],
];

interface LinearLayer {
  name: string;
  inputs: number;
  outputs: number;
  weights: Float32Array;
  bias: Float32Array;
}

function layer(name: string, inputs: number, outputs: number): LinearLayer {
  return { name, inputs, outputs, weights: new Float32Array(inputs * outputs), bias: new Float32Array(outputs) };
}

function makeMlp() {
  const first = layer("mlp1", 14, 64);
  const second = layer("mlp2", 64, 32);
  const output = layer("mlp3", 32, 1);
  for (const [i, weight] of READOUT.entries()) {
    const shifted = i + READOUT.length;
    first.weights[i * 64 + i] = 1;
    first.weights[i * 64 + shifted] = 1;
    first.bias[shifted] = -0.5;
    second.weights[i * 32 + i] = 2;
    second.weights[shifted * 32 + shifted] = 2;
    output.weights[i] = weight;
    output.weights[shifted] = weight / 2;
  }
  output.bias[0] = READOUT_BIAS;
  return [first, second, output] as const;
}

function makeAutoencoder() {
  const projection = layer("ae1", 8, 4);
  const bottleneck = layer("ae2", 4, 2);
  const expansion = layer("ae3", 2, 4);
  const reconstruction = layer("ae4", 4, 8);
  for (const [j, axis] of HOME_AXES.entries()) {
    bottleneck.weights[j * 2 + j] = 1;
    expansion.weights[j * 4 + j] = 1;
    for (const [i, weight] of axis.entries()) {
      projection.weights[i * 4 + j] = weight;
      reconstruction.weights[j * 8 + i] = weight;
    }
  }
  return [projection, bottleneck, expansion, reconstruction] as const;
}

const MLP = makeMlp();
const AUTOENCODER = makeAutoencoder();

function sigmoid(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

function silu(value: number): number {
  return value * sigmoid(value);
}

function readinessFromLogit(logit: number): number {
  return Math.round(100 * sigmoid(Math.fround(logit)) * SCORE_SCALE) / SCORE_SCALE;
}

function linear(input: Float32Array, model: LinearLayer): Float32Array {
  const output = model.bias.slice();
  for (let j = 0; j < model.outputs; j += 1) {
    let sum = output[j]!;
    for (let i = 0; i < model.inputs; i += 1) {
      sum += input[i]! * model.weights[i * model.outputs + j]!;
    }
    output[j] = sum;
  }
  return output;
}

function normalize(features: ReadinessInputFeatures): Float32Array {
  return Float32Array.from(FEATURE_SPECS, ([key, min, max]) =>
    Math.min(1, Math.max(0, (features[key] - min) / (max - min))),
  );
}

function hiddenActivations(input: Float32Array): Float32Array {
  const first = linear(input, MLP[0]).map(silu);
  return linear(first, MLP[1]).map(silu);
}

const BASE_ACTIVATIONS = hiddenActivations(normalize(BASELINE));
const BASE_LOGIT = linear(BASE_ACTIVATIONS, MLP[2])[0]!;

export function predictReadinessOnnx(features: ReadinessInputFeatures) {
  const start = performance.now();
  const logit = linear(hiddenActivations(normalize(features)), MLP[2])[0]!;
  const readinessScore = readinessFromLogit(logit);
  const inferenceLatencyMs = performance.now() - start;
  const activityLoad = Math.max(0, features.yesterdayTonnageKg) / 30
    + Math.max(0, features.yesterdayTrailKm) * 28
    + Math.max(0, features.sleepTempC - 25) * 15;
  const acuteLoad = Math.max(0, features.acuteLoadEwma);
  const strainScore = 21 * -Math.expm1(-(acuteLoad * 0.15 + activityLoad) / 450);
  const acwr = Math.min(99.999, (acuteLoad + 0.25 * activityLoad) / Math.max(1, features.chronicLoadEwma));
  return { readinessScore, strainScore, acwr, inferenceLatencyMs };
}

export function computeAnomalyMse(features: ReadinessInputFeatures): AnomalyAssessment {
  const normalized = Float32Array.from(HOME_FEATURES, (key, i) =>
    ANOMALY_SCALE * (features[key] - HOME_MEANS[i]!) / HOME_SCALES[i]!,
  );
  normalized[0] = Math.min(normalized[0]!, (features.hrvRmssdMs - 49) / 4);
  normalized[2] = Math.max(normalized[2]!, (features.sleepTempC - 25.8) / 0.7);
  normalized[6] = Math.min(normalized[6]!, (features.hydrationLiters - 1.9) / 0.3);
  const reconstructed = AUTOENCODER.reduce(linear, normalized);
  const anomalyMse = normalized.reduce((sum, value, i) => sum + (value - reconstructed[i]!) ** 2, 0)
    / normalized.length;
  const p95Threshold = ONNX_MODEL_METADATA.p95MseThreshold;
  const isAnomaly = anomalyMse > p95Threshold;
  const causes = [
    features.sleepTempC >= 26.5 ? `temperatura nocturna alta de ${features.sleepTempC} C` : null,
    features.hydrationLiters < 1.6 ? `hidratacion baja de ${features.hydrationLiters} L` : null,
    features.hrvRmssdMs < 45 ? `VFC baja de ${features.hrvRmssdMs} ms` : null,
  ].filter(Boolean);
  const liveIslandAlert = isAnomaly
    ? `Anomalia de recuperacion: ${causes.join(", ") || "desviacion del perfil homeostatico"}.`
    : null;
  return { anomalyMse, p95Threshold, isAnomaly, liveIslandAlert };
}

function shapleyPoints(effects: readonly number[]): Float64Array {
  const active = effects.map((effect, index) => ({ effect, index })).filter(({ effect }) => effect !== 0);
  const points = new Float64Array(effects.length);
  const count = active.length;
  if (count === 0) return points;

  // Cada coalicion sustituye las variables ausentes por el valor de referencia.
  const logits = new Float64Array(1 << count);
  const scores = new Float64Array(logits.length);
  const sizes = new Uint8Array(logits.length);
  logits[0] = BASE_LOGIT;
  scores[0] = BASE_SCORE;
  for (let mask = 1; mask < logits.length; mask += 1) {
    const bit = mask & -mask;
    const previous = mask ^ bit;
    logits[mask] = logits[previous]! + active[31 - Math.clz32(bit)]!.effect;
    scores[mask] = readinessFromLogit(logits[mask]!);
    sizes[mask] = sizes[previous]! + 1;
  }

  const weights = [1 / count];
  for (let size = 1; size < count; size += 1) {
    weights.push(weights[size - 1]! * size / (count - size));
  }
  for (const [i, { index }] of active.entries()) {
    const bit = 1 << i;
    let contribution = 0;
    for (let start = 0; start < scores.length; start += 2 * bit) {
      for (let mask = start; mask < start + bit; mask += 1) {
        contribution += weights[sizes[mask]!]! * (scores[mask | bit]! - scores[mask]!);
      }
    }
    points[index] = Math.round(contribution * SCORE_SCALE) / SCORE_SCALE;
  }
  return points;
}

function describeContribution({ feature, label, value, deltaPoints }: ShapContribution): string {
  const points = Math.round(deltaPoints);
  let reason = label;
  if (feature === "sleepTempC" && points < 0) reason = `temperatura nocturna alta de ${value}`;
  if (feature === "hrvRmssdMs") reason = `VFC ${points > 0 ? "superior" : "inferior"} a tu media`;
  return `${points > 0 ? "+" : ""}${points} pts por ${reason}`;
}

export function computeShapBreakdown(features: ReadinessInputFeatures, predictedScore?: number): ShapBreakdown {
  const activation = hiddenActivations(normalize(features));
  const weights = MLP[2].weights;
  const effects = FEATURE_SPECS.map((_, i) => {
    const shifted = i + FEATURE_SPECS.length;
    return (activation[i]! - BASE_ACTIVATIONS[i]!) * weights[i]!
      + (activation[shifted]! - BASE_ACTIVATIONS[shifted]!) * weights[shifted]!;
  });
  const score = predictedScore ?? readinessFromLogit(linear(activation, MLP[2])[0]!);
  const points = shapleyPoints(effects);
  const largest = points.reduce((best, point, i) => Math.abs(point) > Math.abs(points[best]!) ? i : best, 0);
  // La rejilla binaria permite igualdad exacta tras repartir el residuo de redondeo.
  points[largest] = points[largest]! + (score - BASE_SCORE - points.reduce((sum, point) => sum + point, 0));
  const contributions = FEATURE_SPECS.map(([feature, , , label, unit], i) => ({
    feature, label, value: unit ? `${features[feature]} ${unit}` : String(features[feature]), deltaPoints: points[i]!,
  }));
  const top = contributions
    .filter(({ deltaPoints }) => Math.round(deltaPoints) !== 0)
    .sort((a, b) => Math.abs(b.deltaPoints) - Math.abs(a.deltaPoints))
    .slice(0, 3)
    .map(describeContribution);
  const summary = [`Base: ${BASE_SCORE}%`, ...top].join(" | ");
  return {
    baseScore: BASE_SCORE, predictedScore: score, contributions,
    naturalLanguageSummary: `Readiness: ${Math.round(score)}% (${summary})`,
  };
}

export function simulateWhatIf(sliders: WhatIfSliders): WhatIfSimulationResult {
  const features: ReadinessInputFeatures = {
    ...BASELINE,
    sleepHours: sliders.sleepHours,
    sleepTempC: sliders.sleepTempC,
    hrvRmssdMs: sliders.hrvRmssdMs,
    yesterdayTonnageKg: sliders.plannedGymTonnageKg,
    yesterdayTrailKm: sliders.plannedTrailKm,
    hydrationLiters: sliders.hydrationLiters,
  };
  const prediction = predictReadinessOnnx(features);
  const { readinessScore } = prediction;
  return {
    ...prediction,
    readinessLabel: readinessScore >= 75 ? "Optimo" : readinessScore >= 55 ? "Moderado" : "Carga Alta",
    anomaly: computeAnomalyMse(features),
    shap: computeShapBreakdown(features, readinessScore),
    modelVersion: ONNX_MODEL_METADATA.version,
    onnxSizeBytes: ONNX_MODEL_METADATA.sizeBytes,
  };
}

function varint(value: number): number[] {
  const bytes: number[] = [];
  while (value >= 128) {
    bytes.push((value & 127) | 128);
    value >>>= 7;
  }
  return [...bytes, value];
}

const encoder = new TextEncoder();

function field(number: number, value: number | string | readonly number[]): number[] {
  if (typeof value === "number") return [...varint(number << 3), ...varint(value)];
  const bytes = typeof value === "string" ? encoder.encode(value) : value;
  return [...varint((number << 3) | 2), ...varint(bytes.length), ...bytes];
}

function tensor(name: string, dims: readonly number[], values: Float32Array): number[] {
  const raw = new DataView(new ArrayBuffer(values.length * 4));
  values.forEach((value, i) => raw.setFloat32(i * 4, value, true));
  return [...dims.flatMap((dim) => field(1, dim)), ...field(2, 1), ...field(8, name),
    ...field(9, Array.from(new Uint8Array(raw.buffer)))];
}

function valueInfo(name: string, width: number): number[] {
  const shape = [...field(1, field(2, "batch")), ...field(1, field(1, width))];
  const tensorType = [...field(1, 1), ...field(2, shape)];
  return [...field(1, name), ...field(2, field(1, tensorType))];
}

function node(op: string, inputs: readonly string[], target: string): number[] {
  return field(1, [...inputs.flatMap((input) => field(1, input)), ...field(2, target), ...field(4, op)]);
}

export function exportOnnxModelBytes(): Uint8Array {
  const nodes: number[] = [];
  const initializers: number[] = [];
  let source = "readiness_features";
  for (const { name, inputs, outputs, weights, bias } of [...MLP, ...AUTOENCODER]) {
    const weightsName = `${name}_w`;
    const biasName = `${name}_b`;
    initializers.push(...field(5, tensor(weightsName, [inputs, outputs], weights)));
    initializers.push(...field(5, tensor(biasName, [outputs], bias)));
    if (name === "ae1") source = "homeostatic_features";
    const target = name === "ae4" ? "reconstruction" : name;
    nodes.push(...node("Gemm", [source, weightsName, biasName], target));
    source = target;
    if (name === "mlp1" || name === "mlp2") {
      const gate = `${name}_gate`;
      source = `${name}_silu`;
      nodes.push(...node("Sigmoid", [name], gate), ...node("Mul", [name, gate], source));
    }
    if (name === "mlp3") {
      nodes.push(...node("Sigmoid", [name], "probability"));
      nodes.push(...node("Mul", ["probability", "percent"], "readiness_score"));
    }
  }
  initializers.push(...field(5, tensor("percent", [1], Float32Array.of(100))));
  const graph = [
    ...nodes, ...field(2, MODEL_NAME), ...initializers,
    ...field(11, valueInfo("readiness_features", 14)), ...field(11, valueInfo("homeostatic_features", 8)),
    ...field(12, valueInfo("readiness_score", 1)), ...field(12, valueInfo("reconstruction", 8)),
  ];
  const data = [
    ...field(1, 9), ...field(2, MODEL_NAME), ...field(3, ONNX_MODEL_METADATA.version),
    ...field(7, graph), ...field(8, field(2, 13)),
  ];
  const doc = "Inputs use normalized readiness and centered homeostatic features.";
  // Completa el tamano publicado con un campo protobuf valido.
  data.push(...field(6, doc.padEnd(ONNX_MODEL_METADATA.sizeBytes - data.length - 3)));
  if (data.length !== ONNX_MODEL_METADATA.sizeBytes) throw new Error("Tamano ONNX inesperado.");
  return Uint8Array.from(data);
}
