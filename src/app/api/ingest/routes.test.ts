import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STALE_WINDOW_MS, WEATHER_TTL_MS } from "@/lib/ingest/swr-policy";

const { parseHevyCsvMock } = vi.hoisted(() => ({
  parseHevyCsvMock: vi.fn(),
}));

vi.mock("@/lib/ingest/hevy-csv", () => ({
  parseHevyCsv: (...args: unknown[]) => parseHevyCsvMock(...args),
}));

interface JsonBody {
  [key: string]: unknown;
}

describe("API routes de ingesta y check-in (ADR-001)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-18T12:00:00.000Z"));
    parseHevyCsvMock.mockReset();
    delete process.env.INGEST_SERVICE_URL;
    delete process.env.INGEST_MODE;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete process.env.INGEST_SERVICE_URL;
    delete process.env.INGEST_MODE;
  });

  describe("POST /api/ingest/hevy", () => {
    it("importa CSV por JSON y FormData devolviendo summary y sessions", async () => {
      parseHevyCsvMock.mockReturnValue({
        summary: {
          sessionsCount: 1,
          exercisesCount: 2,
          setsCount: 6,
          duplicatesSkipped: 1,
          rejectedRows: 0,
        },
        sessions: [
          {
            externalId: "hevy-2026-11-18-upper",
            source: "hevy",
            startedAt: "2026-11-18T07:00:00.000Z",
            totalVolumeKg: 4250,
          },
        ],
      });

      const { POST: postHevy } = await import("@/app/api/ingest/hevy/route");

      const jsonRes = await postHevy(
        new Request("http://localhost/api/ingest/hevy", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ csv: "title,start_time\nUpper,2026-11-18" }),
        }),
      );
      const jsonData = (await jsonRes.json()) as JsonBody;
      expect({ status: jsonRes.status, jsonData }).toEqual({
        status: 200,
        jsonData: {
          ok: true,
          summary: {
            sessionsCount: 1,
            exercisesCount: 2,
            setsCount: 6,
            duplicatesSkipped: 1,
            rejectedRows: 0,
          },
          sessions: expect.any(Array),
        },
      });
      expect(parseHevyCsvMock).toHaveBeenCalledTimes(1);

      const form = new FormData();
      const csvFile = new File(["title,start_time\nLower,2026-11-18"], "hevy.csv", {
        type: "text/csv",
      });
      form.append("file", csvFile);

      const formRes = await postHevy(
        new Request("http://localhost/api/ingest/hevy", {
          method: "POST",
          body: form,
        }),
      );
      expect(formRes.status).toBe(200);
      expect(parseHevyCsvMock).toHaveBeenCalledTimes(2);
    });

    it("rechaza CSV vacio con 400 y apple_health con 403", async () => {
      const { POST: postHevy } = await import("@/app/api/ingest/hevy/route");

      const emptyRes = await postHevy(
        new Request("http://localhost/api/ingest/hevy", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ csv: "   " }),
        }),
      );
      expect(emptyRes.status).toBe(400);

      const forbiddenRes = await postHevy(
        new Request("http://localhost/api/ingest/hevy", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ source: "apple_health", csv: "a,b\n1,2" }),
        }),
      );
      expect(forbiddenRes.status).toBe(403);
    });
  });

  describe("GET y POST /api/ingest/sync", () => {
    it("retorna snapshot SWR, respeta enfriamiento de 15 min y rechaza apple_health", async () => {
      const { GET, POST } = await import("@/app/api/ingest/sync/route");

      const getRes = await GET();
      expect(getRes.status).toBe(200);
      const getData = (await getRes.json()) as {
        ok: boolean;
        authority: string;
        swr: { staleWindowMs: number; isStale: boolean };
      };
      expect(getData.ok).toBe(true);
      expect(getData.authority).toBe("garmin");
      expect(getData.swr.staleWindowMs).toBe(STALE_WINDOW_MS);
      expect(getData.swr.isStale).toBe(true);

      const forbiddenRes = await POST(
        new Request("http://localhost/api/ingest/sync", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ source: "apple_health" }),
        }),
      );
      expect(forbiddenRes.status).toBe(403);

      const firstSyncRes = await POST(
        new Request("http://localhost/api/ingest/sync", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ source: "garmin" }),
        }),
      );
      expect(firstSyncRes.status).toBe(200);
      const firstSync = (await firstSyncRes.json()) as {
        synced: boolean;
        snapshot: {
          biometrics: { campFalseActiveKcal: number; source: string };
          bodyComposition: { syncedToGarmin: boolean };
        };
      };
      expect(firstSync.synced).toBe(true);
      expect(firstSync.snapshot.biometrics.source).toBe("garmin");
      expect(firstSync.snapshot.biometrics.campFalseActiveKcal).toBe(0);
      expect(firstSync.snapshot.bodyComposition.syncedToGarmin).toBe(true);

      // 5 minutos despues sigue dentro de la ventana SWR de 15 min
      vi.advanceTimersByTime(5 * 60 * 1000);
      const cooledRes = await POST(
        new Request("http://localhost/api/ingest/sync", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        }),
      );
      const cooledData = (await cooledRes.json()) as {
        synced: boolean;
        skipped: boolean;
        swr: { remainingCooldownMs: number };
      };
      expect(cooledData.synced).toBe(false);
      expect(cooledData.skipped).toBe(true);
      expect(cooledData.swr.remainingCooldownMs).toBe(10 * 60 * 1000);

      // force: true ignora enfriamiento
      const forcedRes = await POST(
        new Request("http://localhost/api/ingest/sync", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ force: true }),
        }),
      );
      const forcedData = (await forcedRes.json()) as { synced: boolean };
      expect(forcedData.synced).toBe(true);
    });

    it("consulta INGEST_SERVICE_URL cuando esta definido en entorno", async () => {
      process.env.INGEST_SERVICE_URL = "http://ingest.local:8000";
      process.env.INGEST_MODE = "live";
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            ok: true,
            authority: "garmin",
            mode: "live",
            records: [
              {
                date: "2026-11-18",
                source: "garmin",
                active_kcal: 740,
                resting_kcal: 1800,
                sleep_minutes: 480,
                hrv_ms: 74.2,
                resting_hr: 49,
                sleep_score: 91,
                body_battery: 89,
                stress_avg: 19,
                camp_temp_c: 17.8,
                camp_pressure_hpa: 1013.2,
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
      vi.stubGlobal("fetch", fetchMock);

      const { POST } = await import("@/app/api/ingest/sync/route");
      const res = await POST(
        new Request("http://localhost/api/ingest/sync", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ force: true }),
        }),
      );

      expect(res.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const data = (await res.json()) as {
        mode: string;
        snapshot: { biometrics: { activeKcal: number; hrvMs: number } };
      };
      expect(data.mode).toBe("live");
      expect(data.snapshot.biometrics.activeKcal).toBe(740);
      expect(data.snapshot.biometrics.hrvMs).toBe(74.2);
    });
  });

  describe("PATCH /api/biometrics/checkin", () => {
    it("acepta check-in 1..5 valido y rechaza rangos invalidos o campos Garmin con 403", async () => {
      const { PATCH } = await import("@/app/api/biometrics/checkin/route");

      const okRes = await PATCH(
        new Request("http://localhost/api/biometrics/checkin", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            date: "2026-11-18",
            subjEnergy: 4,
            subjSoreness: 2,
            subjMood: 5,
          }),
        }),
      );
      expect(okRes.status).toBe(200);
      const okData = (await okRes.json()) as {
        ok: boolean;
        updatedColumns: string[];
        checkin: { subjEnergy: number; subjSoreness: number; subjMood: number };
      };
      expect(okData.ok).toBe(true);
      expect(okData.checkin.subjEnergy).toBe(4);
      expect(okData.updatedColumns).toEqual([
        "subj_energy",
        "subj_soreness",
        "subj_mood",
        "updated_at",
      ]);

      // Entero fuera de 1..5 -> 400
      const invalidRangeRes = await PATCH(
        new Request("http://localhost/api/biometrics/checkin", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ subjEnergy: 6, subjSoreness: 2, subjMood: 3 }),
        }),
      );
      expect(invalidRangeRes.status).toBe(400);

      // Decimal no entero -> 400
      const floatRes = await PATCH(
        new Request("http://localhost/api/biometrics/checkin", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ subjEnergy: 3.5, subjSoreness: 2, subjMood: 3 }),
        }),
      );
      expect(floatRes.status).toBe(400);

      // Intento de escribir campos Garmin -> 403
      for (const garminPayload of [
        { subjEnergy: 4, subjSoreness: 2, subjMood: 5, activeKcal: 999 },
        { subjEnergy: 4, subjSoreness: 2, subjMood: 5, restingKcal: 1800 },
        { subjEnergy: 4, subjSoreness: 2, subjMood: 5, hrvMs: 80 },
        { subjEnergy: 4, subjSoreness: 2, subjMood: 5, sleepMinutes: 500 },
      ]) {
        const res = await PATCH(
          new Request("http://localhost/api/biometrics/checkin", {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(garminPayload),
          }),
        );
        expect(res.status).toBe(403);
      }

      // apple_health -> 403
      const appleRes = await PATCH(
        new Request("http://localhost/api/biometrics/checkin", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            source: "apple_health",
            subjEnergy: 4,
            subjSoreness: 2,
            subjMood: 5,
          }),
        }),
      );
      expect(appleRes.status).toBe(403);
    });
  });

  describe("GET /api/weather", () => {
    it("cachea Open-Meteo por 60 min y usa fallback fixture si falla la red", async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            current: {
              time: "2026-11-18T12:00",
              temperature_2m: 29.1,
              relative_humidity_2m: 61,
              surface_pressure: 1012.1,
              weather_code: 0,
              wind_speed_10m: 8.4,
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
      vi.stubGlobal("fetch", fetchMock);

      const { GET } = await import("@/app/api/weather/route");

      const firstRes = await GET(
        new Request("http://localhost/api/weather?lat=12.1364&lon=-86.2514"),
      );
      expect(firstRes.status).toBe(200);
      const firstData = (await firstRes.json()) as {
        cached: boolean;
        fallback: boolean;
        source: string;
        weather: { tempC: number };
      };
      expect(firstData.cached).toBe(false);
      expect(firstData.fallback).toBe(false);
      expect(firstData.source).toBe("open-meteo");
      expect(firstData.weather.tempC).toBe(29.1);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // 30 min despues -> hit de cache sin nuevo fetch
      vi.advanceTimersByTime(30 * 60 * 1000);
      const cachedRes = await GET(
        new Request("http://localhost/api/weather?lat=12.1364&lon=-86.2514"),
      );
      const cachedData = (await cachedRes.json()) as { cached: boolean };
      expect(cachedData.cached).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Despues de 60 min y con error de red -> fallback fixture determinista
      vi.advanceTimersByTime(WEATHER_TTL_MS);
      fetchMock.mockRejectedValueOnce(new Error("network down"));
      const fallbackRes = await GET(
        new Request("http://localhost/api/weather?lat=12.1364&lon=-86.2514"),
      );
      expect(fallbackRes.status).toBe(200);
      const fallbackData = (await fallbackRes.json()) as {
        fallback: boolean;
        source: string;
        weather: { tempC: number; humidityPct: number };
      };
      expect(fallbackData.fallback).toBe(true);
      expect(fallbackData.source).toBe("fixture");
      expect(fallbackData.weather.tempC).toBe(27.4);
      expect(fallbackData.weather.humidityPct).toBe(64);

      // Coordenadas invalidas -> 400
      const badCoordsRes = await GET(
        new Request("http://localhost/api/weather?lat=120&lon=-86"),
      );
      expect(badCoordsRes.status).toBe(400);
    });
  });
});
