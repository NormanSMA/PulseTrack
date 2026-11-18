export type HeatmapFilter = "all" | "gym" | "routes" | "macros" | "recovery";

export interface HeatmapDay {
  date: string;
  gym: number;
  routes: number;
  macros: number;
  recovery: number;
}

export interface KpiMetric {
  id: string;
  label: string;
  value: string;
  unit: string;
  delta: string;
  source: string;
  accent: "recovery" | "strain" | "sleep" | "alert";
}

export interface GymExercisePreview {
  id: string;
  name: string;
  sets: number;
  topSetKg: number;
  reps: number;
  rpe: number;
  liftAiCue: string;
}

export interface RoutePreview {
  id: string;
  name: string;
  distanceKm: number;
  elevationGainM: number;
  gapPace: string;
  source: string;
}

export interface MacroSummary {
  id: string;
  label: string;
  current: number;
  target: number;
  unit: string;
}

export interface AiModelTelemetry {
  id: string;
  provider: "onnx_local" | "workers_ai" | "nim" | "gemini";
  model: string;
  latencyMs: number;
  status: string;
}

export const HOME_KPIS: readonly KpiMetric[] = [
  {
    id: "recovery",
    label: "Recovery",
    value: "86",
    unit: "%",
    delta: "+4% vs 7d",
    source: "Garmin VFC",
    accent: "recovery",
  },
  {
    id: "strain",
    label: "Strain",
    value: "14.2",
    unit: "idx",
    delta: "ACWR 1.08",
    source: "Garmin + Hevy",
    accent: "strain",
  },
  {
    id: "sleep",
    label: "Sleep",
    value: "07:42",
    unit: "h",
    delta: "92% ef.",
    source: "Garmin Sleep",
    accent: "sleep",
  },
  {
    id: "balance",
    label: "Balance",
    value: "-320",
    unit: "kcal",
    delta: "2180 / 2500",
    source: "PulseTrack / Garmin",
    accent: "alert",
  },
];

export const GYM_PREVIEW: readonly GymExercisePreview[] = [
  {
    id: "ex-1",
    name: "Back Squat",
    sets: 4,
    topSetKg: 132.5,
    reps: 5,
    rpe: 8.5,
    liftAiCue: "+2.5 kg recomendado en bloque siguiente",
  },
  {
    id: "ex-2",
    name: "Weighted Pull-Up",
    sets: 4,
    topSetKg: 25.0,
    reps: 6,
    rpe: 8.0,
    liftAiCue: "Mantener descanso 02:00",
  },
  {
    id: "ex-3",
    name: "Romanian Deadlift",
    sets: 3,
    topSetKg: 115.0,
    reps: 8,
    rpe: 7.5,
    liftAiCue: "Carga óptima según VFC",
  },
];

export const ROUTES_PREVIEW: readonly RoutePreview[] = [
  {
    id: "rt-1",
    name: "Circuito Volcán Masaya",
    distanceKm: 12.48,
    elevationGainM: 412,
    gapPace: "04:28 /km",
    source: "Garmin LineStringZ",
  },
  {
    id: "rt-2",
    name: "Tempo Carretera Sur",
    distanceKm: 8.6,
    elevationGainM: 145,
    gapPace: "04:12 /km",
    source: "GPX Upload",
  },
];

export const NUTRITION_MACROS: readonly MacroSummary[] = [
  { id: "kcal", label: "Energía", current: 2180, target: 2500, unit: "kcal" },
  { id: "pro", label: "Proteína", current: 168, target: 180, unit: "g" },
  { id: "carb", label: "Carbohidratos", current: 245, target: 280, unit: "g" },
  { id: "fat", label: "Grasas", current: 64, target: 75, unit: "g" },
];

export const AI_TELEMETRY_PREVIEW: readonly AiModelTelemetry[] = [
  {
    id: "tel-1",
    provider: "onnx_local",
    model: "readiness-xgb-v2.onnx",
    latencyMs: 4,
    status: "200 OK",
  },
  {
    id: "tel-2",
    provider: "workers_ai",
    model: "llama-3.3-70b",
    latencyMs: 210,
    status: "200 OK",
  },
  {
    id: "tel-3",
    provider: "gemini",
    model: "gemini-flash-nutrition",
    latencyMs: 340,
    status: "200 OK",
  },
];

const REFERENCE_ANCHOR_UTC = Date.UTC(2026, 10, 18);
const TOTAL_HEATMAP_DAYS = 52 * 7;

function deterministicLevel(seed: number, offset: number): number {
  const mixed = ((seed * 37 + offset * 17) % 11) + ((seed >> 2) % 3);
  if (mixed <= 3) return 0;
  if (mixed <= 6) return 1;
  if (mixed <= 9) return 2;
  if (mixed <= 11) return 3;
  return 4;
}

export function buildMockHeatmapDays(): readonly HeatmapDay[] {
  const days: HeatmapDay[] = [];
  for (let i = TOTAL_HEATMAP_DAYS - 1; i >= 0; i -= 1) {
    const timestamp = REFERENCE_ANCHOR_UTC - i * 86_400_000;
    const date = new Date(timestamp).toISOString().slice(0, 10);
    const seed = TOTAL_HEATMAP_DAYS - i;
    days.push({
      date,
      gym: deterministicLevel(seed, 1),
      routes: deterministicLevel(seed, 3),
      macros: deterministicLevel(seed, 5),
      recovery: deterministicLevel(seed, 7),
    });
  }
  return days;
}
