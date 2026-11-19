import type uPlot from "uplot";

export type RenphoMetricKey =
  | "weightKg"
  | "bodyFatPct"
  | "muscleMassKg"
  | "waterPct";

export interface RenphoSeriesPoint {
  measuredAt: string;
  date: string;
  source?: string;
  weightKg: number | null;
  bodyFatPct: number | null;
  muscleMassKg: number | null;
  waterPct: number | null;
  visceralFat?: number | null;
  bmrKcal?: number | null;
  syncedToGarmin?: boolean;
}

export interface RawChartPoint {
  timestamp: string | number | Date;
  value: number | null | undefined;
}

export interface RecentDeltaSummary {
  latest: number | null;
  previous: number | null;
  delta: number | null;
  formattedLatest: string;
  formattedDelta: string;
  trend: "up" | "down" | "flat" | "none";
}

export interface RenphoChartModel {
  data: uPlot.AlignedData;
  timestamps: number[];
  values: number[];
  yDomain: [number, number];
  summary: RecentDeltaSummary;
}

const MS_THRESHOLD = 1e11;

function roundTo4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

export function parseTimestampToUnixSeconds(
  input: string | number | Date | null | undefined,
): number | null {
  if (input === null || input === undefined) {
    return null;
  }

  if (typeof input === "number") {
    if (!Number.isFinite(input)) {
      return null;
    }
    return Math.abs(input) >= MS_THRESHOLD ? input / 1000 : input;
  }

  if (input instanceof Date) {
    const ms = input.getTime();
    return Number.isFinite(ms) ? ms / 1000 : null;
  }

  if (typeof input === "string") {
    const trimmed = input.trim();
    if (trimmed.length === 0) {
      return null;
    }
    const ms = Date.parse(trimmed);
    return Number.isFinite(ms) ? ms / 1000 : null;
  }

  return null;
}

export function toAlignedSeries(
  points: readonly RawChartPoint[],
): [number[], number[]] {
  const valid: { ts: number; val: number; order: number }[] = [];

  for (let i = 0; i < points.length; i += 1) {
    const point = points[i];
    if (!point) continue;

    const ts = parseTimestampToUnixSeconds(point.timestamp);
    if (ts === null || !Number.isFinite(ts)) continue;

    const val = point.value;
    if (typeof val !== "number" || !Number.isFinite(val)) continue;

    valid.push({ ts, val, order: i });
  }

  valid.sort((a, b) => (a.ts !== b.ts ? a.ts - b.ts : a.order - b.order));

  const timestamps: number[] = [];
  const values: number[] = [];

  for (const item of valid) {
    const lastIdx = timestamps.length - 1;
    if (lastIdx >= 0 && timestamps[lastIdx] === item.ts) {
      values[lastIdx] = item.val;
    } else {
      timestamps.push(item.ts);
      values.push(item.val);
    }
  }

  return [timestamps, values];
}

export function renphoPointsToAlignedData(
  points: readonly RenphoSeriesPoint[],
  metric: RenphoMetricKey,
): [number[], number[]] {
  const mapped: RawChartPoint[] = points.map((point) => {
    const hasMeasuredAt =
      typeof point.measuredAt === "string" &&
      parseTimestampToUnixSeconds(point.measuredAt) !== null;
    return {
      timestamp: hasMeasuredAt ? point.measuredAt : point.date,
      value: point[metric],
    };
  });

  return toAlignedSeries(mapped);
}

export function computeSafeYDomain(
  values: readonly number[],
  paddingRatio = 0.12,
): [number, number] {
  const finite = values.filter(
    (value): value is number =>
      typeof value === "number" && Number.isFinite(value),
  );

  if (finite.length === 0) {
    return [0, 1];
  }

  let min = finite[0]!;
  let max = finite[0]!;

  for (let i = 1; i < finite.length; i += 1) {
    const current = finite[i]!;
    if (current < min) min = current;
    if (current > max) max = current;
  }

  if (min === max) {
    const flatPad = Math.max(Math.abs(min) * 0.05, 0.5);
    return [roundTo4(min - flatPad), roundTo4(max + flatPad)];
  }

  const ratio =
    Number.isFinite(paddingRatio) && paddingRatio >= 0 ? paddingRatio : 0.12;
  const pad = (max - min) * ratio;

  return [roundTo4(min - pad), roundTo4(max + pad)];
}

export function formatRecentDelta(
  values: readonly number[],
  unit: string,
  decimals = 1,
): RecentDeltaSummary {
  const safeDecimals =
    Number.isInteger(decimals) && decimals >= 0 && decimals <= 4 ? decimals : 1;

  const finite = values.filter(
    (value): value is number =>
      typeof value === "number" && Number.isFinite(value),
  );

  if (finite.length === 0) {
    return {
      latest: null,
      previous: null,
      delta: null,
      formattedLatest: "--",
      formattedDelta: "Sin datos",
      trend: "none",
    };
  }

  const latest = finite[finite.length - 1]!;
  const suffix = unit.trim().length > 0 ? ` ${unit.trim()}` : "";
  const formattedLatest = `${latest.toFixed(safeDecimals)}${suffix}`;

  if (finite.length === 1) {
    return {
      latest,
      previous: null,
      delta: 0,
      formattedLatest,
      formattedDelta: `${(0).toFixed(safeDecimals)}${suffix}`,
      trend: "flat",
    };
  }

  const previous = finite[finite.length - 2]!;
  const delta = roundTo4(latest - previous);
  const roundedDelta = Number(delta.toFixed(safeDecimals));

  if (roundedDelta === 0) {
    return {
      latest,
      previous,
      delta,
      formattedLatest,
      formattedDelta: `${(0).toFixed(safeDecimals)}${suffix}`,
      trend: "flat",
    };
  }

  if (roundedDelta > 0) {
    return {
      latest,
      previous,
      delta,
      formattedLatest,
      formattedDelta: `+${roundedDelta.toFixed(safeDecimals)}${suffix}`,
      trend: "up",
    };
  }

  return {
    latest,
    previous,
    delta,
    formattedLatest,
    formattedDelta: `${roundedDelta.toFixed(safeDecimals)}${suffix}`,
    trend: "down",
  };
}

export function buildRenphoChartModel(
  points: readonly RenphoSeriesPoint[],
  metric: RenphoMetricKey,
  unit: string,
  decimals = 1,
): RenphoChartModel {
  const [timestamps, values] = renphoPointsToAlignedData(points, metric);
  const yDomain = computeSafeYDomain(values);
  const summary = formatRecentDelta(values, unit, decimals);

  return {
    data: [timestamps, values],
    timestamps,
    values,
    yDomain,
    summary,
  };
}
