import {
  META_KEY,
  WEATHER_KEY,
  enqueueItem,
  getSnapshotMemorySync,
  listQueueItems,
  readSnapshot,
  removeQueueItem,
  updateQueueItem,
  upsertBiometrics,
  upsertHevySessions,
  upsertSyncMeta,
  upsertWeather,
  writeSnapshotAtomic,
} from "@/lib/offline/idb-store";
import type {
  BodyCompositionView,
  DailyBiometricsView,
  HevyImportResult,
  HevyImportSummary,
  HevySessionSummary,
  OfflinePulseSnapshot,
  SubjectiveCheckinPayload,
  SyncExecutionResult,
  SyncMetaView,
  SyncQueueItem,
  WeatherView,
} from "@/lib/offline/types";

export const STALE_WINDOW_MS = 15 * 60 * 1000;
export const WEATHER_TTL_MS = 60 * 60 * 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(obj: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const val = obj[key];
    if (typeof val === "string" && val.length > 0) {
      return val;
    }
  }
  return null;
}

function readNumber(obj: Record<string, unknown>, ...keys: string[]): number | null {
  for (const key of keys) {
    const val = obj[key];
    if (typeof val === "number" && Number.isFinite(val)) {
      return val;
    }
  }
  return null;
}

function readBoolean(obj: Record<string, unknown>, ...keys: string[]): boolean | null {
  for (const key of keys) {
    const val = obj[key];
    if (typeof val === "boolean") {
      return val;
    }
  }
  return null;
}

function readErrorMessage(raw: unknown, fallback: string): string {
  if (!isRecord(raw)) {
    return fallback;
  }
  return readString(raw, "error", "message") ?? fallback;
}

export function isNavigatorOnline(): boolean {
  if (typeof navigator === "undefined") {
    return true;
  }
  return navigator.onLine !== false;
}

export function isSyncStale(lastSyncAt: string | null, nowMs = Date.now()): boolean {
  if (!lastSyncAt) {
    return true;
  }
  const parsed = Date.parse(lastSyncAt);
  if (!Number.isFinite(parsed)) {
    return true;
  }
  return nowMs - parsed >= STALE_WINDOW_MS;
}

export function getRemainingCooldownMs(lastSyncAt: string | null, nowMs = Date.now()): number {
  if (!lastSyncAt) {
    return 0;
  }
  const parsed = Date.parse(lastSyncAt);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  const elapsed = nowMs - parsed;
  return Math.max(0, STALE_WINDOW_MS - elapsed);
}

export async function loadSnapshotInstant(): Promise<OfflinePulseSnapshot> {
  return readSnapshot();
}

export function getInstantMemorySnapshot(): OfflinePulseSnapshot {
  return getSnapshotMemorySync();
}

function createQueueId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function validateSubjectiveScale(value: number, fieldName: string): number {
  if (!Number.isInteger(value) || value < 1 || value > 5) {
    throw new Error(`${fieldName} debe ser un entero entre 1 y 5.`);
  }
  return value;
}

function mergeBiometricsFromUnknown(
  raw: unknown,
  fallback: DailyBiometricsView,
  nowIso: string,
): DailyBiometricsView {
  if (!isRecord(raw)) {
    return fallback;
  }
  return {
    date: readString(raw, "date", "record_date") ?? fallback.date,
    recoveryScore: readNumber(raw, "recoveryScore", "recovery_score") ?? fallback.recoveryScore,
    recoveryDelta: readString(raw, "recoveryDelta", "recovery_delta") ?? fallback.recoveryDelta,
    hrvMs: readNumber(raw, "hrvMs", "hrv_ms") ?? fallback.hrvMs,
    restingHrBpm:
      readNumber(raw, "restingHrBpm", "resting_hr_bpm", "restingHr", "resting_hr") ??
      fallback.restingHrBpm,
    strainScore: readNumber(raw, "strainScore", "strain_score") ?? fallback.strainScore,
    acwr: readNumber(raw, "acwr") ?? fallback.acwr,
    sleepMinutes: readNumber(raw, "sleepMinutes", "sleep_minutes") ?? fallback.sleepMinutes,
    sleepScore: readNumber(raw, "sleepScore", "sleep_score") ?? fallback.sleepScore,
    sleepEfficiencyPct:
      readNumber(raw, "sleepEfficiencyPct", "sleep_efficiency_pct") ?? fallback.sleepEfficiencyPct,
    activeKcal: readNumber(raw, "activeKcal", "active_kcal") ?? fallback.activeKcal,
    restingKcal: readNumber(raw, "restingKcal", "resting_kcal") ?? fallback.restingKcal,
    caloriesConsumed:
      readNumber(raw, "caloriesConsumed", "calories_consumed") ?? fallback.caloriesConsumed,
    caloriesTarget:
      readNumber(raw, "caloriesTarget", "calories_target") ?? fallback.caloriesTarget,
    bodyBattery: readNumber(raw, "bodyBattery", "body_battery") ?? fallback.bodyBattery,
    stressAvg: readNumber(raw, "stressAvg", "stress_avg") ?? fallback.stressAvg,
    campTempC: readNumber(raw, "campTempC", "camp_temp_c") ?? fallback.campTempC,
    campPressureHpa:
      readNumber(raw, "campPressureHpa", "camp_pressure_hpa") ?? fallback.campPressureHpa,
    campActiveKcal: 0,
    subjEnergy: readNumber(raw, "subjEnergy", "subj_energy") ?? fallback.subjEnergy,
    subjSoreness: readNumber(raw, "subjSoreness", "subj_soreness") ?? fallback.subjSoreness,
    subjMood: readNumber(raw, "subjMood", "subj_mood") ?? fallback.subjMood,
    source: readString(raw, "source") ?? fallback.source,
    updatedAt: readString(raw, "updatedAt", "updated_at") ?? nowIso,
  };
}

function mergeBodyCompositionFromUnknown(
  raw: unknown,
  fallback: BodyCompositionView | null,
  nowIso: string,
): BodyCompositionView | null {
  if (!isRecord(raw)) {
    return fallback;
  }
  const weightKg = readNumber(raw, "weightKg", "weight_kg");
  if (weightKg === null) {
    return fallback;
  }
  return {
    date:
      readString(raw, "date", "record_date", "measuredAt", "measured_at")?.slice(0, 10) ??
      fallback?.date ??
      nowIso.slice(0, 10),
    weightKg,
    bodyFatPct: readNumber(raw, "bodyFatPct", "body_fat_pct") ?? fallback?.bodyFatPct ?? null,
    muscleMassKg:
      readNumber(raw, "muscleMassKg", "muscle_mass_kg") ?? fallback?.muscleMassKg ?? null,
    waterPct: readNumber(raw, "waterPct", "water_pct") ?? fallback?.waterPct ?? null,
    visceralFat: readNumber(raw, "visceralFat", "visceral_fat") ?? fallback?.visceralFat ?? null,
    bmrKcal: readNumber(raw, "bmrKcal", "bmr_kcal") ?? fallback?.bmrKcal ?? null,
    syncedToGarmin:
      readBoolean(raw, "syncedToGarmin", "synced_to_garmin") ?? fallback?.syncedToGarmin ?? true,
    source: readString(raw, "source") ?? fallback?.source ?? "RENPHO + Garmin",
    updatedAt: readString(raw, "updatedAt", "updated_at") ?? nowIso,
  };
}

function parseWeatherFromUnknown(
  raw: unknown,
  fallback: WeatherView | null,
  nowIso: string,
): WeatherView | null {
  if (!isRecord(raw)) {
    return fallback;
  }
  const candidate = isRecord(raw.weather) ? raw.weather : raw;
  const temperatureC = readNumber(candidate, "temperatureC", "temperature_c", "tempC");
  if (temperatureC === null) {
    return fallback;
  }
  return {
    id: WEATHER_KEY,
    locationName:
      readString(candidate, "locationName", "location_name", "city") ??
      fallback?.locationName ??
      "Managua",
    temperatureC,
    apparentTempC:
      readNumber(candidate, "apparentTempC", "apparent_temp_c") ?? fallback?.apparentTempC ?? null,
    humidityPct:
      readNumber(candidate, "humidityPct", "humidity_pct", "humidity") ??
      fallback?.humidityPct ??
      65,
    pressureHpa:
      readNumber(candidate, "pressureHpa", "pressure_hpa", "pressure") ??
      fallback?.pressureHpa ??
      1013,
    windKmh: readNumber(candidate, "windKmh", "wind_kmh", "windSpeedKmh") ?? fallback?.windKmh ?? 10,
    conditionLabel:
      readString(candidate, "conditionLabel", "condition_label", "condition") ??
      fallback?.conditionLabel ??
      "Despejado",
    source:
      readString(candidate, "source") ??
      readString(raw, "source") ??
      fallback?.source ??
      "open-meteo",
    fetchedAt:
      readString(candidate, "fetchedAt", "fetched_at") ??
      readString(raw, "fetchedAt", "fetched_at") ??
      nowIso,
  };
}

function parseHevySessionsFromUnknown(
  raw: unknown,
  nowIso: string,
): HevySessionSummary[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const result: HevySessionSummary[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const item = raw[i];
    if (!isRecord(item)) {
      continue;
    }
    const id =
      readString(item, "id", "externalId", "sessionId", "session_id") ??
      `hevy-${nowIso}-${i}`;
    const title = readString(item, "title", "workoutTitle", "name") ?? "Hevy Workout";
    const date =
      readString(item, "date", "startedAt", "startTime", "sessionDate")?.slice(0, 10) ??
      nowIso.slice(0, 10);
    const exercisesCount =
      readNumber(item, "exercisesCount", "exercises_count") ??
      (Array.isArray(item.exercises) ? item.exercises.length : 1);
    const setsCount = readNumber(item, "setsCount", "sets_count", "totalSets") ?? 0;
    const totalVolumeKg = readNumber(item, "totalVolumeKg", "total_volume_kg", "volumeKg") ?? 0;
    const durationMinutes = readNumber(item, "durationMinutes", "duration_minutes");

    result.push({
      id,
      date,
      title,
      exercisesCount,
      setsCount,
      totalVolumeKg,
      durationMinutes,
      source: readString(item, "source") ?? "hevy_csv",
      importedAt: readString(item, "importedAt", "imported_at") ?? nowIso,
    });
  }
  return result;
}

function parseHevySummaryFromUnknown(raw: unknown): HevyImportSummary | null {
  if (!isRecord(raw)) {
    return null;
  }
  const sessionsCount = readNumber(raw, "sessionsCount", "sessions_count");
  const exercisesCount = readNumber(raw, "exercisesCount", "exercises_count");
  const setsCount = readNumber(raw, "setsCount", "sets_count");
  if (sessionsCount === null || exercisesCount === null || setsCount === null) {
    return null;
  }
  return {
    sessionsCount,
    exercisesCount,
    setsCount,
    duplicatesSkipped: readNumber(raw, "duplicatesSkipped", "duplicates_skipped") ?? 0,
    rejectedRows: readNumber(raw, "rejectedRows", "rejected_rows") ?? 0,
  };
}

export async function fetchWeatherWithFallback(): Promise<WeatherView | null> {
  const current = await readSnapshot();
  if (!isNavigatorOnline()) {
    return current.weather;
  }

  try {
    const res = await fetch("/api/weather", { method: "GET" });
    if (!res.ok) {
      return current.weather;
    }
    const json: unknown = await res.json();
    const nowIso = new Date().toISOString();
    const parsed = parseWeatherFromUnknown(json, current.weather, nowIso);
    if (parsed) {
      await upsertWeather(parsed);
      return parsed;
    }
    return current.weather;
  } catch {
    return current.weather;
  }
}

export interface FlushQueueResult {
  flushed: number;
  remaining: number;
  failed: number;
}

export async function flushSyncQueue(): Promise<FlushQueueResult> {
  const items = await listQueueItems();
  if (items.length === 0) {
    return { flushed: 0, remaining: 0, failed: 0 };
  }
  if (!isNavigatorOnline()) {
    return { flushed: 0, remaining: items.length, failed: 0 };
  }

  let flushed = 0;
  let failed = 0;
  const nowIso = new Date().toISOString();

  for (const item of items) {
    if (item.status === "failed" && item.attempts >= 3) {
      failed += 1;
      continue;
    }

    try {
      const bodyPayload =
        item.kind === "subjective_checkin"
          ? JSON.stringify(item.payload)
          : JSON.stringify({ csv: item.payload.csv });

      const res = await fetch(item.endpoint, {
        method: item.method,
        headers: { "Content-Type": "application/json" },
        body: bodyPayload,
      });

      if (res.ok) {
        if (item.kind === "hevy_csv") {
          const data: unknown = await res.json().catch(() => null);
          if (isRecord(data) && Array.isArray(data.sessions)) {
            const sessions = parseHevySessionsFromUnknown(data.sessions, nowIso);
            if (sessions.length > 0) {
              await upsertHevySessions(sessions);
            }
          }
        }
        await removeQueueItem(item.id);
        flushed += 1;
      } else {
        const isClientRejection = res.status >= 400 && res.status < 500;
        const nextItem: SyncQueueItem = {
          ...item,
          attempts: item.attempts + 1,
          lastError: `HTTP ${res.status}`,
          status: isClientRejection ? "failed" : "pending",
        };
        await updateQueueItem(nextItem);
        if (isClientRejection) {
          failed += 1;
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Error de red";
      await updateQueueItem({
        ...item,
        attempts: item.attempts + 1,
        lastError: message,
        status: "pending",
      });
    }
  }

  const remainingItems = await listQueueItems();
  return {
    flushed,
    remaining: remainingItems.length,
    failed,
  };
}

export interface CheckinSubmitResult {
  synced: boolean;
  queued: boolean;
  snapshot: OfflinePulseSnapshot;
  error: string | null;
}

export async function enqueueSubjectiveCheckin(
  payload: SubjectiveCheckinPayload,
): Promise<CheckinSubmitResult> {
  const subjEnergy = validateSubjectiveScale(payload.subjEnergy, "Energia");
  const subjSoreness = validateSubjectiveScale(payload.subjSoreness, "Dolor muscular");
  const subjMood = validateSubjectiveScale(payload.subjMood, "Animo");

  const current = await readSnapshot();
  const nowIso = new Date().toISOString();
  const targetDate = payload.date || current.biometrics.date;

  const optimisticBiometrics: DailyBiometricsView = {
    ...current.biometrics,
    date: targetDate,
    subjEnergy,
    subjSoreness,
    subjMood,
    updatedAt: nowIso,
  };

  await upsertBiometrics(optimisticBiometrics);

  const normalizedPayload: SubjectiveCheckinPayload = {
    date: targetDate,
    subjEnergy,
    subjSoreness,
    subjMood,
  };

  const queueItem: SyncQueueItem = {
    id: createQueueId("checkin"),
    kind: "subjective_checkin",
    endpoint: "/api/biometrics/checkin",
    method: "PATCH",
    payload: normalizedPayload,
    createdAt: nowIso,
    attempts: 0,
    lastError: null,
    status: "pending",
  };

  if (!isNavigatorOnline()) {
    await enqueueItem(queueItem);
    const snapshot = await readSnapshot();
    return { synced: false, queued: true, snapshot, error: null };
  }

  try {
    const res = await fetch("/api/biometrics/checkin", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(normalizedPayload),
    });

    if (res.ok) {
      const snapshot = await readSnapshot();
      return { synced: true, queued: false, snapshot, error: null };
    }

    if (res.status >= 500) {
      await enqueueItem({
        ...queueItem,
        attempts: 1,
        lastError: `HTTP ${res.status}`,
      });
      const snapshot = await readSnapshot();
      return { synced: false, queued: true, snapshot, error: null };
    }

    const errBody: unknown = await res.json().catch(() => null);
    const errMsg = readErrorMessage(errBody, `Error al guardar check-in (${res.status})`);
    const snapshot = await readSnapshot();
    return { synced: false, queued: false, snapshot, error: errMsg };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error de red";
    await enqueueItem({
      ...queueItem,
      attempts: 1,
      lastError: message,
    });
    const snapshot = await readSnapshot();
    return { synced: false, queued: true, snapshot, error: null };
  }
}

export async function importHevyCsvFile(
  csvText: string,
  fileName?: string,
): Promise<HevyImportResult> {
  if (csvText.trim().length === 0) {
    return {
      ok: false,
      queued: false,
      summary: null,
      sessions: [],
      message: "El archivo CSV esta vacio.",
    };
  }

  const nowIso = new Date().toISOString();
  const queueItem: SyncQueueItem = {
    id: createQueueId("hevy"),
    kind: "hevy_csv",
    endpoint: "/api/ingest/hevy",
    method: "POST",
    payload: { csv: csvText, fileName },
    createdAt: nowIso,
    attempts: 0,
    lastError: null,
    status: "pending",
  };

  if (!isNavigatorOnline()) {
    await enqueueItem(queueItem);
    return {
      ok: true,
      queued: true,
      summary: null,
      sessions: [],
      message: "Sin conexion: CSV encolado para envio automatico.",
    };
  }

  try {
    const res = await fetch("/api/ingest/hevy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ csv: csvText }),
    });

    const body: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      if (res.status >= 500) {
        await enqueueItem({
          ...queueItem,
          attempts: 1,
          lastError: `HTTP ${res.status}`,
        });
        return {
          ok: true,
          queued: true,
          summary: null,
          sessions: [],
          message: "Servidor temporalmente inaccesible: CSV encolado.",
        };
      }
      const errMsg = readErrorMessage(body, `Error al importar CSV (${res.status})`);
      return {
        ok: false,
        queued: false,
        summary: null,
        sessions: [],
        message: errMsg,
      };
    }

    const summary = isRecord(body) ? parseHevySummaryFromUnknown(body.summary) : null;
    const sessions = isRecord(body) ? parseHevySessionsFromUnknown(body.sessions, nowIso) : [];

    if (sessions.length > 0) {
      await upsertHevySessions(sessions);
      const current = await readSnapshot();
      await upsertBiometrics({
        ...current.biometrics,
        source: "Garmin + Hevy",
        updatedAt: nowIso,
      });
    }

    const countLabel = summary
      ? `${summary.sessionsCount} sesiones, ${summary.setsCount} series importadas`
      : "Importacion Hevy completada";

    return {
      ok: true,
      queued: false,
      summary,
      sessions,
      message: countLabel,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error de red";
    await enqueueItem({
      ...queueItem,
      attempts: 1,
      lastError: message,
    });
    return {
      ok: true,
      queued: true,
      summary: null,
      sessions: [],
      message: "Sin conexion: CSV encolado para envio automatico.",
    };
  }
}

export async function syncIfStale(
  force = false,
  nowMs = Date.now(),
): Promise<SyncExecutionResult> {
  const current = await readSnapshot();
  const stale = isSyncStale(current.meta.lastSyncAt, nowMs);

  if (!force && !stale) {
    return {
      synced: false,
      skippedDueToSWR: true,
      offline: false,
      snapshot: current,
      error: null,
    };
  }

  if (!isNavigatorOnline()) {
    return {
      synced: false,
      skippedDueToSWR: false,
      offline: true,
      snapshot: current,
      error: "Modo offline activo",
    };
  }

  await flushSyncQueue();

  const nowIso = new Date(nowMs).toISOString();

  try {
    const [syncRes, weatherRes] = await Promise.all([
      fetch("/api/ingest/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force }),
      }),
      fetch("/api/weather", { method: "GET" }).catch(() => null),
    ]);

    if (!syncRes.ok) {
      const errBody: unknown = await syncRes.json().catch(() => null);
      const errMsg = readErrorMessage(errBody, `Sincronizacion rechazada (${syncRes.status})`);
      const failedMeta: SyncMetaView = {
        ...current.meta,
        id: META_KEY,
        lastError: errMsg,
      };
      await upsertSyncMeta(failedMeta);
      const updated = await readSnapshot();
      return {
        synced: false,
        skippedDueToSWR: false,
        offline: false,
        snapshot: updated,
        error: errMsg,
      };
    }

    const syncJson: unknown = await syncRes.json().catch(() => null);
    const refreshed = await readSnapshot();
    const payloadRoot =
      isRecord(syncJson) && isRecord(syncJson.snapshot) ? syncJson.snapshot : syncJson;

    const rawBiometrics = isRecord(payloadRoot)
      ? payloadRoot.biometrics ?? payloadRoot.dailyBiometrics ?? payloadRoot
      : null;
    const rawBody = isRecord(payloadRoot) ? payloadRoot.bodyComposition : null;
    const rawHevy = isRecord(payloadRoot) ? payloadRoot.hevySessions : null;

    let nextBiometrics = mergeBiometricsFromUnknown(
      rawBiometrics,
      refreshed.biometrics,
      nowIso,
    );

    const hasPendingCheckin = refreshed.pendingQueue.some(
      (item) => item.kind === "subjective_checkin",
    );
    if (hasPendingCheckin) {
      nextBiometrics = {
        ...nextBiometrics,
        subjEnergy: refreshed.biometrics.subjEnergy,
        subjSoreness: refreshed.biometrics.subjSoreness,
        subjMood: refreshed.biometrics.subjMood,
      };
    }

    const nextBody = mergeBodyCompositionFromUnknown(
      rawBody,
      refreshed.bodyComposition,
      nowIso,
    );

    let nextWeather = refreshed.weather;
    if (weatherRes && weatherRes.ok) {
      const weatherJson: unknown = await weatherRes.json().catch(() => null);
      nextWeather = parseWeatherFromUnknown(weatherJson, refreshed.weather, nowIso);
    } else if (isRecord(payloadRoot) && payloadRoot.weather) {
      nextWeather = parseWeatherFromUnknown(payloadRoot.weather, refreshed.weather, nowIso);
    }

    const nextHevy = rawHevy ? parseHevySessionsFromUnknown(rawHevy, nowIso) : undefined;

    const nextMeta: SyncMetaView = {
      id: META_KEY,
      lastSyncAt: nowIso,
      lastWeatherAt: nextWeather ? nextWeather.fetchedAt : refreshed.meta.lastWeatherAt,
      lastSource: nextBiometrics.source,
      lastError: null,
      pendingCount: refreshed.pendingQueue.length,
    };

    const updatedSnapshot = await writeSnapshotAtomic({
      biometrics: nextBiometrics,
      bodyComposition: nextBody,
      weather: nextWeather,
      hevySessions: nextHevy,
      meta: nextMeta,
    });

    return {
      synced: true,
      skippedDueToSWR: false,
      offline: false,
      snapshot: updatedSnapshot,
      error: null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error de red";
    await upsertSyncMeta({
      ...current.meta,
      id: META_KEY,
      lastError: message,
    });
    const updated = await readSnapshot();
    return {
      synced: false,
      skippedDueToSWR: false,
      offline: false,
      snapshot: updated,
      error: message,
    };
  }
}
