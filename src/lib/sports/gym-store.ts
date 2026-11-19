import {
  buildLiftAiRecommendations,
  calculateDecoupledAcwr,
  calculateSessionTonnage,
  calculateWeeklyTonnage,
} from "@/lib/sports/strength-metrics";
import type {
  AcwrResult,
  BodyCompositionPoint,
  LiftAiRecommendation,
  RoutineTemplate,
  StrengthExerciseCatalogItem,
  StrengthSessionRecord,
  StrengthSetInput,
  WeeklyTonnagePoint,
} from "@/lib/sports/types";

export interface DailyLoad {
  date: string;
  load: number;
}

export interface GymSnapshot {
  routines: RoutineTemplate[];
  sessions: StrengthSessionRecord[];
  weeklyTonnage: WeeklyTonnagePoint[];
  acwr: AcwrResult;
  recommendations: LiftAiRecommendation[];
  recoveryScore: number;
}

interface ActorState {
  catalog: Map<string, StrengthExerciseCatalogItem>;
  routines: RoutineTemplate[];
  sessions: Map<string, StrengthSessionRecord>;
  bodyComposition: Map<string, BodyCompositionPoint>;
}

interface ExerciseSeed {
  name: string;
  muscleGroup: string;
  equipment: string;
  defaultStepNote: string;
  isCustom: boolean;
}

interface RoutineSeedLine {
  name: string;
  equipment: string;
  sets: number;
  targetReps: number;
  targetRpe: number;
  restSeconds: number;
  baseKg: number;
}

const DEFAULT_ACTOR_KEY = "local-owner";
const ACWR_WINDOW_DAYS = 28;
const BODY_SERIES_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

const EXERCISE_SEEDS: readonly ExerciseSeed[] = [
  { name: "Bench Press", muscleGroup: "chest", equipment: "barbell", defaultStepNote: "Pecho en barra, escapulas atras", isCustom: false },
  { name: "Overhead Press", muscleGroup: "shoulders", equipment: "barbell", defaultStepNote: "Press sobre la cabeza, core firme", isCustom: false },
  { name: "Incline Dumbbell Press", muscleGroup: "chest", equipment: "dumbbell", defaultStepNote: "Banco a 30 grados", isCustom: false },
  { name: "Lateral Raise", muscleGroup: "shoulders", equipment: "dumbbell", defaultStepNote: "Codos ligeramente flexionados", isCustom: false },
  { name: "Triceps Pushdown", muscleGroup: "triceps", equipment: "cable", defaultStepNote: "Codos pegados al torso", isCustom: false },
  { name: "Cable Fly Low to High", muscleGroup: "chest", equipment: "cable", defaultStepNote: "Arco amplio, pausa arriba", isCustom: true },
  { name: "Barbell Row", muscleGroup: "back", equipment: "barbell", defaultStepNote: "Torso a 45 grados", isCustom: false },
  { name: "Pull-Up", muscleGroup: "back", equipment: "bodyweight", defaultStepNote: "Rango completo, sin balanceo", isCustom: false },
  { name: "Lat Pulldown", muscleGroup: "back", equipment: "cable", defaultStepNote: "Tira hacia el esternon", isCustom: false },
  { name: "Biceps Curl", muscleGroup: "biceps", equipment: "dumbbell", defaultStepNote: "Sin impulso de cadera", isCustom: false },
  { name: "Face Pull", muscleGroup: "rear_delts", equipment: "cable", defaultStepNote: "Rotacion externa al final", isCustom: true },
  { name: "Back Squat", muscleGroup: "quads", equipment: "barbell", defaultStepNote: "Profundidad paralela", isCustom: false },
  { name: "Romanian Deadlift", muscleGroup: "hamstrings", equipment: "barbell", defaultStepNote: "Espalda neutra, cadera atras", isCustom: false },
  { name: "Leg Press", muscleGroup: "quads", equipment: "machine", defaultStepNote: "No bloquear rodillas", isCustom: false },
  { name: "Leg Curl", muscleGroup: "hamstrings", equipment: "machine", defaultStepNote: "Control en la fase negativa", isCustom: false },
  { name: "Standing Calf Raise", muscleGroup: "calves", equipment: "machine", defaultStepNote: "Pausa de un segundo arriba", isCustom: false },
  { name: "Hip Thrust", muscleGroup: "glutes", equipment: "barbell", defaultStepNote: "Pausa y contraccion arriba", isCustom: true },
];

const ROUTINE_SEEDS: ReadonlyArray<{
  id: string;
  name: string;
  splitTag: RoutineTemplate["splitTag"];
  lines: readonly RoutineSeedLine[];
}> = [
  {
    id: "routine-push",
    name: "Push",
    splitTag: "Push",
    lines: [
      { name: "Bench Press", equipment: "barbell", sets: 4, targetReps: 6, targetRpe: 8, restSeconds: 150, baseKg: 80 },
      { name: "Overhead Press", equipment: "barbell", sets: 3, targetReps: 8, targetRpe: 8, restSeconds: 120, baseKg: 50 },
      { name: "Incline Dumbbell Press", equipment: "dumbbell", sets: 3, targetReps: 10, targetRpe: 8, restSeconds: 90, baseKg: 28 },
      { name: "Lateral Raise", equipment: "dumbbell", sets: 3, targetReps: 12, targetRpe: 9, restSeconds: 60, baseKg: 10 },
      { name: "Cable Fly Low to High", equipment: "cable", sets: 3, targetReps: 12, targetRpe: 8, restSeconds: 60, baseKg: 15 },
      { name: "Triceps Pushdown", equipment: "cable", sets: 3, targetReps: 12, targetRpe: 9, restSeconds: 60, baseKg: 30 },
    ],
  },
  {
    id: "routine-pull",
    name: "Pull",
    splitTag: "Pull",
    lines: [
      { name: "Barbell Row", equipment: "barbell", sets: 4, targetReps: 8, targetRpe: 8, restSeconds: 120, baseKg: 70 },
      { name: "Pull-Up", equipment: "bodyweight", sets: 3, targetReps: 8, targetRpe: 8, restSeconds: 120, baseKg: 10 },
      { name: "Lat Pulldown", equipment: "cable", sets: 3, targetReps: 10, targetRpe: 8, restSeconds: 90, baseKg: 60 },
      { name: "Face Pull", equipment: "cable", sets: 3, targetReps: 15, targetRpe: 8, restSeconds: 60, baseKg: 25 },
      { name: "Biceps Curl", equipment: "dumbbell", sets: 3, targetReps: 12, targetRpe: 9, restSeconds: 60, baseKg: 14 },
    ],
  },
  {
    id: "routine-legs",
    name: "Legs",
    splitTag: "Legs",
    lines: [
      { name: "Back Squat", equipment: "barbell", sets: 4, targetReps: 6, targetRpe: 8, restSeconds: 180, baseKg: 100 },
      { name: "Romanian Deadlift", equipment: "barbell", sets: 3, targetReps: 8, targetRpe: 8, restSeconds: 150, baseKg: 90 },
      { name: "Leg Press", equipment: "machine", sets: 3, targetReps: 12, targetRpe: 8, restSeconds: 120, baseKg: 160 },
      { name: "Hip Thrust", equipment: "barbell", sets: 3, targetReps: 10, targetRpe: 8, restSeconds: 90, baseKg: 100 },
      { name: "Leg Curl", equipment: "machine", sets: 3, targetReps: 12, targetRpe: 9, restSeconds: 60, baseKg: 45 },
      { name: "Standing Calf Raise", equipment: "machine", sets: 4, targetReps: 12, targetRpe: 9, restSeconds: 60, baseKg: 70 },
    ],
  },
];

const actorStates = new Map<string, ActorState>();

export function resolveActorKey(request: Request): string {
  const headerUser = request.headers.get("x-user-id")?.trim();
  if (headerUser && headerUser.length > 0 && headerUser.length <= 64) {
    return headerUser;
  }
  return DEFAULT_ACTOR_KEY;
}

export function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function buildExerciseExternalId(name: string, equipment: string): string {
  return `ex:${slugify(name)}:${slugify(equipment)}`;
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function roundToPlate(value: number): number {
  return Math.round(value / 2.5) * 2.5;
}

function toIsoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function startOfUtcDayMs(ms: number): number {
  return Math.floor(ms / DAY_MS) * DAY_MS;
}

function buildSeedCatalog(): Map<string, StrengthExerciseCatalogItem> {
  const catalog = new Map<string, StrengthExerciseCatalogItem>();
  for (const seed of EXERCISE_SEEDS) {
    const externalId = buildExerciseExternalId(seed.name, seed.equipment);
    catalog.set(externalId, { externalId, ...seed });
  }
  return catalog;
}

function buildSeedRoutines(): RoutineTemplate[] {
  return ROUTINE_SEEDS.map((routine) => ({
    id: routine.id,
    name: routine.name,
    splitTag: routine.splitTag,
    exercises: routine.lines.map((line) => ({
      exerciseExternalId: buildExerciseExternalId(line.name, line.equipment),
      exerciseName: line.name,
      sets: line.sets,
      targetReps: String(line.targetReps),
      targetRpe: line.targetRpe,
      restSeconds: line.restSeconds,
      notes: `${line.sets}x${line.targetReps} RPE ${line.targetRpe}`,
    })),
  }));
}

export function buildSessionExternalId(
  source: string,
  startedAt: string,
  title: string,
): string {
  return `gym-${slugify(source)}-${startedAt}-${slugify(title)}`;
}

export function computeSessionVolume(sets: readonly StrengthSetInput[]): number {
  return roundTo(calculateSessionTonnage(sets), 2);
}

function buildSeedSessions(nowMs: number): Map<string, StrengthSessionRecord> {
  const sessions = new Map<string, StrengthSessionRecord>();
  const todayMs = startOfUtcDayMs(nowMs);
  for (let index = 0; index < ACWR_WINDOW_DAYS; index += 1) {
    const slot = index % 4;
    const routine = ROUTINE_SEEDS[slot];
    if (!routine) {
      continue;
    }
    const dayMs = todayMs - (ACWR_WINDOW_DAYS - 1 - index) * DAY_MS;
    const date = toIsoDate(dayMs);
    const startedAt = `${date}T17:30:00.000Z`;
    const progression = 1 + 0.015 * Math.floor(index / 7);
    const sets: StrengthSetInput[] = [];
    for (const line of routine.lines) {
      const exerciseExternalId = buildExerciseExternalId(line.name, line.equipment);
      const workingKg = roundToPlate(line.baseKg * progression);
      sets.push({
        exerciseExternalId,
        exerciseName: line.name,
        setIndex: 0,
        weightKg: roundToPlate(workingKg * 0.5),
        reps: 8,
        rpe: null,
        setType: "warmup",
        notes: null,
      });
      for (let setIndex = 0; setIndex < line.sets; setIndex += 1) {
        sets.push({
          exerciseExternalId,
          exerciseName: line.name,
          setIndex: setIndex + 1,
          weightKg: workingKg,
          reps: Math.max(1, line.targetReps - (setIndex === line.sets - 1 ? 1 : 0)),
          rpe: Math.min(10, line.targetRpe + (setIndex === line.sets - 1 ? 1 : 0)),
          setType: "normal",
          notes: null,
        });
      }
    }
    const title = routine.name;
    const externalId = buildSessionExternalId("pulsetrack", startedAt, title);
    sessions.set(externalId, {
      externalId,
      title,
      date,
      startedAt,
      source: "pulsetrack",
      totalVolumeKg: computeSessionVolume(sets),
      sets,
    });
  }
  return sessions;
}

function buildSeedBodyComposition(nowMs: number): Map<string, BodyCompositionPoint> {
  const series = new Map<string, BodyCompositionPoint>();
  const todayMs = startOfUtcDayMs(nowMs);
  for (let index = 0; index < BODY_SERIES_DAYS; index += 1) {
    const dayMs = todayMs - (BODY_SERIES_DAYS - 1 - index) * DAY_MS;
    const date = toIsoDate(dayMs);
    const measuredAt = `${date}T06:30:00.000Z`;
    const point: BodyCompositionPoint = {
      measuredAt,
      date,
      source: "renpho",
      weightKg: roundTo(78.4 - 0.03 * index + 0.25 * Math.sin(index * 1.3), 2),
      bodyFatPct: roundTo(17.8 - 0.04 * index + 0.15 * Math.sin(index * 0.9), 2),
      muscleMassKg: roundTo(35.6 + 0.02 * index + 0.1 * Math.sin(index * 1.1), 2),
      waterPct: roundTo(57.2 + 0.015 * index + 0.2 * Math.sin(index * 0.7), 2),
      visceralFat: roundTo(6 - 0.01 * index, 1),
      bmrKcal: Math.round(1780 + 0.8 * index + 6 * Math.sin(index * 0.5)),
      syncedToGarmin: true,
    };
    series.set(`${measuredAt}|renpho`, point);
  }
  return series;
}

export function getActorState(actorKey: string): ActorState {
  const existing = actorStates.get(actorKey);
  if (existing) {
    return existing;
  }
  const nowMs = Date.now();
  const state: ActorState = {
    catalog: buildSeedCatalog(),
    routines: buildSeedRoutines(),
    sessions: buildSeedSessions(nowMs),
    bodyComposition: buildSeedBodyComposition(nowMs),
  };
  actorStates.set(actorKey, state);
  return state;
}

export function resetGymStore(): void {
  actorStates.clear();
}

export function listCatalog(actorKey: string): StrengthExerciseCatalogItem[] {
  return [...getActorState(actorKey).catalog.values()].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
}

export function insertCustomExercise(
  actorKey: string,
  input: { name: string; muscleGroup: string; equipment: string; defaultStepNote: string },
): { item: StrengthExerciseCatalogItem; deduplicated: boolean } {
  const state = getActorState(actorKey);
  const externalId = buildExerciseExternalId(input.name, input.equipment);
  const existing = state.catalog.get(externalId);
  if (existing) {
    return { item: existing, deduplicated: true };
  }
  const item: StrengthExerciseCatalogItem = {
    externalId,
    name: input.name,
    muscleGroup: input.muscleGroup,
    equipment: input.equipment,
    defaultStepNote: input.defaultStepNote || null,
    isCustom: true,
  };
  state.catalog.set(externalId, item);
  return { item, deduplicated: false };
}

export function findRoutine(actorKey: string, routineId: string): RoutineTemplate | undefined {
  return getActorState(actorKey).routines.find((routine) => routine.id === routineId);
}

export function insertSession(
  actorKey: string,
  session: StrengthSessionRecord,
): { session: StrengthSessionRecord; deduplicated: boolean } {
  const state = getActorState(actorKey);
  const existing = state.sessions.get(session.externalId);
  if (existing) {
    return { session: existing, deduplicated: true };
  }
  state.sessions.set(session.externalId, session);
  return { session, deduplicated: false };
}

function buildDailyLoads(sessions: readonly StrengthSessionRecord[], nowMs: number): DailyLoad[] {
  const todayMs = startOfUtcDayMs(nowMs);
  const loadByDate = new Map<string, number>();
  for (const session of sessions) {
    loadByDate.set(session.date, (loadByDate.get(session.date) ?? 0) + session.totalVolumeKg);
  }
  const loads: DailyLoad[] = [];
  for (let offset = ACWR_WINDOW_DAYS - 1; offset >= 0; offset -= 1) {
    const date = toIsoDate(todayMs - offset * DAY_MS);
    loads.push({ date, load: roundTo(loadByDate.get(date) ?? 0, 2) });
  }
  return loads;
}

export function computeRecoveryScore(acwr: AcwrResult): number {
  const raw = 85 - (acwr.ratio - 1) * 40;
  return Math.min(98, Math.max(20, Math.round(raw)));
}

export function buildGymSnapshot(actorKey: string, nowMs: number = Date.now()): GymSnapshot {
  const state = getActorState(actorKey);
  const sessionsAsc = [...state.sessions.values()].sort((a, b) =>
    a.startedAt.localeCompare(b.startedAt),
  );
  const acwr = calculateDecoupledAcwr(buildDailyLoads(sessionsAsc, nowMs));
  const recoveryScore = computeRecoveryScore(acwr);
  return {
    routines: state.routines,
    sessions: [...sessionsAsc].reverse(),
    weeklyTonnage: calculateWeeklyTonnage(sessionsAsc),
    acwr,
    recommendations: buildLiftAiRecommendations(sessionsAsc, acwr, recoveryScore),
    recoveryScore,
  };
}

export function listBodyComposition(actorKey: string): BodyCompositionPoint[] {
  return [...getActorState(actorKey).bodyComposition.values()].sort((a, b) =>
    a.measuredAt.localeCompare(b.measuredAt),
  );
}

export function insertBodyComposition(
  actorKey: string,
  point: BodyCompositionPoint,
): { point: BodyCompositionPoint; deduplicated: boolean } {
  const state = getActorState(actorKey);
  const key = `${point.measuredAt}|${point.source}`;
  const existing = state.bodyComposition.get(key);
  if (existing) {
    return { point: existing, deduplicated: true };
  }
  state.bodyComposition.set(key, point);
  return { point, deduplicated: false };
}
