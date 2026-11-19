"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { UPlotChart, type ChartAccent } from "@/components/charts/UPlotChart";
import { useLiveIsland } from "@/components/ui/LiveIsland";
import { ConsistencyPills30d } from "@/components/ui/TelemetryPrimitives";
import {
  buildRenphoChartModel,
  type RenphoMetricKey,
  type RenphoSeriesPoint,
} from "@/lib/charts/uplot-series";
import { buildMockHeatmapDays } from "@/lib/mock-data";

export type AcwrZone = "undertraining" | "optimal" | "caution" | "high_risk";

interface RoutineExercise {
  exerciseExternalId: string;
  exerciseName: string;
  sets: number;
  targetReps: string;
  targetRpe: number | null;
  restSeconds: number;
  notes: string | null;
}

interface GymRoutine {
  id: string;
  name: string;
  splitTag: string;
  exercises: RoutineExercise[];
}

interface GymSessionSummary {
  externalId: string;
  title: string;
  date: string;
  startedAt: string;
  source: string;
  totalVolumeKg: number;
  sets: number;
}

interface WeeklyTonnageEntry {
  weekStart: string;
  tonnageKg: number;
  sessionsCount: number;
}

interface AcwrSummary {
  acuteLoad: number;
  chronicLoad: number;
  ratio: number;
  zone: AcwrZone;
  label: string;
}

interface LiftAiRecommendation {
  exerciseExternalId: string;
  exerciseName: string;
  currentTopKg: number;
  currentE1rmKg: number;
  suggestedKg: number;
  deltaKg: number;
  rationale: string;
}

interface GymSessionsData {
  routines: GymRoutine[];
  sessions: GymSessionSummary[];
  weeklyTonnage: WeeklyTonnageEntry[];
  acwr: AcwrSummary;
  recommendations: LiftAiRecommendation[];
  recoveryScore: number;
}

interface BodyCompositionData {
  authority: string;
  latest: RenphoSeriesPoint | null;
  series: RenphoSeriesPoint[];
}

interface GarminWorkoutStep {
  stepOrder: number;
  exerciseCategory: string;
  exerciseName: string;
  sets: number;
  targetReps: string;
  restSeconds: number;
  garminStepNote: string;
}

interface GarminExportWorkout {
  exportId: string;
  routineId: string;
  workoutName: string;
  sportType: string;
  generatedAt: string;
  steps: GarminWorkoutStep[];
}

interface MetricOption {
  key: RenphoMetricKey;
  label: string;
  title: string;
  unit: string;
  decimals: number;
  accent: ChartAccent;
}

const RENPHO_METRICS: readonly MetricOption[] = [
  {
    key: "weightKg",
    label: "Peso",
    title: "Peso Corporal RENPHO",
    unit: "kg",
    decimals: 1,
    accent: "strain",
  },
  {
    key: "bodyFatPct",
    label: "Grasa %",
    title: "Porcentaje de Grasa Corporal",
    unit: "%",
    decimals: 1,
    accent: "alert",
  },
  {
    key: "muscleMassKg",
    label: "Masa muscular",
    title: "Masa Muscular Esqueletica",
    unit: "kg",
    decimals: 1,
    accent: "recovery",
  },
  {
    key: "waterPct",
    label: "Agua %",
    title: "Hidratacion Corporal",
    unit: "%",
    decimals: 1,
    accent: "sleep",
  },
];

const ACWR_BADGE_CLASS: Record<AcwrZone, string> = {
  optimal: "border-accent-recovery/40 bg-accent-recovery/10 text-accent-recovery",
  undertraining: "border-accent-strain/40 bg-accent-strain/10 text-accent-strain",
  caution: "border-accent-alert/40 bg-accent-alert/10 text-accent-alert",
  high_risk: "border-accent-danger/40 bg-accent-danger/10 text-accent-danger",
};

const ACWR_BORDER_CLASS: Record<AcwrZone, string> = {
  optimal: "border-accent-recovery/40",
  undertraining: "border-accent-strain/40",
  caution: "border-accent-alert/40",
  high_risk: "border-accent-danger/40",
};

const ACWR_ZONE_LABEL: Record<AcwrZone, string> = {
  optimal: "Optimal",
  undertraining: "Undertraining",
  caution: "Caution",
  high_risk: "High Risk",
};

const FALLBACK_BODY_COMPOSITION: BodyCompositionData = {
  authority: "renpho",
  latest: {
    measuredAt: "2026-11-18T07:10:00Z",
    date: "2026-11-18",
    source: "renpho",
    weightKg: 76.4,
    bodyFatPct: 13.8,
    muscleMassKg: 62.4,
    waterPct: 61.2,
    visceralFat: 6,
    bmrKcal: 1790,
    syncedToGarmin: true,
  },
  series: [
    {
      measuredAt: "2026-11-12T07:08:00Z",
      date: "2026-11-12",
      source: "renpho",
      weightKg: 77.1,
      bodyFatPct: 14.3,
      muscleMassKg: 62.0,
      waterPct: 60.6,
      visceralFat: 6,
      bmrKcal: 1785,
      syncedToGarmin: true,
    },
    {
      measuredAt: "2026-11-13T07:12:00Z",
      date: "2026-11-13",
      source: "renpho",
      weightKg: 76.9,
      bodyFatPct: 14.2,
      muscleMassKg: 62.1,
      waterPct: 60.8,
      visceralFat: 6,
      bmrKcal: 1786,
      syncedToGarmin: true,
    },
    {
      measuredAt: "2026-11-14T07:05:00Z",
      date: "2026-11-14",
      source: "renpho",
      weightKg: 76.8,
      bodyFatPct: 14.1,
      muscleMassKg: 62.1,
      waterPct: 60.9,
      visceralFat: 6,
      bmrKcal: 1787,
      syncedToGarmin: true,
    },
    {
      measuredAt: "2026-11-15T07:15:00Z",
      date: "2026-11-15",
      source: "renpho",
      weightKg: 76.7,
      bodyFatPct: 14.0,
      muscleMassKg: 62.2,
      waterPct: 61.0,
      visceralFat: 6,
      bmrKcal: 1788,
      syncedToGarmin: true,
    },
    {
      measuredAt: "2026-11-16T07:09:00Z",
      date: "2026-11-16",
      source: "renpho",
      weightKg: 76.6,
      bodyFatPct: 13.9,
      muscleMassKg: 62.3,
      waterPct: 61.0,
      visceralFat: 6,
      bmrKcal: 1789,
      syncedToGarmin: true,
    },
    {
      measuredAt: "2026-11-17T07:11:00Z",
      date: "2026-11-17",
      source: "renpho",
      weightKg: 76.5,
      bodyFatPct: 13.9,
      muscleMassKg: 62.3,
      waterPct: 61.1,
      visceralFat: 6,
      bmrKcal: 1789,
      syncedToGarmin: true,
    },
    {
      measuredAt: "2026-11-18T07:10:00Z",
      date: "2026-11-18",
      source: "renpho",
      weightKg: 76.4,
      bodyFatPct: 13.8,
      muscleMassKg: 62.4,
      waterPct: 61.2,
      visceralFat: 6,
      bmrKcal: 1790,
      syncedToGarmin: true,
    },
  ],
};

const FALLBACK_GYM_SESSIONS: GymSessionsData = {
  recoveryScore: 86,
  routines: [
    {
      id: "routine-push",
      name: "Push · Fuerza Torso",
      splitTag: "Push",
      exercises: [
        {
          exerciseExternalId: "bench-press-barbell",
          exerciseName: "Bench Press (Barbell)",
          sets: 4,
          targetReps: "6-8",
          targetRpe: 8.5,
          restSeconds: 150,
          notes: "Pausa controlada de 1 s en pecho",
        },
        {
          exerciseExternalId: "overhead-press-barbell",
          exerciseName: "Overhead Press (Barbell)",
          sets: 3,
          targetReps: "6-8",
          targetRpe: 8,
          restSeconds: 120,
          notes: "Bloqueo estable sin hiperextension lumbar",
        },
        {
          exerciseExternalId: "incline-dumbbell-press",
          exerciseName: "Incline Press (Dumbbell)",
          sets: 3,
          targetReps: "8-10",
          targetRpe: 8,
          restSeconds: 90,
          notes: "Rango completo con bajada en 2 s",
        },
      ],
    },
    {
      id: "routine-pull",
      name: "Pull · Traccion",
      splitTag: "Pull",
      exercises: [
        {
          exerciseExternalId: "weighted-pull-up",
          exerciseName: "Weighted Pull-Up",
          sets: 4,
          targetReps: "6",
          targetRpe: 8,
          restSeconds: 120,
          notes: "Menton sobre barra con control excentrico",
        },
        {
          exerciseExternalId: "barbell-row",
          exerciseName: "Bent Over Row (Barbell)",
          sets: 4,
          targetReps: "8",
          targetRpe: 8,
          restSeconds: 120,
          notes: "Torso estable a 45 grados",
        },
        {
          exerciseExternalId: "face-pull",
          exerciseName: "Face Pull (Cable)",
          sets: 3,
          targetReps: "12-15",
          targetRpe: 7.5,
          restSeconds: 60,
          notes: "Rotacion externa al final del recorrido",
        },
      ],
    },
    {
      id: "routine-legs",
      name: "Legs · Pierna Base",
      splitTag: "Legs",
      exercises: [
        {
          exerciseExternalId: "back-squat-barbell",
          exerciseName: "Back Squat",
          sets: 4,
          targetReps: "5",
          targetRpe: 8.5,
          restSeconds: 180,
          notes: "Profundidad paralela consistente",
        },
        {
          exerciseExternalId: "romanian-deadlift",
          exerciseName: "Romanian Deadlift",
          sets: 3,
          targetReps: "8",
          targetRpe: 7.5,
          restSeconds: 150,
          notes: "Bisagra de cadera con tension isquiotibial",
        },
        {
          exerciseExternalId: "walking-lunge",
          exerciseName: "Walking Lunge (Dumbbell)",
          sets: 3,
          targetReps: "10",
          targetRpe: 8,
          restSeconds: 90,
          notes: "Zancada amplia por pierna",
        },
      ],
    },
  ],
  sessions: [
    {
      externalId: "hevy-fallback-1",
      title: "Legs · Pierna Base",
      date: "2026-11-17",
      startedAt: "2026-11-17T18:10:00Z",
      source: "hevy",
      totalVolumeKg: 6420,
      sets: 14,
    },
    {
      externalId: "hevy-fallback-2",
      title: "Pull · Traccion",
      date: "2026-11-15",
      startedAt: "2026-11-15T17:45:00Z",
      source: "hevy",
      totalVolumeKg: 5890,
      sets: 13,
    },
    {
      externalId: "hevy-fallback-3",
      title: "Push · Fuerza Torso",
      date: "2026-11-13",
      startedAt: "2026-11-13T18:00:00Z",
      source: "hevy",
      totalVolumeKg: 6110,
      sets: 12,
    },
  ],
  weeklyTonnage: [
    { weekStart: "2026-10-26", tonnageKg: 15800, sessionsCount: 3 },
    { weekStart: "2026-11-02", tonnageKg: 16900, sessionsCount: 3 },
    { weekStart: "2026-11-09", tonnageKg: 17540, sessionsCount: 4 },
    { weekStart: "2026-11-16", tonnageKg: 18420, sessionsCount: 4 },
  ],
  acwr: {
    acuteLoad: 18420,
    chronicLoad: 17165,
    ratio: 1.07,
    zone: "optimal",
    label: "Carga optima para progresion",
  },
  recommendations: [
    {
      exerciseExternalId: "bench-press-barbell",
      exerciseName: "Bench Press (Barbell)",
      currentTopKg: 90,
      currentE1rmKg: 108,
      suggestedKg: 92.5,
      deltaKg: 2.5,
      rationale: "Recovery 86% y RPE estable bajo 8.5",
    },
    {
      exerciseExternalId: "overhead-press-barbell",
      exerciseName: "Overhead Press (Barbell)",
      currentTopKg: 57.5,
      currentE1rmKg: 69,
      suggestedKg: 57.5,
      deltaKg: 0,
      rationale: "Consolidar 3x8 antes de subir 2.5 kg",
    },
    {
      exerciseExternalId: "incline-dumbbell-press",
      exerciseName: "Incline Press (Dumbbell)",
      currentTopKg: 32,
      currentE1rmKg: 41.6,
      suggestedKg: 34,
      deltaKg: 2,
      rationale: "Margen de repeticiones en ultima serie",
    },
    {
      exerciseExternalId: "weighted-pull-up",
      exerciseName: "Weighted Pull-Up",
      currentTopKg: 25,
      currentE1rmKg: 30,
      suggestedKg: 25,
      deltaKg: 0,
      rationale: "Mantener descanso 02:00",
    },
    {
      exerciseExternalId: "barbell-row",
      exerciseName: "Bent Over Row (Barbell)",
      currentTopKg: 82.5,
      currentE1rmKg: 104.5,
      suggestedKg: 85,
      deltaKg: 2.5,
      rationale: "Velocidad limpia en ultima sesion Pull",
    },
    {
      exerciseExternalId: "back-squat-barbell",
      exerciseName: "Back Squat",
      currentTopKg: 132.5,
      currentE1rmKg: 154.6,
      suggestedKg: 135,
      deltaKg: 2.5,
      rationale: "ACWR 1.07 en zona optima",
    },
    {
      exerciseExternalId: "romanian-deadlift",
      exerciseName: "Romanian Deadlift",
      currentTopKg: 115,
      currentE1rmKg: 145.6,
      suggestedKg: 115,
      deltaKg: 0,
      rationale: "Carga optima segun VFC",
    },
  ],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asNullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asAcwrZone(value: unknown): AcwrZone {
  if (
    value === "undertraining" ||
    value === "optimal" ||
    value === "caution" ||
    value === "high_risk"
  ) {
    return value;
  }
  return "optimal";
}

function parseRenphoPoint(raw: unknown): RenphoSeriesPoint | null {
  if (!isRecord(raw)) return null;
  const date = asString(raw.date);
  const measuredAt = asString(raw.measuredAt, date);
  if (measuredAt.length === 0 && date.length === 0) return null;

  return {
    measuredAt,
    date,
    source: asString(raw.source, "renpho"),
    weightKg: asNullableNumber(raw.weightKg),
    bodyFatPct: asNullableNumber(raw.bodyFatPct),
    muscleMassKg: asNullableNumber(raw.muscleMassKg),
    waterPct: asNullableNumber(raw.waterPct),
    visceralFat: asNullableNumber(raw.visceralFat),
    bmrKcal: asNullableNumber(raw.bmrKcal),
    syncedToGarmin:
      typeof raw.syncedToGarmin === "boolean" ? raw.syncedToGarmin : undefined,
  };
}

function parseBodyCompositionResponse(raw: unknown): BodyCompositionData | null {
  if (!isRecord(raw) || raw.ok !== true) return null;
  const rawSeries = Array.isArray(raw.series) ? raw.series : [];
  const series = rawSeries
    .map(parseRenphoPoint)
    .filter((item): item is RenphoSeriesPoint => item !== null);
  const latest = parseRenphoPoint(raw.latest) ?? series[series.length - 1] ?? null;

  return {
    authority: asString(raw.authority, "renpho"),
    latest,
    series,
  };
}

function parseGymSessionsResponse(raw: unknown): GymSessionsData | null {
  if (!isRecord(raw) || raw.ok !== true) return null;

  const routinesRaw = Array.isArray(raw.routines) ? raw.routines : [];
  const routines: GymRoutine[] = routinesRaw
    .map((r): GymRoutine | null => {
      if (!isRecord(r)) return null;
      const id = asString(r.id);
      const name = asString(r.name);
      if (id.length === 0 || name.length === 0) return null;

      const exercisesRaw = Array.isArray(r.exercises) ? r.exercises : [];
      const exercises: RoutineExercise[] = exercisesRaw
        .map((ex): RoutineExercise | null => {
          if (!isRecord(ex)) return null;
          const exerciseName = asString(ex.exerciseName);
          if (exerciseName.length === 0) return null;
          const targetReps =
            typeof ex.targetReps === "number"
              ? String(ex.targetReps)
              : asString(ex.targetReps, "8");
          return {
            exerciseExternalId: asString(ex.exerciseExternalId, exerciseName),
            exerciseName,
            sets: Math.max(1, Math.round(asNumber(ex.sets, 3))),
            targetReps,
            targetRpe: asNullableNumber(ex.targetRpe),
            restSeconds: Math.max(0, Math.round(asNumber(ex.restSeconds, 90))),
            notes: typeof ex.notes === "string" && ex.notes.length > 0 ? ex.notes : null,
          };
        })
        .filter((ex): ex is RoutineExercise => ex !== null);

      return {
        id,
        name,
        splitTag: asString(r.splitTag, name),
        exercises,
      };
    })
    .filter((r): r is GymRoutine => r !== null);

  const sessionsRaw = Array.isArray(raw.sessions) ? raw.sessions : [];
  const sessions: GymSessionSummary[] = sessionsRaw
    .map((s): GymSessionSummary | null => {
      if (!isRecord(s)) return null;
      const externalId = asString(s.externalId);
      const title = asString(s.title);
      if (externalId.length === 0 || title.length === 0) return null;
      return {
        externalId,
        title,
        date: asString(s.date),
        startedAt: asString(s.startedAt),
        source: asString(s.source, "hevy"),
        totalVolumeKg: asNumber(s.totalVolumeKg, 0),
        sets: Array.isArray(s.sets) ? s.sets.length : Math.max(0, Math.round(asNumber(s.sets, 0))),
      };
    })
    .filter((s): s is GymSessionSummary => s !== null);

  const tonnageRaw = Array.isArray(raw.weeklyTonnage) ? raw.weeklyTonnage : [];
  const weeklyTonnage: WeeklyTonnageEntry[] = tonnageRaw
    .map((w): WeeklyTonnageEntry | null => {
      if (!isRecord(w)) return null;
      const weekStart = asString(w.weekStart);
      if (weekStart.length === 0) return null;
      return {
        weekStart,
        tonnageKg: asNumber(w.tonnageKg, 0),
        sessionsCount: Math.max(0, Math.round(asNumber(w.sessionsCount, 0))),
      };
    })
    .filter((w): w is WeeklyTonnageEntry => w !== null);

  const acwrRaw = isRecord(raw.acwr) ? raw.acwr : {};
  const acwr: AcwrSummary = {
    acuteLoad: asNumber(acwrRaw.acuteLoad, 0),
    chronicLoad: asNumber(acwrRaw.chronicLoad, 0),
    ratio: asNumber(acwrRaw.ratio, 1),
    zone: asAcwrZone(acwrRaw.zone),
    label: asString(acwrRaw.label, "Sin datos ACWR"),
  };

  const recsRaw = Array.isArray(raw.recommendations) ? raw.recommendations : [];
  const recommendations: LiftAiRecommendation[] = recsRaw
    .map((rec): LiftAiRecommendation | null => {
      if (!isRecord(rec)) return null;
      const exerciseName = asString(rec.exerciseName);
      const exerciseExternalId = asString(rec.exerciseExternalId, exerciseName);
      if (exerciseName.length === 0) return null;
      return {
        exerciseExternalId,
        exerciseName,
        currentTopKg: asNumber(rec.currentTopKg, 0),
        currentE1rmKg: asNumber(rec.currentE1rmKg, 0),
        suggestedKg: asNumber(rec.suggestedKg, 0),
        deltaKg: asNumber(rec.deltaKg, 0),
        rationale: asString(rec.rationale),
      };
    })
    .filter((rec): rec is LiftAiRecommendation => rec !== null);

  return {
    routines,
    sessions,
    weeklyTonnage,
    acwr,
    recommendations,
    recoveryScore: asNumber(raw.recoveryScore, 80),
  };
}

function parseGarminExportResponse(raw: unknown): GarminExportWorkout | null {
  if (!isRecord(raw) || raw.ok !== true || !isRecord(raw.workout)) return null;
  const w = raw.workout;
  const stepsRaw = Array.isArray(w.steps) ? w.steps : [];
  const steps: GarminWorkoutStep[] = stepsRaw
    .map((step, index): GarminWorkoutStep | null => {
      if (!isRecord(step)) return null;
      return {
        stepOrder: Math.max(1, Math.round(asNumber(step.stepOrder, index + 1))),
        exerciseCategory: asString(step.exerciseCategory, "STRENGTH"),
        exerciseName: asString(step.exerciseName, "Ejercicio"),
        sets: Math.max(1, Math.round(asNumber(step.sets, 3))),
        targetReps:
          typeof step.targetReps === "number"
            ? String(step.targetReps)
            : asString(step.targetReps, "8"),
        restSeconds: Math.max(0, Math.round(asNumber(step.restSeconds, 90))),
        garminStepNote: asString(step.garminStepNote),
      };
    })
    .filter((step): step is GarminWorkoutStep => step !== null);

  return {
    exportId: asString(w.exportId, "garmin-export"),
    routineId: asString(w.routineId),
    workoutName: asString(w.workoutName, "Rutina PulseTrack"),
    sportType: asString(w.sportType, "STRENGTH_TRAINING"),
    generatedAt: asString(w.generatedAt),
    steps,
  };
}

function formatNumber(value: number, decimals = 0): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function formatSignedKg(delta: number): string {
  if (Math.abs(delta) < 0.05) return "0 kg";
  return delta > 0 ? `+${delta.toFixed(1)} kg` : `${delta.toFixed(1)} kg`;
}

export function GymDashboardClient() {
  const { setState: setIslandState, resetTimer } = useLiveIsland();

  const [gymData, setGymData] = useState<GymSessionsData>(FALLBACK_GYM_SESSIONS);
  const [bodyData, setBodyData] = useState<BodyCompositionData>(
    FALLBACK_BODY_COMPOSITION,
  );
  const [dataSourceState, setDataSourceState] = useState<
    "fallback" | "loading" | "live"
  >("fallback");

  const [selectedMetric, setSelectedMetric] =
    useState<RenphoMetricKey>("weightKg");
  const [selectedRoutineId, setSelectedRoutineId] = useState<string>(
    FALLBACK_GYM_SESSIONS.routines[0]?.id ?? "",
  );

  const [exportBusy, setExportBusy] = useState<boolean>(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportedWorkout, setExportedWorkout] =
    useState<GarminExportWorkout | null>(null);

  const [catalogName, setCatalogName] = useState<string>("");
  const [catalogMuscleGroup, setCatalogMuscleGroup] = useState<string>("Chest");
  const [catalogEquipment, setCatalogEquipment] = useState<string>("Barbell");
  const [catalogStepNote, setCatalogStepNote] = useState<string>("");
  const [catalogBusy, setCatalogBusy] = useState<boolean>(false);
  const [catalogFeedback, setCatalogFeedback] = useState<{
    tone: "ok" | "error";
    text: string;
  } | null>(null);

  const [hevyBusy, setHevyBusy] = useState<boolean>(false);
  const [hevyFeedback, setHevyFeedback] = useState<{
    tone: "ok" | "error";
    text: string;
  } | null>(null);

  const csvInputId = useId();
  const catalogNameId = useId();
  const catalogMuscleId = useId();
  const catalogEquipmentId = useId();
  const catalogNoteId = useId();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const loadGymSessions = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch("/api/gym/sessions", {
      cache: "no-store",
      signal,
    });
    if (!response.ok) return null;
    const json: unknown = await response.json();
    return parseGymSessionsResponse(json);
  }, []);

  const loadBodyComposition = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch("/api/body-composition", {
      cache: "no-store",
      signal,
    });
    if (!response.ok) return null;
    const json: unknown = await response.json();
    return parseBodyCompositionResponse(json);
  }, []);

  const hydrateFromApi = useCallback(
    async (signal?: AbortSignal) => {
      setDataSourceState("loading");
      try {
        const [sessionsResult, bodyResult] = await Promise.allSettled([
          loadGymSessions(signal),
          loadBodyComposition(signal),
        ]);

        if (signal?.aborted) return;

        let loadedAny = false;

        if (sessionsResult.status === "fulfilled" && sessionsResult.value) {
          const nextGym = sessionsResult.value;
          setGymData(nextGym);
          if (nextGym.routines.length > 0) {
            setSelectedRoutineId((prev) =>
              nextGym.routines.some((r) => r.id === prev)
                ? prev
                : nextGym.routines[0]!.id,
            );
          }
          loadedAny = true;
        }

        if (bodyResult.status === "fulfilled" && bodyResult.value) {
          setBodyData(bodyResult.value);
          loadedAny = true;
        }

        setDataSourceState(loadedAny ? "live" : "fallback");
      } catch {
        if (signal?.aborted) return;
        setDataSourceState("fallback");
      }
    },
    [loadBodyComposition, loadGymSessions],
  );

  useEffect(() => {
    const controller = new AbortController();
    void hydrateFromApi(controller.signal);

    return () => {
      controller.abort();
    };
  }, [hydrateFromApi]);

  const activeMetricMeta = useMemo(
    () =>
      RENPHO_METRICS.find((item) => item.key === selectedMetric) ??
      RENPHO_METRICS[0]!,
    [selectedMetric],
  );

  const chartModel = useMemo(
    () =>
      buildRenphoChartModel(
        bodyData.series,
        activeMetricMeta.key,
        activeMetricMeta.unit,
        activeMetricMeta.decimals,
      ),
    [activeMetricMeta, bodyData.series],
  );

  const activeRoutine = useMemo(() => {
    return (
      gymData.routines.find((routine) => routine.id === selectedRoutineId) ??
      gymData.routines[0] ??
      null
    );
  }, [gymData.routines, selectedRoutineId]);

  const recommendationsByKey = useMemo(() => {
    const byId = new Map<string, LiftAiRecommendation>();
    const byName = new Map<string, LiftAiRecommendation>();
    for (const rec of gymData.recommendations) {
      byId.set(rec.exerciseExternalId, rec);
      byName.set(rec.exerciseName.trim().toLowerCase(), rec);
    }
    return { byId, byName };
  }, [gymData.recommendations]);

  const latestRenpho = bodyData.latest ?? bodyData.series[bodyData.series.length - 1] ?? null;
  const latestTonnage =
    gymData.weeklyTonnage[gymData.weeklyTonnage.length - 1] ?? null;
  const previousTonnage =
    gymData.weeklyTonnage.length >= 2
      ? gymData.weeklyTonnage[gymData.weeklyTonnage.length - 2] ?? null
      : null;

  const tonnageDelta =
    latestTonnage && previousTonnage
      ? latestTonnage.tonnageKg - previousTonnage.tonnageKg
      : null;

  const tonnageDeltaPct =
    latestTonnage && previousTonnage && previousTonnage.tonnageKg > 0
      ? ((latestTonnage.tonnageKg - previousTonnage.tonnageKg) / previousTonnage.tonnageKg) * 100
      : null;

  const totalSessionsCount = useMemo(() => {
    if (gymData.weeklyTonnage.length > 0) {
      return gymData.weeklyTonnage.reduce((sum, entry) => sum + entry.sessionsCount, 0);
    }
    return gymData.sessions.length;
  }, [gymData.sessions.length, gymData.weeklyTonnage]);

  const totalSetsCount = useMemo(
    () => gymData.sessions.reduce((sum, session) => sum + session.sets, 0),
    [gymData.sessions],
  );

  const totalRecentTonnageKg = useMemo(
    () => gymData.sessions.reduce((sum, session) => sum + session.totalVolumeKg, 0),
    [gymData.sessions],
  );

  const activeRoutineSummary = useMemo(() => {
    if (!activeRoutine) {
      return { totalSets: 0, estimatedMinutes: 0, exercisesCount: 0 };
    }
    const totalSets = activeRoutine.exercises.reduce((sum, ex) => sum + ex.sets, 0);
    const totalSeconds = activeRoutine.exercises.reduce(
      (sum, ex) => sum + ex.sets * (45 + ex.restSeconds),
      0,
    );
    return {
      totalSets,
      estimatedMinutes: Math.max(20, Math.round(totalSeconds / 60)),
      exercisesCount: activeRoutine.exercises.length,
    };
  }, [activeRoutine]);

  const consistencyDays30d = useMemo(() => {
    const recent30 = buildMockHeatmapDays().slice(-30);
    const sessionDates = new Set(gymData.sessions.map((session) => session.date));
    return recent30.map((day, index): "done" | "rest" | "today" => {
      if (sessionDates.has(day.date)) return "done";
      if (index === recent30.length - 1) return "today";
      return day.gym >= 2 ? "done" : "rest";
    });
  }, [gymData.sessions]);

  const handleExportGarmin = useCallback(async () => {
    if (!activeRoutine || exportBusy) return;
    setExportBusy(true);
    setExportError(null);
    setIslandState("syncing");

    try {
      const response = await fetch("/api/gym/export-garmin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ routineId: activeRoutine.id }),
      });
      const json: unknown = await response.json();
      if (!response.ok) {
        const message =
          isRecord(json) && typeof json.error === "string"
            ? json.error
            : "No se pudo exportar la rutina a Garmin Connect.";
        setExportError(message);
        setIslandState("alert");
        return;
      }

      const parsed = parseGarminExportResponse(json);
      if (!parsed) {
        setExportError("Respuesta invalida al exportar rutina Garmin.");
        setIslandState("alert");
        return;
      }

      setExportedWorkout(parsed);
      setIslandState("idle");
    } catch (err: unknown) {
      setExportError(
        err instanceof Error
          ? err.message
          : "Error de red al exportar rutina a Garmin.",
      );
      setIslandState("alert");
    } finally {
      setExportBusy(false);
    }
  }, [activeRoutine, exportBusy, setIslandState]);

  const handleCatalogSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const trimmedName = catalogName.trim();
      if (trimmedName.length === 0 || catalogBusy) {
        return;
      }

      setCatalogBusy(true);
      setCatalogFeedback(null);

      try {
        const response = await fetch("/api/gym/catalog", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: trimmedName,
            muscleGroup: catalogMuscleGroup.trim() || "General",
            equipment: catalogEquipment.trim() || "Barbell",
            defaultStepNote: catalogStepNote.trim(),
          }),
        });
        const json: unknown = await response.json();
        if (!response.ok || !isRecord(json) || json.ok !== true) {
          const errorMessage =
            isRecord(json) && typeof json.error === "string"
              ? json.error
              : "No se pudo guardar el ejercicio en el catalogo.";
          setCatalogFeedback({ tone: "error", text: errorMessage });
          return;
        }

        const deduplicated = json.deduplicated === true;
        setCatalogFeedback({
          tone: "ok",
          text: deduplicated
            ? `Ejercicio existente reutilizado: ${trimmedName}.`
            : `Ejercicio agregado al catalogo: ${trimmedName}.`,
        });
        setCatalogName("");
        setCatalogStepNote("");
      } catch (err: unknown) {
        setCatalogFeedback({
          tone: "error",
          text:
            err instanceof Error
              ? err.message
              : "Error de red al registrar ejercicio.",
        });
      } finally {
        setCatalogBusy(false);
      }
    },
    [
      catalogBusy,
      catalogEquipment,
      catalogMuscleGroup,
      catalogName,
      catalogStepNote,
    ],
  );

  const handleHevyCsvChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file || hevyBusy) return;

      setHevyBusy(true);
      setHevyFeedback(null);
      setIslandState("syncing");

      try {
        const csv = await file.text();
        const response = await fetch("/api/ingest/hevy", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ csv }),
        });
        const json: unknown = await response.json();

        if (!response.ok || !isRecord(json) || json.ok !== true) {
          const message =
            isRecord(json) && typeof json.error === "string"
              ? json.error
              : "No se pudo importar el archivo CSV de Hevy.";
          setHevyFeedback({ tone: "error", text: message });
          setIslandState("alert");
          return;
        }

        const summary = isRecord(json.summary) ? json.summary : null;
        const sessionsCount = summary ? asNumber(summary.sessionsCount, 0) : 0;
        const setsCount = summary ? asNumber(summary.setsCount, 0) : 0;

        const refreshed = await loadGymSessions();
        if (refreshed) {
          setGymData(refreshed);
          setDataSourceState("live");
        }

        setHevyFeedback({
          tone: "ok",
          text: `CSV importado: ${sessionsCount} sesiones, ${setsCount} series.`,
        });
        setIslandState("idle");
      } catch (err: unknown) {
        setHevyFeedback({
          tone: "error",
          text:
            err instanceof Error
              ? err.message
              : "Error al procesar el archivo CSV de Hevy.",
        });
        setIslandState("alert");
      } finally {
        setHevyBusy(false);
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      }
    },
    [hevyBusy, loadGymSessions, setIslandState],
  );

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 border-b border-border-subtle pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs font-semibold uppercase tracking-widest text-accent-sleep">
              Gym · Hevy + Lift AI + RENPHO
            </p>
            <span className="rounded-full border border-border-subtle bg-elevated px-2.5 py-0.5 text-[11px] font-medium text-ink-secondary tabular-nums">
              {dataSourceState === "live"
                ? "API sincronizada"
                : dataSourceState === "loading"
                  ? "Actualizando..."
                  : "Base determinista"}
            </span>
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink-primary sm:text-3xl">
            Fuerza y Composicion Corporal
          </h1>
        </div>

        <button
          type="button"
          onClick={() => {
            resetTimer(90);
            setIslandState("gym-timer");
          }}
          className="min-h-11 min-w-11 rounded-full border border-accent-sleep/70 bg-surface px-5 text-xs font-semibold uppercase tracking-wider text-accent-sleep tabular-nums pt-motion-gpu hover:border-accent-sleep hover:bg-elevated active:scale-95 motion-reduce:transform-none motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-primary disabled:cursor-not-allowed disabled:opacity-40"
        >
          Iniciar descanso 01:30
        </button>
      </header>

      <section
        aria-label="Rutina del dia Lift AI"
        className="space-y-4 rounded-3xl border border-border-subtle bg-void p-5 sm:p-6"
      >
        <div className="flex flex-col gap-5 rounded-2xl border border-dashed border-border-strong bg-surface p-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-widest text-accent-recovery">
                Rutina del dia · Lift AI
              </span>
              {activeRoutine ? (
                <span className="rounded-full border border-border-strong bg-elevated px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-ink-primary">
                  {activeRoutine.splitTag}
                </span>
              ) : null}
            </div>
            <h2 className="text-2xl font-bold tracking-tight text-ink-primary sm:text-3xl">
              {activeRoutine ? activeRoutine.name : "Sin rutina activa"}
            </h2>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <span className="rounded-full border border-border-subtle bg-void px-3 py-1 text-xs font-medium text-ink-secondary tabular-nums">
                {activeRoutineSummary.estimatedMinutes} min estimados
              </span>
              <span className="rounded-full border border-border-subtle bg-void px-3 py-1 text-xs font-medium text-ink-secondary tabular-nums">
                {activeRoutineSummary.totalSets} series
              </span>
              <span className="rounded-full border border-border-subtle bg-void px-3 py-1 text-xs font-medium text-ink-secondary tabular-nums">
                {activeRoutineSummary.exercisesCount} ejercicios
              </span>
            </div>
          </div>

          <button
            type="button"
            disabled={!activeRoutine || exportBusy}
            aria-busy={exportBusy}
            onClick={() => void handleExportGarmin()}
            className="min-h-11 min-w-11 shrink-0 rounded-full bg-ink-primary px-6 text-xs font-semibold uppercase tracking-wider text-void pt-motion-gpu hover:bg-ink-primary/90 active:scale-95 motion-reduce:transform-none motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-primary focus-visible:ring-offset-2 focus-visible:ring-offset-void disabled:cursor-not-allowed disabled:opacity-40"
          >
            {exportBusy ? "Exportando..." : "Exportar a Garmin Connect"}
          </button>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3" aria-label="KPIs de entrenamiento">
          <article className="rounded-2xl border border-border-subtle bg-surface p-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-secondary">
              Sesiones
            </p>
            <p className="mt-3 text-4xl font-bold tracking-tight text-ink-primary tabular-nums sm:text-5xl">
              {totalSessionsCount}
            </p>
            <p className="mt-2 text-xs font-medium text-accent-recovery tabular-nums">
              {latestTonnage ? `${latestTonnage.sessionsCount} esta semana` : "Registro activo"}
            </p>
          </article>

          <article className="rounded-2xl border border-border-subtle bg-surface p-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-secondary">
              Series
            </p>
            <p className="mt-3 text-4xl font-bold tracking-tight text-ink-primary tabular-nums sm:text-5xl">
              {totalSetsCount}
            </p>
            <p className="mt-2 text-xs font-medium text-ink-secondary tabular-nums">
              En {gymData.sessions.length} sesiones recientes
            </p>
          </article>

          <article className="rounded-2xl border border-border-subtle bg-surface p-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-secondary">
              Tonelaje kg
            </p>
            <p className="mt-3 text-4xl font-bold tracking-tight text-ink-primary tabular-nums sm:text-5xl">
              {latestTonnage
                ? formatNumber(latestTonnage.tonnageKg)
                : formatNumber(totalRecentTonnageKg)}
            </p>
            <p className="mt-2 text-xs font-semibold text-accent-recovery tabular-nums">
              {tonnageDeltaPct !== null
                ? `${tonnageDeltaPct >= 0 ? "+" : ""}${tonnageDeltaPct.toFixed(1)}% vs sem. previa`
                : "Semana actual"}
            </p>
          </article>
        </div>

        <ConsistencyPills30d days={consistencyDays30d} goalLabel="Meta 4/sem" />
      </section>

      {dataSourceState === "fallback" ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-accent-alert/50 bg-accent-alert/10 px-4 py-3 text-xs text-accent-alert"
        >
          <span>
            No se pudo sincronizar con la API de fuerza/RENPHO. Se muestran datos de respaldo local sin sincronizar.
          </span>
          <button
            type="button"
            onClick={() => void hydrateFromApi()}
            className="min-h-11 rounded-full border border-accent-alert/60 bg-surface px-4 text-xs font-semibold uppercase tracking-wider text-accent-alert pt-motion-gpu hover:bg-elevated active:scale-95 motion-reduce:transform-none motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-primary"
          >
            Reintentar
          </button>
        </div>
      ) : null}

      <section aria-label="Indicadores de fuerza y composicion">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <article className="rounded-2xl border border-accent-strain/40 bg-surface p-5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-ink-secondary">
                Peso RENPHO
              </span>
              <span
                className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${
                  latestRenpho?.syncedToGarmin
                    ? "border-accent-recovery/40 bg-accent-recovery/10 text-accent-recovery"
                    : "border-accent-alert/40 bg-accent-alert/10 text-accent-alert"
                }`}
              >
                {latestRenpho?.syncedToGarmin ? "Garmin sync" : "Pendiente Garmin"}
              </span>
            </div>
            <div className="mt-4 flex items-baseline gap-1.5">
              <span className="text-3xl font-semibold tracking-tight text-ink-primary tabular-nums">
                {latestRenpho?.weightKg !== null && latestRenpho?.weightKg !== undefined
                  ? latestRenpho.weightKg.toFixed(1)
                  : "--"}
              </span>
              <span className="text-xs font-medium text-ink-secondary">kg</span>
            </div>
            <p className="mt-3 text-xs text-ink-secondary tabular-nums">
              Ultima bascula: {latestRenpho?.date ?? "--"}
            </p>
          </article>

          <article className="rounded-2xl border border-accent-recovery/40 bg-surface p-5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-ink-secondary">
                Grasa / Masa muscular
              </span>
              <span className="rounded-full border border-border-subtle bg-elevated px-2.5 py-0.5 text-[11px] font-medium text-ink-secondary">
                {bodyData.authority.toUpperCase()}
              </span>
            </div>
            <div className="mt-4 flex items-baseline gap-2">
              <span className="text-3xl font-semibold tracking-tight text-ink-primary tabular-nums">
                {latestRenpho?.bodyFatPct !== null && latestRenpho?.bodyFatPct !== undefined
                  ? `${latestRenpho.bodyFatPct.toFixed(1)}%`
                  : "--"}
              </span>
              <span className="text-sm font-semibold text-accent-recovery tabular-nums">
                {latestRenpho?.muscleMassKg !== null &&
                latestRenpho?.muscleMassKg !== undefined
                  ? `${latestRenpho.muscleMassKg.toFixed(1)} kg musculo`
                  : "--"}
              </span>
            </div>
            <p className="mt-3 text-xs text-ink-secondary tabular-nums">
              Agua:{" "}
              {latestRenpho?.waterPct !== null && latestRenpho?.waterPct !== undefined
                ? `${latestRenpho.waterPct.toFixed(1)}%`
                : "--"}
            </p>
          </article>

          <article className="rounded-2xl border border-accent-sleep/40 bg-surface p-5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-ink-secondary">
                Tonelaje semanal
              </span>
              <span className="rounded-full border border-border-subtle bg-elevated px-2.5 py-0.5 text-[11px] font-medium text-ink-secondary tabular-nums">
                {latestTonnage ? `${latestTonnage.sessionsCount} sesiones` : "0 sesiones"}
              </span>
            </div>
            <div className="mt-4 flex items-baseline gap-1.5">
              <span className="text-3xl font-semibold tracking-tight text-ink-primary tabular-nums">
                {latestTonnage ? formatNumber(latestTonnage.tonnageKg) : "--"}
              </span>
              <span className="text-xs font-medium text-ink-secondary">kg</span>
            </div>
            <p className="mt-3 text-xs text-accent-sleep tabular-nums">
              {tonnageDelta !== null
                ? `${tonnageDelta >= 0 ? "+" : ""}${formatNumber(tonnageDelta)} kg vs semana previa`
                : `Semana ${latestTonnage?.weekStart ?? "--"}`}
            </p>
          </article>

          <article
            className={`rounded-2xl border bg-surface p-5 ${ACWR_BORDER_CLASS[gymData.acwr.zone]}`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-ink-secondary">
                Ratio ACWR
              </span>
              <span
                className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${ACWR_BADGE_CLASS[gymData.acwr.zone]}`}
              >
                {ACWR_ZONE_LABEL[gymData.acwr.zone]}
              </span>
            </div>
            <div className="mt-4 flex items-baseline gap-2">
              <span className="text-3xl font-semibold tracking-tight text-ink-primary tabular-nums">
                {gymData.acwr.ratio.toFixed(2)}
              </span>
              <span className="text-xs font-medium text-ink-secondary">
                Recovery {gymData.recoveryScore}%
              </span>
            </div>
            <p className="mt-3 text-xs text-ink-secondary tabular-nums">
              Aguda {formatNumber(gymData.acwr.acuteLoad)} / Cronica{" "}
              {formatNumber(gymData.acwr.chronicLoad)} kg
            </p>
          </article>
        </div>
      </section>

      <section
        aria-labelledby="renpho-chart-heading"
        className="rounded-2xl border border-border-subtle bg-surface p-5"
      >
        <div className="flex flex-col gap-4 border-b border-border-subtle pb-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2
              id="renpho-chart-heading"
              className="text-base font-semibold text-ink-primary"
            >
              RENPHO Composicion Corporal (Canvas 2D 144Hz)
            </h2>
            <p className="mt-0.5 text-xs text-ink-secondary">
              Renderizado acelerado en Canvas 2D con escala temporal y dominio seguro.
            </p>
          </div>

          <div
            role="group"
            aria-label="Selector de metrica RENPHO"
            className="flex flex-wrap items-center gap-2"
          >
            {RENPHO_METRICS.map((metric) => {
              const selected = metric.key === selectedMetric;
              return (
                <button
                  key={metric.key}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setSelectedMetric(metric.key)}
                  className={`min-h-11 min-w-11 rounded-full border px-4 text-xs font-semibold tracking-wide pt-motion-gpu active:scale-95 motion-reduce:transform-none motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-primary disabled:cursor-not-allowed disabled:opacity-40 ${
                    selected
                      ? "border-ink-primary bg-ink-primary text-void"
                      : "border-border-strong bg-elevated text-ink-primary hover:border-ink-primary hover:bg-void"
                  }`}
                >
                  {metric.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-4">
          <UPlotChart
            title={activeMetricMeta.title}
            subtitle={`Serie RENPHO (${bodyData.series.length} mediciones)`}
            seriesLabel={activeMetricMeta.label}
            unit={activeMetricMeta.unit}
            decimals={activeMetricMeta.decimals}
            accent={activeMetricMeta.accent}
            data={chartModel.data}
            yDomain={chartModel.yDomain}
            summary={chartModel.summary}
          />
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border-subtle bg-void px-4 py-2.5 text-xs text-ink-secondary tabular-nums">
          <span>
            Grasa visceral:{" "}
            <strong className="font-semibold text-ink-primary">
              {latestRenpho?.visceralFat ?? "--"}
            </strong>
          </span>
          <span>
            BMR basal:{" "}
            <strong className="font-semibold text-ink-primary">
              {latestRenpho?.bmrKcal !== null && latestRenpho?.bmrKcal !== undefined
                ? `${formatNumber(latestRenpho.bmrKcal)} kcal`
                : "--"}
            </strong>
          </span>
          <span>
            Autoridad:{" "}
            <strong className="font-semibold text-ink-primary">
              {bodyData.authority}
            </strong>
          </span>
          <span>
            Estado ACWR:{" "}
            <strong className="font-semibold text-ink-primary">
              {gymData.acwr.label}
            </strong>
          </span>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <section
          aria-labelledby="routines-heading"
          className="space-y-4 rounded-2xl border border-border-subtle bg-surface p-5 lg:col-span-7"
        >
          <div className="flex flex-col gap-3 border-b border-border-subtle pb-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2
                id="routines-heading"
                className="text-base font-semibold text-ink-primary"
              >
                3 Rutinas & Exportacion Garmin Connect
              </h2>
              <p className="mt-0.5 text-xs text-ink-secondary">
                Selecciona bloque Push, Pull o Legs y revisa progresion Lift AI + e1RM.
              </p>
            </div>

            <button
              type="button"
              disabled={!activeRoutine || exportBusy}
              aria-busy={exportBusy}
              onClick={() => void handleExportGarmin()}
              className="min-h-11 min-w-11 shrink-0 rounded-full border border-accent-strain/70 bg-elevated px-4 text-xs font-semibold uppercase tracking-wider text-accent-strain pt-motion-gpu hover:border-accent-strain hover:bg-void active:scale-95 motion-reduce:transform-none motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-primary disabled:cursor-not-allowed disabled:opacity-40"
            >
              {exportBusy ? "Exportando..." : "Exportar a Garmin"}
            </button>
          </div>

          <div
            role="group"
            aria-label="Selector de rutina Push Pull Legs"
            className="flex flex-wrap items-center gap-2"
          >
            {gymData.routines.map((routine) => {
              const selected = activeRoutine?.id === routine.id;
              return (
                <button
                  key={routine.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => {
                    setSelectedRoutineId(routine.id);
                    setExportError(null);
                  }}
                  className={`min-h-11 min-w-11 rounded-xl border px-4 text-xs font-semibold uppercase tracking-wider pt-motion-gpu active:scale-95 motion-reduce:transform-none motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-primary disabled:cursor-not-allowed disabled:opacity-40 ${
                    selected
                      ? "border-ink-primary bg-ink-primary text-void"
                      : "border-border-strong bg-void text-ink-primary hover:border-ink-primary hover:bg-elevated"
                  }`}
                >
                  {routine.splitTag}
                </button>
              );
            })}
          </div>

          {activeRoutine ? (
            <div className="divide-y divide-border-subtle rounded-xl border border-border-subtle bg-void">
              {activeRoutine.exercises.map((exercise) => {
                const rec =
                  recommendationsByKey.byId.get(exercise.exerciseExternalId) ??
                  recommendationsByKey.byName.get(
                    exercise.exerciseName.trim().toLowerCase(),
                  ) ??
                  null;

                return (
                  <div
                    key={`${activeRoutine.id}-${exercise.exerciseExternalId}`}
                    className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-ink-primary">
                          {exercise.exerciseName}
                        </p>
                        <span className="rounded-full border border-border-subtle bg-elevated px-2 py-0.5 text-[11px] font-medium text-ink-secondary tabular-nums">
                          {exercise.sets} x {exercise.targetReps}
                        </span>
                        {exercise.targetRpe !== null ? (
                          <span className="text-xs font-medium text-accent-strain tabular-nums">
                            RPE {exercise.targetRpe}
                          </span>
                        ) : null}
                        <span className="text-xs text-ink-secondary tabular-nums">
                          Descanso {exercise.restSeconds}s
                        </span>
                      </div>

                      {exercise.notes ? (
                        <p className="text-xs text-ink-secondary">{exercise.notes}</p>
                      ) : null}

                      {rec ? (
                        <p className="text-xs text-accent-recovery tabular-nums">
                          Lift AI: {rec.currentTopKg} kg -&gt;{" "}
                          <strong className="font-semibold">
                            {rec.suggestedKg} kg
                          </strong>{" "}
                          ({formatSignedKg(rec.deltaKg)}) · {rec.rationale}
                        </p>
                      ) : (
                        <p className="text-xs text-ink-secondary">
                          Sin recomendacion Lift AI registrada.
                        </p>
                      )}
                    </div>

                    <div className="shrink-0 rounded-xl border border-border-subtle bg-surface px-3 py-2 text-left sm:text-right">
                      <p className="text-[11px] uppercase tracking-wider text-ink-secondary">
                        e1RM estimado
                      </p>
                      <p className="text-base font-semibold text-ink-primary tabular-nums">
                        {rec ? `${rec.currentE1rmKg.toFixed(1)} kg` : "--"}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-ink-secondary">
              No hay rutinas cargadas en esta cuenta.
            </p>
          )}

          {exportError ? (
            <p
              role="status"
              aria-live="polite"
              className="text-xs font-medium text-accent-danger"
            >
              {exportError}
            </p>
          ) : null}

          {exportedWorkout ? (
            <div className="space-y-3 rounded-xl border border-accent-strain/40 bg-void p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-accent-strain">
                    Forerunner 165 · Garmin Workout Ready
                  </p>
                  <p className="text-sm font-semibold text-ink-primary">
                    {exportedWorkout.workoutName}
                  </p>
                </div>
                <span className="rounded-full border border-border-subtle bg-elevated px-2.5 py-0.5 text-[11px] font-mono text-ink-secondary tabular-nums">
                  {exportedWorkout.sportType}
                </span>
              </div>

              <ol className="space-y-2">
                {exportedWorkout.steps.map((step) => (
                  <li
                    key={`${exportedWorkout.exportId}-${step.stepOrder}`}
                    className="rounded-lg border border-border-subtle bg-surface px-3 py-2 text-xs"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold text-ink-primary tabular-nums">
                        {step.stepOrder}. {step.exerciseName}
                      </span>
                      <span className="font-mono text-[11px] text-ink-secondary tabular-nums">
                        {step.sets} x {step.targetReps} · {step.restSeconds}s
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-accent-strain">
                      {step.garminStepNote}
                    </p>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
        </section>

        <div className="flex flex-col gap-4 lg:col-span-5">
          <section
            aria-labelledby="catalog-heading"
            className="rounded-2xl border border-border-subtle bg-surface p-5"
          >
            <h2
              id="catalog-heading"
              className="text-base font-semibold text-ink-primary"
            >
              Catalogo de ejercicios personalizado
            </h2>
            <p className="mt-0.5 text-xs text-ink-secondary">
              Registra movimientos propios y notas Garmin sin duplicados.
            </p>

            <form
              onSubmit={(e) => void handleCatalogSubmit(e)}
              className="mt-4 space-y-3"
            >
              <div>
                <label
                  htmlFor={catalogNameId}
                  className="block text-xs font-medium text-ink-secondary"
                >
                  Nombre del ejercicio
                </label>
                <input
                  id={catalogNameId}
                  type="text"
                  required
                  value={catalogName}
                  onChange={(e) => setCatalogName(e.target.value)}
                  placeholder="Ej. Bulgarian Split Squat"
                  className="mt-1 min-h-11 w-full rounded-xl border border-border-strong bg-void px-3 text-sm text-ink-primary placeholder:text-ink-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-primary disabled:opacity-40"
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor={catalogMuscleId}
                    className="block text-xs font-medium text-ink-secondary"
                  >
                    Grupo muscular
                  </label>
                  <input
                    id={catalogMuscleId}
                    type="text"
                    value={catalogMuscleGroup}
                    onChange={(e) => setCatalogMuscleGroup(e.target.value)}
                    className="mt-1 min-h-11 w-full rounded-xl border border-border-strong bg-void px-3 text-sm text-ink-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-primary disabled:opacity-40"
                  />
                </div>

                <div>
                  <label
                    htmlFor={catalogEquipmentId}
                    className="block text-xs font-medium text-ink-secondary"
                  >
                    Equipo
                  </label>
                  <input
                    id={catalogEquipmentId}
                    type="text"
                    value={catalogEquipment}
                    onChange={(e) => setCatalogEquipment(e.target.value)}
                    className="mt-1 min-h-11 w-full rounded-xl border border-border-strong bg-void px-3 text-sm text-ink-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-primary disabled:opacity-40"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor={catalogNoteId}
                  className="block text-xs font-medium text-ink-secondary"
                >
                  Nota paso Garmin
                </label>
                <input
                  id={catalogNoteId}
                  type="text"
                  value={catalogStepNote}
                  onChange={(e) => setCatalogStepNote(e.target.value)}
                  placeholder="Ej. Pausa 1 s abajo · RPE 8"
                  className="mt-1 min-h-11 w-full rounded-xl border border-border-strong bg-void px-3 text-sm text-ink-primary placeholder:text-ink-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-primary disabled:opacity-40"
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <button
                  type="submit"
                  disabled={catalogBusy || catalogName.trim().length === 0}
                  aria-busy={catalogBusy}
                  className="min-h-11 min-w-11 rounded-full border border-border-strong bg-elevated px-5 text-xs font-semibold uppercase tracking-wider text-ink-primary pt-motion-gpu hover:border-ink-primary hover:bg-void active:scale-95 motion-reduce:transform-none motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-primary disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {catalogBusy ? "Guardando..." : "Agregar ejercicio"}
                </button>

                {catalogFeedback ? (
                  <p
                    role="status"
                    aria-live="polite"
                    className={`text-xs font-medium ${
                      catalogFeedback.tone === "error"
                        ? "text-accent-danger"
                        : "text-accent-recovery"
                    }`}
                  >
                    {catalogFeedback.text}
                  </p>
                ) : null}
              </div>
            </form>
          </section>

          <section
            aria-labelledby="hevy-csv-heading"
            className="rounded-2xl border border-border-subtle bg-surface p-5"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2
                  id="hevy-csv-heading"
                  className="text-base font-semibold text-ink-primary"
                >
                  Importador CSV de Hevy
                </h2>
                <p className="mt-0.5 text-xs text-ink-secondary">
                  Sube un archivo .csv de Hevy para recalcular sesiones, tonelaje y ACWR.
                </p>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <label
                htmlFor={csvInputId}
                className={`inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-xl border border-border-strong bg-void px-4 text-xs font-semibold uppercase tracking-wider text-ink-primary pt-motion-gpu hover:border-ink-primary hover:bg-elevated active:scale-95 motion-reduce:transform-none motion-reduce:transition-none focus-within:ring-2 focus-within:ring-ink-primary ${
                  hevyBusy ? "pointer-events-none opacity-40" : ""
                }`}
              >
                {hevyBusy ? "Importando CSV..." : "Seleccionar CSV Hevy"}
                <input
                  ref={fileInputRef}
                  id={csvInputId}
                  type="file"
                  accept=".csv,text/csv"
                  disabled={hevyBusy}
                  onChange={(e) => void handleHevyCsvChange(e)}
                  className="sr-only"
                />
              </label>

              {hevyFeedback ? (
                <p
                  role="status"
                  aria-live="polite"
                  className={`text-xs font-medium tabular-nums ${
                    hevyFeedback.tone === "error"
                      ? "text-accent-danger"
                      : "text-accent-recovery"
                  }`}
                >
                  {hevyFeedback.text}
                </p>
              ) : null}
            </div>

            <div className="mt-4 space-y-2 border-t border-border-subtle pt-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-ink-secondary">
                Sesiones recientes
              </p>
              {gymData.sessions.length > 0 ? (
                <ul className="space-y-2">
                  {gymData.sessions.slice(0, 4).map((session) => (
                    <li
                      key={session.externalId}
                      className="flex items-center justify-between gap-3 rounded-xl border border-border-subtle bg-void px-3 py-2 text-xs"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-ink-primary">
                          {session.title}
                        </p>
                        <p className="text-[11px] text-ink-secondary tabular-nums">
                          {session.date} · {session.source}
                        </p>
                      </div>
                      <div className="shrink-0 text-right tabular-nums">
                        <p className="font-semibold text-ink-primary">
                          {formatNumber(session.totalVolumeKg)} kg
                        </p>
                        <p className="text-[11px] text-ink-secondary">
                          {session.sets} series
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-ink-secondary">
                  Sin sesiones importadas aun.
                </p>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
