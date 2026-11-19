export const STALE_WINDOW_MS = 15 * 60 * 1000;
export const WEATHER_TTL_MS = 60 * 60 * 1000;

export type BiometricAuthorityMode =
  | "service_role"
  | "authenticated_checkin"
  | "client"
  | "sync_request";

export type AuthorityViolationCode =
  | "APPLE_HEALTH_FORBIDDEN"
  | "GARMIN_AUTHORITY_VIOLATION"
  | "INVALID_PAYLOAD";

export const GARMIN_AUTHORITY_FIELDS: ReadonlySet<string> = new Set([
  "source",
  "activeKcal",
  "active_kcal",
  "restingKcal",
  "resting_kcal",
  "sleepMinutes",
  "sleep_minutes",
  "hrvMs",
  "hrv_ms",
  "restingHr",
  "resting_hr",
  "sleepScore",
  "sleep_score",
  "bodyBattery",
  "body_battery",
  "stressAvg",
  "stress_avg",
  "campTempC",
  "camp_temp_c",
  "campPressureHpa",
  "camp_pressure_hpa",
  "weatherTempC",
  "weather_temp_c",
  "weatherHumidityPct",
  "weather_humidity_pct",
  "rawPayload",
  "raw_payload",
]);

const APPLE_HEALTH_TOKENS: ReadonlySet<string> = new Set([
  "apple_health",
  "applehealth",
  "healthkit",
]);

export class BiometricAuthorityError extends Error {
  readonly statusCode = 403;
  readonly code: AuthorityViolationCode;
  readonly forbiddenFields: readonly string[];

  constructor(
    code: AuthorityViolationCode,
    message: string,
    forbiddenFields: readonly string[] = [],
  ) {
    super(message);
    this.name = "BiometricAuthorityError";
    this.code = code;
    this.forbiddenFields = forbiddenFields;
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseTimestampMs(
  lastSyncAt: string | number | Date | null | undefined,
): number | null {
  if (lastSyncAt === null || lastSyncAt === undefined) {
    return null;
  }
  if (typeof lastSyncAt === "number") {
    return Number.isFinite(lastSyncAt) ? lastSyncAt : null;
  }
  if (lastSyncAt instanceof Date) {
    const ms = lastSyncAt.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof lastSyncAt === "string") {
    const trimmed = lastSyncAt.trim();
    if (trimmed.length === 0) {
      return null;
    }
    const parsed = Date.parse(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function isAppleHealthSource(source: unknown): boolean {
  if (typeof source !== "string") {
    return false;
  }
  const normalized = source.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return APPLE_HEALTH_TOKENS.has(normalized);
}

export function isStale(
  lastSyncAt: string | number | Date | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  const parsedMs = parseTimestampMs(lastSyncAt);
  if (parsedMs === null || !Number.isFinite(nowMs)) {
    return true;
  }
  return nowMs - parsedMs >= STALE_WINDOW_MS;
}

export function remainingCooldownMs(
  lastSyncAt: string | number | Date | null | undefined,
  nowMs: number = Date.now(),
): number {
  const parsedMs = parseTimestampMs(lastSyncAt);
  if (parsedMs === null || !Number.isFinite(nowMs)) {
    return 0;
  }
  const elapsed = nowMs - parsedMs;
  if (elapsed >= STALE_WINDOW_MS) {
    return 0;
  }
  if (elapsed < 0) {
    return STALE_WINDOW_MS;
  }
  return Math.max(0, STALE_WINDOW_MS - elapsed);
}

function scanForAppleHealth(value: unknown, depth: number): void {
  if (depth > 5 || value === null || value === undefined) {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      scanForAppleHealth(item, depth + 1);
    }
    return;
  }
  if (!isPlainRecord(value)) {
    return;
  }
  if ("source" in value && isAppleHealthSource(value.source)) {
    throw new BiometricAuthorityError(
      "APPLE_HEALTH_FORBIDDEN",
      "ADR-001: apple_health esta estrictamente prohibido en PulseTrack.",
      ["source"],
    );
  }
  for (const nestedKey of ["records", "biometrics", "bodyComposition", "snapshot"]) {
    if (nestedKey in value) {
      scanForAppleHealth(value[nestedKey], depth + 1);
    }
  }
}

export function assertBiometricAuthority(
  payload: unknown,
  mode: BiometricAuthorityMode,
): void {
  if (isAppleHealthSource(payload)) {
    throw new BiometricAuthorityError(
      "APPLE_HEALTH_FORBIDDEN",
      "ADR-001: apple_health esta estrictamente prohibido en PulseTrack.",
      ["source"],
    );
  }

  scanForAppleHealth(payload, 0);

  if (mode === "authenticated_checkin" || mode === "client") {
    if (!isPlainRecord(payload)) {
      throw new BiometricAuthorityError(
        "INVALID_PAYLOAD",
        "El payload de check-in subjetivo debe ser un objeto JSON.",
      );
    }

    const forbidden: string[] = [];
    for (const [key, val] of Object.entries(payload)) {
      if (val !== undefined && GARMIN_AUTHORITY_FIELDS.has(key)) {
        forbidden.push(key);
      }
    }

    if (forbidden.length > 0) {
      throw new BiometricAuthorityError(
        "GARMIN_AUTHORITY_VIOLATION",
        `ADR-001: el cliente autenticado no puede escribir campos de autoridad Garmin (${forbidden.join(", ")}).`,
        forbidden,
      );
    }
  }
}
