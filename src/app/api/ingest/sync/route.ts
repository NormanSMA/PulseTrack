import { NextResponse } from "next/server";
import {
  BiometricAuthorityError,
  STALE_WINDOW_MS,
  assertBiometricAuthority,
  isStale,
  remainingCooldownMs,
} from "@/lib/ingest/swr-policy";

interface BiometricSnapshot {
  date: string;
  source: "garmin";
  activeKcal: number;
  restingKcal: number;
  sleepMinutes: number;
  hrvMs: number;
  restingHr: number;
  sleepScore: number;
  bodyBattery: number;
  stressAvg: number;
  campTempC: number;
  campPressureHpa: number;
  campFalseActiveKcal: 0;
  weatherTempC: number;
  weatherHumidityPct: number;
  subjEnergy: number | null;
  subjSoreness: number | null;
  subjMood: number | null;
  updatedAt: string;
}

interface BodyCompositionSnapshot {
  measuredAt: string;
  source: "renpho";
  weightKg: number;
  bodyFatPct: number;
  muscleMassKg: number;
  waterPct: number;
  visceralFat: number;
  bmrKcal: number;
  syncedToGarmin: true;
}

interface SyncSnapshot {
  biometrics: BiometricSnapshot;
  bodyComposition: BodyCompositionSnapshot;
}

interface SyncMemoryState {
  lastSyncAt: string | null;
  mode: "fixture" | "live";
  fallback: boolean;
  snapshot: SyncSnapshot;
}

function buildDeterministicSnapshot(updatedAt: string, date = "2026-11-18"): SyncSnapshot {
  return {
    biometrics: {
      date,
      source: "garmin",
      activeKcal: 620,
      restingKcal: 1780,
      sleepMinutes: 462,
      hrvMs: 68.5,
      restingHr: 51,
      sleepScore: 88,
      bodyBattery: 82,
      stressAvg: 24,
      campTempC: 18.4,
      campPressureHpa: 1012.6,
      campFalseActiveKcal: 0,
      weatherTempC: 27.4,
      weatherHumidityPct: 64.0,
      subjEnergy: 4,
      subjSoreness: 2,
      subjMood: 5,
      updatedAt,
    },
    bodyComposition: {
      measuredAt: "2026-11-18T06:35:00Z",
      source: "renpho",
      weightKg: 76.4,
      bodyFatPct: 14.8,
      muscleMassKg: 61.7,
      waterPct: 60.4,
      visceralFat: 6,
      bmrKcal: 1795,
      syncedToGarmin: true,
    },
  };
}

const syncState: SyncMemoryState = {
  lastSyncAt: null,
  mode: "fixture",
  fallback: false,
  snapshot: buildDeterministicSnapshot("2026-11-18T12:00:00.000Z"),
};

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function buildSwrPayload(nowMs: number) {
  return {
    staleWindowMs: STALE_WINDOW_MS,
    lastSyncAt: syncState.lastSyncAt,
    isStale: isStale(syncState.lastSyncAt, nowMs),
    remainingCooldownMs: remainingCooldownMs(syncState.lastSyncAt, nowMs),
    source: "garmin" as const,
    mode: syncState.mode,
  };
}

export async function GET(): Promise<NextResponse> {
  const nowMs = Date.now();
  return NextResponse.json(
    {
      ok: true,
      authority: "garmin",
      mode: syncState.mode,
      fallback: syncState.fallback,
      snapshot: syncState.snapshot,
      swr: buildSwrPayload(nowMs),
    },
    { status: 200 },
  );
}

export async function POST(request: Request): Promise<NextResponse> {
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  let force = false;
  let requestedDate: string | undefined;

  const rawBody = await request.text();
  if (rawBody.trim().length > 0) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      return NextResponse.json(
        { ok: false, error: "Cuerpo JSON invalido en /api/ingest/sync." },
        { status: 400 },
      );
    }

    try {
      assertBiometricAuthority(parsed, "sync_request");
    } catch (err: unknown) {
      if (err instanceof BiometricAuthorityError) {
        return NextResponse.json(
          { ok: false, code: err.code, error: err.message },
          { status: err.statusCode },
        );
      }
      throw err;
    }

    if (isPlainRecord(parsed)) {
      if (typeof parsed.source === "string" && parsed.source.trim().length > 0) {
        const normalized = parsed.source.trim().toLowerCase();
        if (normalized !== "garmin" && normalized !== "renpho") {
          return NextResponse.json(
            {
              ok: false,
              code: "GARMIN_AUTHORITY_VIOLATION",
              error: `Fuente '${parsed.source}' no autorizada para sincronizacion biometrica.`,
            },
            { status: 403 },
          );
        }
      }
      force = parsed.force === true;
      if (typeof parsed.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date)) {
        requestedDate = parsed.date;
      }
    }
  }

  if (!force && syncState.lastSyncAt !== null && !isStale(syncState.lastSyncAt, nowMs)) {
    return NextResponse.json(
      {
        ok: true,
        synced: false,
        skipped: true,
        reason: "within_swr_window",
        authority: "garmin",
        mode: syncState.mode,
        fallback: syncState.fallback,
        snapshot: syncState.snapshot,
        swr: buildSwrPayload(nowMs),
      },
      { status: 200 },
    );
  }

  const ingestServiceUrl = process.env.INGEST_SERVICE_URL?.trim();
  const baseSnapshot = buildDeterministicSnapshot(nowIso, requestedDate ?? "2026-11-18");

  if (ingestServiceUrl) {
    try {
      const endpoint = `${ingestServiceUrl.replace(/\/+$/, "")}/v1/sync/garmin`;
      const upstream = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          source: "garmin",
          date: requestedDate ?? baseSnapshot.biometrics.date,
          force,
          use_fixture: true,
        }),
        signal: AbortSignal.timeout(4000),
      });

      if (upstream.status === 403) {
        return NextResponse.json(
          {
            ok: false,
            code: "APPLE_HEALTH_FORBIDDEN",
            error: "El servicio de ingesta rechazo la fuente por ADR-001.",
          },
          { status: 403 },
        );
      }

      if (!upstream.ok) {
        throw new Error(`Upstream ingest status ${upstream.status}`);
      }

      const upstreamJson: unknown = await upstream.json();
      assertBiometricAuthority(upstreamJson, "service_role");

      const firstRecord =
        isPlainRecord(upstreamJson) &&
        Array.isArray(upstreamJson.records) &&
        isPlainRecord(upstreamJson.records[0])
          ? upstreamJson.records[0]
          : null;

      if (firstRecord) {
        baseSnapshot.biometrics = {
          ...baseSnapshot.biometrics,
          date: typeof firstRecord.date === "string" ? firstRecord.date : baseSnapshot.biometrics.date,
          source: "garmin",
          activeKcal: readFiniteNumber(firstRecord.active_kcal, baseSnapshot.biometrics.activeKcal),
          restingKcal: readFiniteNumber(firstRecord.resting_kcal, baseSnapshot.biometrics.restingKcal),
          sleepMinutes: readFiniteNumber(firstRecord.sleep_minutes, baseSnapshot.biometrics.sleepMinutes),
          hrvMs: readFiniteNumber(firstRecord.hrv_ms, baseSnapshot.biometrics.hrvMs),
          restingHr: readFiniteNumber(firstRecord.resting_hr, baseSnapshot.biometrics.restingHr),
          sleepScore: readFiniteNumber(firstRecord.sleep_score, baseSnapshot.biometrics.sleepScore),
          bodyBattery: readFiniteNumber(firstRecord.body_battery, baseSnapshot.biometrics.bodyBattery),
          stressAvg: readFiniteNumber(firstRecord.stress_avg, baseSnapshot.biometrics.stressAvg),
          campTempC: readFiniteNumber(firstRecord.camp_temp_c, baseSnapshot.biometrics.campTempC),
          campPressureHpa: readFiniteNumber(
            firstRecord.camp_pressure_hpa,
            baseSnapshot.biometrics.campPressureHpa,
          ),
          campFalseActiveKcal: 0,
          updatedAt: nowIso,
        };
      }

      syncState.snapshot = baseSnapshot;
      syncState.lastSyncAt = nowIso;
      syncState.mode = "live";
      syncState.fallback = false;
    } catch (err: unknown) {
      if (err instanceof BiometricAuthorityError) {
        return NextResponse.json(
          { ok: false, code: err.code, error: err.message },
          { status: err.statusCode },
        );
      }
      syncState.snapshot = baseSnapshot;
      syncState.lastSyncAt = nowIso;
      syncState.mode = "fixture";
      syncState.fallback = true;
    }
  } else {
    syncState.snapshot = baseSnapshot;
    syncState.lastSyncAt = nowIso;
    syncState.mode = "fixture";
    syncState.fallback = false;
  }

  return NextResponse.json(
    {
      ok: true,
      synced: true,
      skipped: false,
      authority: "garmin",
      mode: syncState.mode,
      fallback: syncState.fallback,
      snapshot: syncState.snapshot,
      swr: buildSwrPayload(nowMs),
    },
    { status: 200 },
  );
}
