export type BiometricAccent = "recovery" | "strain" | "sleep" | "alert";

export interface DailyBiometricsView {
  date: string;
  recoveryScore: number;
  recoveryDelta: string;
  hrvMs: number;
  restingHrBpm: number;
  strainScore: number;
  acwr: number;
  sleepMinutes: number;
  sleepScore: number;
  sleepEfficiencyPct: number;
  activeKcal: number;
  restingKcal: number;
  caloriesConsumed: number;
  caloriesTarget: number;
  bodyBattery: number | null;
  stressAvg: number | null;
  campTempC: number | null;
  campPressureHpa: number | null;
  campActiveKcal: number;
  subjEnergy: number | null;
  subjSoreness: number | null;
  subjMood: number | null;
  source: string;
  updatedAt: string;
}

export interface BodyCompositionView {
  date: string;
  weightKg: number;
  bodyFatPct: number | null;
  muscleMassKg: number | null;
  waterPct: number | null;
  visceralFat: number | null;
  bmrKcal: number | null;
  syncedToGarmin: boolean;
  source: string;
  updatedAt: string;
}

export interface WeatherView {
  id: string;
  locationName: string;
  temperatureC: number;
  apparentTempC: number | null;
  humidityPct: number;
  pressureHpa: number;
  windKmh: number;
  conditionLabel: string;
  source: string;
  fetchedAt: string;
}

export interface HevySessionSummary {
  id: string;
  date: string;
  title: string;
  exercisesCount: number;
  setsCount: number;
  totalVolumeKg: number;
  durationMinutes: number | null;
  source: string;
  importedAt: string;
}

export interface SyncMetaView {
  id: string;
  lastSyncAt: string | null;
  lastWeatherAt: string | null;
  lastSource: string | null;
  lastError: string | null;
  pendingCount: number;
}

export interface SubjectiveCheckinPayload {
  date: string;
  subjEnergy: number;
  subjSoreness: number;
  subjMood: number;
}

export interface HevyCsvQueuePayload {
  csv: string;
  fileName?: string;
}

export type SyncQueueItem =
  | {
      id: string;
      kind: "subjective_checkin";
      endpoint: "/api/biometrics/checkin";
      method: "PATCH";
      payload: SubjectiveCheckinPayload;
      createdAt: string;
      attempts: number;
      lastError: string | null;
      status: "pending" | "failed";
    }
  | {
      id: string;
      kind: "hevy_csv";
      endpoint: "/api/ingest/hevy";
      method: "POST";
      payload: HevyCsvQueuePayload;
      createdAt: string;
      attempts: number;
      lastError: string | null;
      status: "pending" | "failed";
    };

export interface OfflinePulseSnapshot {
  biometrics: DailyBiometricsView;
  bodyComposition: BodyCompositionView | null;
  weather: WeatherView | null;
  hevySessions: readonly HevySessionSummary[];
  meta: SyncMetaView;
  pendingQueue: readonly SyncQueueItem[];
}

export interface HevyImportSummary {
  sessionsCount: number;
  exercisesCount: number;
  setsCount: number;
  duplicatesSkipped: number;
  rejectedRows: number;
}

export interface HevyImportResult {
  ok: boolean;
  queued: boolean;
  summary: HevyImportSummary | null;
  sessions: readonly HevySessionSummary[];
  message: string;
}

export interface SyncExecutionResult {
  synced: boolean;
  skippedDueToSWR: boolean;
  offline: boolean;
  snapshot: OfflinePulseSnapshot;
  error: string | null;
}
