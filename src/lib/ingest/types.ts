export type HevySetType = "normal" | "warmup" | "dropset" | "failure";

export interface HevySetRecord {
  exerciseExternalId: string;
  exerciseName: string;
  setIndex: number;
  weightKg: number;
  reps: number;
  rpe: number | null;
  setType: HevySetType;
  notes: string | null;
  garminStepNote: string | null;
}

export interface HevyExerciseMeta {
  externalId: string;
  name: string;
  muscleGroup: string | null;
  equipment: string | null;
  isCustom: boolean;
}

export interface HevySessionRecord {
  externalId: string;
  title: string;
  source: "hevy";
  startedAt: string;
  endedAt: string | null;
  totalVolumeKg: number;
  setsCount: number;
  exercises: HevyExerciseMeta[];
  sets: HevySetRecord[];
}

export interface HevyParseResult {
  sessions: HevySessionRecord[];
  exercisesCount: number;
  setsCount: number;
  duplicatesSkipped: number;
  rejectedRows: number;
  warnings: string[];
}

export interface DailyBiometricsSnapshot {
  date: string;
  source: "garmin";
  activeKcal: number;
  restingKcal: number;
  sleepMinutes: number;
  sleepScore: number | null;
  hrvMs: number | null;
  restingHr: number | null;
  bodyBattery: number | null;
  stressAvg: number | null;
  campTempC: number | null;
  campPressureHpa: number | null;
  weatherTempC: number | null;
  weatherHumidityPct: number | null;
  subjEnergy: number | null;
  subjSoreness: number | null;
  subjMood: number | null;
  readinessScore: number;
  strainScore: number;
  acwr: number;
  updatedAt: string;
}

export interface BodyCompositionSnapshot {
  measuredAt: string;
  source: "renpho" | "garmin";
  weightKg: number;
  bodyFatPct: number | null;
  muscleMassKg: number | null;
  waterPct: number | null;
  visceralFat: number | null;
  bmrKcal: number | null;
  syncedToGarmin: boolean;
}

export interface WeatherSnapshot {
  temperatureC: number;
  humidityPct: number;
  apparentTempC: number;
  conditionLabel: string;
  observedAt: string;
  locationLabel: string;
  source: "open-meteo" | "fixture";
}

export interface SubjectiveCheckinPayload {
  date: string;
  subjEnergy: number;
  subjSoreness: number;
  subjMood: number;
}

export interface SyncSnapshotResponse {
  biometrics: DailyBiometricsSnapshot;
  bodyComposition: BodyCompositionSnapshot | null;
  syncMeta: {
    lastSyncAt: string;
    isStale: boolean;
    remainingCooldownMs: number;
    skipped: boolean;
    reason: string;
    mode: "service" | "fixture";
    sources: {
      biometrics: "garmin";
      bodyComposition: "renpho";
    };
  };
}
