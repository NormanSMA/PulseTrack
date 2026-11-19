import type {
  AcwrResult,
  AcwrZone,
  GarminStrengthWorkoutExport,
  LiftAiRecommendation,
  RoutineTemplate,
  StrengthSessionRecord,
  StrengthSetInput,
  WeeklyTonnagePoint,
} from "./types";

const DAY_MS = 86_400_000;
const ACUTE_ALPHA = 2 / 8;
const CHRONIC_ALPHA = 2 / 29;
const WEIGHT_INCREMENT_KG = 2.5;

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  const scaled = value * factor;
  return scaled < Number.MAX_SAFE_INTEGER ? Math.round(scaled + scaled * Number.EPSILON) / factor : value;
}

function hasValidSetLoad({ weightKg, reps }: StrengthSetInput): boolean {
  return Number.isFinite(weightKg) && weightKg >= 0 && Number.isFinite(reps) && reps > 0;
}

function parseIsoDay(date: string): number {
  if (!/^\d{4}-\d{2}-\d{2}(?:$|[T ])/.test(date)) return NaN;
  const day = date.slice(0, 10);
  const timestamp = Date.parse(day);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().startsWith(day) ? timestamp : NaN;
}

function sessionDay(session: StrengthSessionRecord): number {
  const date = session.date?.trim();
  if (date) return parseIsoDay(date);

  const isoDay = parseIsoDay(session.startedAt);
  if (Number.isFinite(isoDay) || !/\b\d{4}\b/.test(session.startedAt)) return isoDay;

  // Hevy también importa fechas de calendario con mes textual.
  const startedAt = new Date(session.startedAt);
  return Date.UTC(startedAt.getFullYear(), startedAt.getMonth(), startedAt.getDate());
}

export function calculateEpley1RM(weightKg: number, reps: number): number {
  if (!Number.isFinite(weightKg) || weightKg <= 0 || !Number.isInteger(reps) || reps <= 0) return 0;
  return round(reps === 1 ? weightKg : weightKg * (1 + reps / 30), 2);
}

export function calculateSessionTonnage(sets: readonly StrengthSetInput[], includeWarmup = false): number {
  let tonnageKg = 0;
  for (const set of sets) {
    if (hasValidSetLoad(set) && (includeWarmup || set.setType !== "warmup")) {
      tonnageKg += set.weightKg * set.reps;
    }
  }
  return round(tonnageKg, 2);
}

export function calculateWeeklyTonnage(sessions: readonly StrengthSessionRecord[]): WeeklyTonnagePoint[] {
  const weeks = new Map<string, WeeklyTonnagePoint>();
  for (const session of sessions) {
    const day = sessionDay(session);
    if (!Number.isFinite(day)) continue;

    const monday = new Date(day);
    monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
    const weekStart = monday.toISOString().slice(0, 10);
    const week = weeks.get(weekStart) ?? { weekStart, tonnageKg: 0, sessionsCount: 0 };
    if (Number.isFinite(session.totalVolumeKg) && session.totalVolumeKg >= 0) {
      week.tonnageKg += session.totalVolumeKg;
    }
    week.sessionsCount++;
    weeks.set(weekStart, week);
  }

  return Array.from(weeks.values())
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart))
    .map((week) => ({ ...week, tonnageKg: round(week.tonnageKg, 2) }));
}

const ACWR_LABELS: Record<AcwrZone, string> = {
  undertraining: "Carga baja",
  optimal: "Carga óptima",
  caution: "Precaución",
  high_risk: "Riesgo alto",
};

function acwrZone(ratio: number): AcwrZone {
  if (ratio < 0.8) return "undertraining";
  if (ratio <= 1.3) return "optimal";
  if (ratio <= 1.5) return "caution";
  return "high_risk";
}

export function calculateDecoupledAcwr(dailyLoads: readonly { date: string; load: number }[]): AcwrResult {
  const loadsByDay = new Map<number, number>();
  for (const { date, load } of dailyLoads) {
    const day = parseIsoDay(date);
    if (Number.isFinite(day) && Number.isFinite(load) && load >= 0) {
      loadsByDay.set(day, (loadsByDay.get(day) ?? 0) + load);
    }
  }

  const [first, ...remaining] = Array.from(loadsByDay).sort(([dayA], [dayB]) => dayA - dayB);
  let previousDay = first?.[0] ?? 0;
  let acuteLoad = first?.[1] ?? 0;
  let chronicLoad = remaining.length > 0 ? acuteLoad : 0;
  remaining.forEach(([day, load], index) => {
    const missingDays = (day - previousDay) / DAY_MS - 1;
    acuteLoad = ACUTE_ALPHA * load + acuteLoad * (1 - ACUTE_ALPHA) ** (missingDays + 1);
    // Los días sin carga aplican decaimiento. La carga crónica excluye el último pulso.
    chronicLoad *= (1 - CHRONIC_ALPHA) ** missingDays;
    if (index < remaining.length - 1) {
      chronicLoad = CHRONIC_ALPHA * load + chronicLoad * (1 - CHRONIC_ALPHA);
    }
    previousDay = day;
  });

  const ratio = chronicLoad > 0 ? acuteLoad / chronicLoad : 0;
  const zone = acwrZone(ratio);
  return { acuteLoad: round(acuteLoad, 2), chronicLoad: round(chronicLoad, 2), ratio: round(ratio, 3), zone, label: ACWR_LABELS[zone] };
}

function sessionStartTime(session: StrengthSessionRecord): number {
  const startedAt = Date.parse(session.startedAt);
  if (Number.isFinite(startedAt)) return startedAt;

  const day = sessionDay(session);
  return Number.isFinite(day) ? day : -Infinity;
}

export function buildLiftAiRecommendations(
  sessions: readonly StrengthSessionRecord[],
  acwr: AcwrResult,
  recoveryScore: number,
): LiftAiRecommendation[] {
  type LiftHistory = Omit<LiftAiRecommendation, "suggestedKg" | "deltaKg" | "rationale"> & { latestRpe: number | null };
  const lifts = new Map<string, LiftHistory>();
  const recentSessions = [...sessions].sort((a, b) => sessionStartTime(b) - sessionStartTime(a));
  for (const session of recentSessions) {
    const recentSets = [...session.sets].sort((a, b) => b.setIndex - a.setIndex);
    for (const set of recentSets) {
      if (!hasValidSetLoad(set) || !Number.isInteger(set.reps)) continue;

      const { exerciseExternalId, exerciseName, weightKg, reps, rpe } = set;
      const e1rmKg = calculateEpley1RM(weightKg, reps);
      const lift = lifts.get(exerciseExternalId);
      if (lift) {
        lift.currentTopKg = Math.max(lift.currentTopKg, weightKg);
        lift.currentE1rmKg = Math.max(lift.currentE1rmKg, e1rmKg);
      } else {
        lifts.set(exerciseExternalId, { exerciseExternalId, exerciseName, currentTopKg: weightKg, currentE1rmKg: e1rmKg, latestRpe: rpe });
      }
    }
  }

  return Array.from(lifts.values(), ({ latestRpe, ...lift }) => {
    const { currentTopKg } = lift;
    if (acwr.zone === "high_risk" || recoveryScore < 50) {
      const roundedSteps = Math.round(currentTopKg * 0.9 / WEIGHT_INCREMENT_KG);
      const maxSteps = Math.floor(currentTopKg / WEIGHT_INCREMENT_KG);
      const suggestedKg = Math.min(roundedSteps, maxSteps) * WEIGHT_INCREMENT_KG;
      const rationale = acwr.zone === "high_risk" ? "Reduce la carga por riesgo alto." : "Reduce la carga por recuperación baja.";
      return { ...lift, suggestedKg, deltaKg: suggestedKg - currentTopKg, rationale };
    }

    const canProgress = latestRpe === null || (Number.isFinite(latestRpe) && latestRpe <= 8.5);
    if (acwr.zone === "optimal" && recoveryScore >= 70 && canProgress) {
      return { ...lift, suggestedKg: currentTopKg + WEIGHT_INCREMENT_KG, deltaKg: WEIGHT_INCREMENT_KG, rationale: "Aumenta la carga según el ACWR y la recuperación." };
    }
    return { ...lift, suggestedKg: currentTopKg, deltaKg: 0, rationale: "Mantén la carga y revisa el ACWR, la recuperación y el RPE." };
  });
}

const GARMIN_CATEGORIES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b(squats?|sentadillas?)\b/, "SQUAT"],
  [/\b(bench press|chest press|press (?:de )?(?:banca|pecho))\b/, "BENCH_PRESS"],
  [/\b(deadlifts?|pesos? muertos?)\b/, "DEADLIFT"],
  [/\b((?:pull|chin) ups?|dominadas?)\b/, "PULL_UP"],
  [/\b(rows?|remos?)\b/, "ROW"],
  [/\b((?:shoulder|overhead|military|arnold) press|press (?:militar|(?:de )?hombros?))\b/, "SHOULDER_PRESS"],
  [/\b(core|planks?|planchas?|crunch(?:es)?|sit ups?|abdominal(?:es)?)\b/, "CORE"],
];

function garminExerciseCategory(exerciseName: string): string {
  const normalizedName = exerciseName.toLowerCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ");
  return GARMIN_CATEGORIES.find(([pattern]) => pattern.test(normalizedName))?.[1] ?? "STRENGTH_CUSTOM";
}

function fnv1a64(text: string): string {
  let value = BigInt("0xcbf29ce484222325");
  const prime = BigInt("0x100000001b3");
  new TextEncoder().encode(text).forEach((byte) => {
    value = BigInt.asUintN(64, (value ^ BigInt(byte)) * prime);
  });
  return value.toString(16).padStart(16, "0");
}

export function buildGarminStrengthWorkoutExport(
  routine: RoutineTemplate,
  generatedAt = new Date().toISOString(),
): GarminStrengthWorkoutExport {
  const whitespaceOrControl = new RegExp("[\\s\\p{Cc}]+", "gu");
  const steps = routine.exercises.map((exercise, index) => {
    const { exerciseName, sets, targetReps, targetRpe, restSeconds, notes } = exercise;
    const garminStepNote = [exerciseName, `RPE ${targetRpe}`, notes ?? ""]
      .map((part) => part.replace(whitespaceOrControl, " ").trim()).filter(Boolean).join(" | ")
      .slice(0, 200).replace(/[\ud800-\udbff]$/, "").trimEnd();
    return { stepOrder: index + 1, exerciseCategory: garminExerciseCategory(exerciseName), exerciseName, sets, targetReps, restSeconds, garminStepNote };
  });

  return {
    exportId: `garmin-wo-${fnv1a64(JSON.stringify([routine.id, routine.name, steps]))}`,
    routineId: routine.id,
    workoutName: routine.name,
    sportType: "STRENGTH_TRAINING",
    generatedAt,
    steps,
  };
}
