import { describe, expect, it } from "vitest";
import {
  buildRenphoChartModel,
  computeSafeYDomain,
  formatRecentDelta,
  parseTimestampToUnixSeconds,
  renphoPointsToAlignedData,
  toAlignedSeries,
  type RenphoSeriesPoint,
} from "./uplot-series";

describe("parseTimestampToUnixSeconds", () => {
  it("convierte ISO strings, Date y timestamps en ms o segundos", () => {
    const expectedSec = Date.UTC(2026, 10, 18, 7, 30, 0) / 1000;

    expect(parseTimestampToUnixSeconds("2026-11-18T07:30:00Z")).toBe(expectedSec);
    expect(parseTimestampToUnixSeconds(new Date("2026-11-18T07:30:00Z"))).toBe(expectedSec);
    expect(parseTimestampToUnixSeconds(expectedSec * 1000)).toBe(expectedSec);
    expect(parseTimestampToUnixSeconds(expectedSec)).toBe(expectedSec);
  });

  it("retorna null para fechas o numeros invalidos", () => {
    expect(parseTimestampToUnixSeconds("")).toBeNull();
    expect(parseTimestampToUnixSeconds("fecha-invalida")).toBeNull();
    expect(parseTimestampToUnixSeconds(Number.NaN)).toBeNull();
    expect(parseTimestampToUnixSeconds(Number.POSITIVE_INFINITY)).toBeNull();
    expect(parseTimestampToUnixSeconds(new Date("invalid"))).toBeNull();
    expect(parseTimestampToUnixSeconds(null)).toBeNull();
  });
});

describe("toAlignedSeries", () => {
  it("filtra NaN/no finitos, ordena ascendente y deduplica marcas identicas", () => {
    const [xs, ys] = toAlignedSeries([
      { timestamp: "2026-11-18T07:00:00Z", value: 76.4 },
      { timestamp: "2026-11-16T07:00:00Z", value: Number.NaN },
      { timestamp: "2026-11-15T07:00:00Z", value: 77.1 },
      { timestamp: "2026-11-17T07:00:00Z", value: 76.9 },
      { timestamp: "2026-11-17T07:00:00Z", value: 76.7 },
      { timestamp: "2026-11-19T07:00:00Z", value: Number.POSITIVE_INFINITY },
      { timestamp: "invalida", value: 75.0 },
      { timestamp: "2026-11-14T07:00:00Z", value: null },
    ]);

    expect(xs).toEqual([
      Date.UTC(2026, 10, 15, 7, 0, 0) / 1000,
      Date.UTC(2026, 10, 17, 7, 0, 0) / 1000,
      Date.UTC(2026, 10, 18, 7, 0, 0) / 1000,
    ]);
    expect(ys).toEqual([77.1, 76.7, 76.4]);
  });
});

describe("renphoPointsToAlignedData", () => {
  it("extrae la metrica seleccionada y usa date si measuredAt es invalido", () => {
    const points: RenphoSeriesPoint[] = [
      {
        measuredAt: "2026-11-18T07:10:00Z",
        date: "2026-11-18",
        weightKg: 76.4,
        bodyFatPct: 13.8,
        muscleMassKg: 62.4,
        waterPct: 61.2,
      },
      {
        measuredAt: "",
        date: "2026-11-16",
        weightKg: 76.8,
        bodyFatPct: Number.NaN,
        muscleMassKg: 62.1,
        waterPct: 60.9,
      },
    ];

    const [xsWeight, ysWeight] = renphoPointsToAlignedData(points, "weightKg");
    expect(xsWeight).toEqual([
      Date.UTC(2026, 10, 16, 0, 0, 0) / 1000,
      Date.UTC(2026, 10, 18, 7, 10, 0) / 1000,
    ]);
    expect(ysWeight).toEqual([76.8, 76.4]);

    const [xsFat, ysFat] = renphoPointsToAlignedData(points, "bodyFatPct");
    expect(xsFat).toEqual([Date.UTC(2026, 10, 18, 7, 10, 0) / 1000]);
    expect(ysFat).toEqual([13.8]);
  });
});

describe("computeSafeYDomain", () => {
  it("retorna [0, 1] cuando no hay valores finitos", () => {
    expect(computeSafeYDomain([])).toEqual([0, 1]);
    expect(computeSafeYDomain([Number.NaN, Number.POSITIVE_INFINITY])).toEqual([0, 1]);
  });

  it("expande simetricamente cuando todos los puntos son iguales", () => {
    expect(computeSafeYDomain([76.4, 76.4])).toEqual([72.58, 80.22]);
    expect(computeSafeYDomain([0, 0])).toEqual([-0.5, 0.5]);
  });

  it("calcula padding proporcional para rangos positivos", () => {
    expect(computeSafeYDomain([70, 80], 0.1)).toEqual([69, 81]);
  });
});

describe("formatRecentDelta", () => {
  it("formatea delta positivo, negativo, plano y vacio", () => {
    expect(formatRecentDelta([76.0, 76.4], "kg", 1)).toEqual({
      latest: 76.4,
      previous: 76.0,
      delta: 0.4,
      formattedLatest: "76.4 kg",
      formattedDelta: "+0.4 kg",
      trend: "up",
    });

    expect(formatRecentDelta([14.2, 13.8], "%", 1)).toEqual({
      latest: 13.8,
      previous: 14.2,
      delta: -0.4,
      formattedLatest: "13.8 %",
      formattedDelta: "-0.4 %",
      trend: "down",
    });

    expect(formatRecentDelta([62.4, 62.42], "kg", 1)).toEqual({
      latest: 62.42,
      previous: 62.4,
      delta: 0.02,
      formattedLatest: "62.4 kg",
      formattedDelta: "0.0 kg",
      trend: "flat",
    });

    expect(formatRecentDelta([61.2], "%", 1)).toEqual({
      latest: 61.2,
      previous: null,
      delta: 0,
      formattedLatest: "61.2 %",
      formattedDelta: "0.0 %",
      trend: "flat",
    });

    expect(formatRecentDelta([], "kg", 1)).toEqual({
      latest: null,
      previous: null,
      delta: null,
      formattedLatest: "--",
      formattedDelta: "Sin datos",
      trend: "none",
    });
  });
});

describe("buildRenphoChartModel", () => {
  it("construye data alineada, dominio seguro y resumen reciente", () => {
    const model = buildRenphoChartModel(
      [
        {
          measuredAt: "2026-11-18T07:00:00Z",
          date: "2026-11-18",
          weightKg: 76.4,
          bodyFatPct: 13.8,
          muscleMassKg: 62.4,
          waterPct: 61.2,
        },
        {
          measuredAt: "2026-11-17T07:00:00Z",
          date: "2026-11-17",
          weightKg: 76.8,
          bodyFatPct: 14.0,
          muscleMassKg: 62.2,
          waterPct: 61.0,
        },
      ],
      "muscleMassKg",
      "kg",
      1,
    );

    expect(model.values).toEqual([62.2, 62.4]);
    expect(model.yDomain).toEqual([62.176, 62.424]);
    expect(model.summary.formattedLatest).toBe("62.4 kg");
    expect(model.summary.formattedDelta).toBe("+0.2 kg");
    expect(model.data[0]).toHaveLength(2);
    expect(model.data[1]).toEqual([62.2, 62.4]);
  });
});
