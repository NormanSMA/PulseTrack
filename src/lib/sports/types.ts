export type AcwrZone = "undertraining" | "optimal" | "caution" | "high_risk";

export interface StrengthSetInput {
  exerciseExternalId: string;
  exerciseName: string;
  setIndex: number;
  weightKg: number;
  reps: number;
  rpe: number | null;
  setType?: "normal" | "warmup" | "dropset" | "failure";
  notes?: string | null;
}

export interface StrengthExerciseCatalogItem {
  externalId: string;
  name: string;
  muscleGroup: string;
  equipment: string;
  isCustom: boolean;
  defaultStepNote: string | null;
}

export interface RoutineExercisePlan {
  exerciseExternalId: string;
  exerciseName: string;
  sets: number;
  targetReps: string;
  targetRpe: number;
  restSeconds: number;
  notes: string | null;
}

export interface RoutineTemplate {
  id: string;
  name: string;
  splitTag: "Push" | "Pull" | "Legs" | "Custom";
  exercises: RoutineExercisePlan[];
}

export interface StrengthSessionRecord {
  externalId: string;
  title: string;
  date: string;
  startedAt: string;
  source: "hevy" | "pulsetrack";
  totalVolumeKg: number;
  sets: StrengthSetInput[];
}

export interface WeeklyTonnagePoint {
  weekStart: string;
  tonnageKg: number;
  sessionsCount: number;
}

export interface AcwrResult {
  acuteLoad: number;
  chronicLoad: number;
  ratio: number;
  zone: AcwrZone;
  label: string;
}

export interface LiftAiRecommendation {
  exerciseExternalId: string;
  exerciseName: string;
  currentTopKg: number;
  currentE1rmKg: number;
  suggestedKg: number;
  deltaKg: number;
  rationale: string;
}

export interface GarminWorkoutStep {
  stepOrder: number;
  exerciseCategory: string;
  exerciseName: string;
  sets: number;
  targetReps: string;
  restSeconds: number;
  garminStepNote: string;
}

export interface GarminStrengthWorkoutExport {
  exportId: string;
  routineId: string;
  workoutName: string;
  sportType: "STRENGTH_TRAINING";
  generatedAt: string;
  steps: GarminWorkoutStep[];
}

export interface BodyCompositionPoint {
  measuredAt: string;
  date: string;
  source: "renpho" | "garmin";
  weightKg: number;
  bodyFatPct: number | null;
  muscleMassKg: number | null;
  waterPct: number | null;
  visceralFat: number | null;
  bmrKcal: number | null;
  syncedToGarmin: boolean;
}
