import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  computeAnomalyMse,
  computeShapBreakdown,
  DEFAULT_WHAT_IF_SLIDERS,
  exportOnnxModelBytes,
  ONNX_MODEL_METADATA,
  predictReadinessOnnx,
  simulateWhatIf,
  type ReadinessInputFeatures,
} from "./onnx-readiness";

const healthy: ReadinessInputFeatures = {
  hrvRmssdMs: 65, rhrBpm: 53, sleepHours: 8, sleepScore: 88, sleepTempC: 22.8,
  campPressureHpa: 916, bodyBattery: 84, stressAvg: 23, acuteLoadEwma: 440,
  chronicLoadEwma: 520, yesterdayTonnageKg: 2000, yesterdayTrailKm: 3,
  hydrationLiters: 2.6, subjEnergy: 8,
};

describe("Readiness ONNX", () => {
  it("conserva la referencia saludable de 80 puntos", () => {
    expect(predictReadinessOnnx(healthy).readinessScore).toBe(80);
  });

  it("ejecuta la inferencia con latencia p95 menor que 2 ms", () => {
    for (let i = 0; i < 30; i += 1) predictReadinessOnnx(healthy);
    const latencies = Array.from({ length: 100 }, (_, i) =>
      predictReadinessOnnx({ ...healthy, hrvRmssdMs: 45 + i / 2 }).inferenceLatencyMs,
    ).sort((a, b) => a - b);
    expect(latencies[94]).toBeLessThan(2);
  });

  it.each([
    ["hrvRmssdMs", 47, 76],
    ["sleepHours", 5, 9.5],
    ["hydrationLiters", 1.5, 3.5],
  ] as const)("sube Readiness cuando sube %s", (feature, low, high) => {
    const lower = predictReadinessOnnx({ ...healthy, [feature]: low });
    const higher = predictReadinessOnnx({ ...healthy, [feature]: high });
    expect(higher.readinessScore).toBeGreaterThan(lower.readinessScore);
  });

  it.each([
    ["sleepTempC", 27.4],
    ["yesterdayTonnageKg", 9800],
    ["yesterdayTrailKm", 22],
  ] as const)("reduce Readiness y sube Strain y ACWR con %s", (feature, value) => {
    const result = predictReadinessOnnx({ ...healthy, [feature]: value });
    const baseline = predictReadinessOnnx(healthy);
    expect(result.readinessScore).toBeLessThan(baseline.readinessScore);
    expect(result.strainScore).toBeGreaterThan(baseline.strainScore);
    expect(result.acwr).toBeGreaterThan(baseline.acwr);
  });

  it("conserva los limites SQL ante carga alta y carga cronica cero", () => {
    const result = predictReadinessOnnx({ ...healthy, chronicLoadEwma: 0, yesterdayTrailKm: 500 });
    expect(result.strainScore).toBeGreaterThan(0);
    expect(result.strainScore).toBeLessThanOrEqual(21);
    expect(result.acwr).toBeLessThanOrEqual(99.999);
    expect(result.readinessScore).toBeGreaterThanOrEqual(0);
    expect(result.readinessScore).toBeLessThanOrEqual(100);
  });

  it("reconstruye un dia saludable por debajo del p95", () => {
    const anomaly = computeAnomalyMse(healthy);
    expect(anomaly.anomalyMse).toBeLessThan(0.085);
    expect(anomaly).toMatchObject({ isAnomaly: false, liveIslandAlert: null, p95Threshold: 0.085 });
  });

  it.each([
    [{ sleepTempC: 26.5 }, "temperatura nocturna"],
    [{ hydrationLiters: 1.59 }, "hidratacion"],
    [{ hrvRmssdMs: 44.9 }, "VFC"],
  ] as const)("reporta la causa homeostatica %j", (change, cause) => {
    const anomaly = computeAnomalyMse({ ...healthy, ...change });
    expect(anomaly.anomalyMse).toBeGreaterThan(anomaly.p95Threshold);
    expect(anomaly.isAnomaly).toBe(true);
    expect(anomaly.liveIslandAlert).toContain(cause);
  });

  it("reparte 14 contribuciones SHAP con igualdad exacta", () => {
    const features = {
      hrvRmssdMs: 72, sleepHours: 7.3, sleepTempC: 27.4, yesterdayTonnageKg: 5500,
      rhrBpm: 60, sleepScore: 76, campPressureHpa: 913, bodyBattery: 61, stressAvg: 37,
      acuteLoadEwma: 650, chronicLoadEwma: 595, yesterdayTrailKm: 8, hydrationLiters: 1.7, subjEnergy: 5,
    };
    const score = predictReadinessOnnx(features).readinessScore;
    const shap = computeShapBreakdown(features, score);
    expect(shap.contributions).toHaveLength(14);
    expect(shap.contributions.every(({ deltaPoints }) => deltaPoints !== 0)).toBe(true);
    expect(shap.baseScore + shap.contributions.reduce((sum, item) => sum + item.deltaPoints, 0)).toBe(score);
  });

  it("atribuye el cambio completo a una sola variable activa", () => {
    const shap = computeShapBreakdown({ ...healthy, sleepTempC: 27.4 });
    const active = shap.contributions.filter(({ deltaPoints }) => deltaPoints !== 0);
    expect(active).toEqual([expect.objectContaining({
      feature: "sleepTempC", value: "27.4 C", deltaPoints: shap.predictedScore - 80,
    })]);
    expect(shap.naturalLanguageSummary).toMatch(/^Readiness: \d+% \(Base: 80% \| -\d+ pts por temperatura nocturna alta de 27\.4 C\)$/);
  });

  it("reparte la interaccion sigmoide entre dos variables", () => {
    const sleep = { sleepHours: 5 };
    const heat = { sleepTempC: 27.4 };
    const onlySleep = predictReadinessOnnx({ ...healthy, ...sleep }).readinessScore;
    const onlyHeat = predictReadinessOnnx({ ...healthy, ...heat }).readinessScore;
    const shap = computeShapBreakdown({ ...healthy, ...sleep, ...heat });
    const sleepPoints = shap.contributions.find(({ feature }) => feature === "sleepHours")?.deltaPoints;
    const shapley = ((onlySleep - 80) + (shap.predictedScore - onlyHeat)) / 2;
    expect(sleepPoints).toBeCloseTo(shapley, 2);
  });

  it("devuelve simulacion con etiqueta, SHAP, anomalia y metadatos", () => {
    const result = simulateWhatIf({ ...DEFAULT_WHAT_IF_SLIDERS, sleepTempC: 31, plannedTrailKm: 20 });
    expect(result.readinessLabel).toBe("Carga Alta");
    expect(result.anomaly.isAnomaly).toBe(true);
    expect(result.shap.predictedScore).toBe(result.readinessScore);
    expect(result.modelVersion).toBe(ONNX_MODEL_METADATA.version);
    expect(result.onnxSizeBytes).toBe(ONNX_MODEL_METADATA.sizeBytes);
  });

  it("exporta el mismo ModelProto IR 9 que la fabrica Python", () => {
    const data = exportOnnxModelBytes();
    expect(data.byteLength).toBeGreaterThan(1024);
    expect(data.byteLength).toBeLessThan(500 * 1024);
    expect(data.byteLength).toBe(ONNX_MODEL_METADATA.sizeBytes);
    expect([...data.slice(0, 2)]).toEqual([0x08, 0x09]);
    expect(new TextDecoder().decode(data)).toContain("pulsetrack-readiness-mlp-v1");
    expect(createHash("sha256").update(data).digest("hex")).toBe("0174fe4ef3ecc2c20acf2f7056d7f68ab1c0d2657b6bc031b56ad4d08cd7792a");
  });
});
