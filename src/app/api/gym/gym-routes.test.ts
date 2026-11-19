import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface MockSet {
  weightKg: number;
  reps: number;
  isWarmup: boolean;
}

interface MockSession {
  date: string;
  totalVolumeKg: number;
}

interface MockRoutine {
  id: string;
  name: string;
  exercises: Array<{ exerciseName: string; sets: number; targetReps: number; restSeconds: number }>;
}

vi.mock("@/lib/sports/strength-metrics", () => ({
  calculateEpley1RM: (weightKg: number, reps: number): number => weightKg * (1 + reps / 30),
  calculateSessionTonnage: (sets: readonly MockSet[], includeWarmup = false): number =>
    sets.reduce(
      (total, set) => (set.isWarmup && !includeWarmup ? total : total + set.weightKg * set.reps),
      0,
    ),
  calculateWeeklyTonnage: (sessions: readonly MockSession[]) => {
    const first = sessions[0];
    return [
      {
        weekStart: first ? first.date : "1970-01-01",
        tonnageKg: sessions.reduce((total, session) => total + session.totalVolumeKg, 0),
        sessionsCount: sessions.length,
      },
    ];
  },
  calculateDecoupledAcwr: (loads: ReadonlyArray<{ load: number }>) => {
    const total = loads.reduce((sum, entry) => sum + entry.load, 0);
    const chronic = loads.length > 0 ? total / loads.length : 0;
    const acute = loads.slice(-7).reduce((sum, entry) => sum + entry.load, 0) / 7;
    return {
      acuteLoad: acute,
      chronicLoad: chronic,
      ratio: chronic > 0 ? acute / chronic : 0,
      zone: "optimal",
      label: "Optimo",
    };
  },
  buildLiftAiRecommendations: () => [],
  buildGarminStrengthWorkoutExport: (routine: MockRoutine) => ({
    exportId: `garmin-${routine.id}`,
    routineId: routine.id,
    workoutName: routine.name,
    sportType: "strength_training",
    generatedAt: "2026-11-18T12:00:00.000Z",
    steps: routine.exercises.map((exercise, index) => ({
      stepOrder: index + 1,
      exerciseName: exercise.exerciseName,
      sets: exercise.sets,
      targetReps: exercise.targetReps,
      restSeconds: exercise.restSeconds,
    })),
  }),
}));

interface JsonBody {
  [key: string]: unknown;
}

const SERVICE_SECRET = "test-service-secret-value";

function jsonRequest(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

async function readJson(response: Response): Promise<JsonBody> {
  return (await response.json()) as JsonBody;
}

const validSets = [
  { exerciseName: "Bench Press", weightKg: 60, reps: 10, isWarmup: true },
  { exerciseName: "Bench Press", weightKg: 80, reps: 6, rpe: 8 },
  { exerciseName: "Bench Press", weightKg: 80, reps: 5, rpe: 9 },
];

describe("API routes de gimnasio y composicion corporal (ADR-001)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-18T12:00:00.000Z"));
    delete process.env.PULSETRACK_SERVICE_SECRET;
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.PULSETRACK_SERVICE_SECRET;
  });

  describe("/api/gym/catalog", () => {
    it("lista el catalogo inicial con ejercicios estandar y personalizados", async () => {
      const { GET } = await import("@/app/api/gym/catalog/route");
      const res = await GET(new Request("http://localhost/api/gym/catalog"));
      const data = await readJson(res);
      const items = data.items as Array<{ externalId: string; isCustom: boolean }>;
      expect(res.status).toBe(200);
      expect(data.ok).toBe(true);
      expect(items.length).toBeGreaterThanOrEqual(15);
      expect(items.some((item) => item.isCustom)).toBe(true);
      expect(items.some((item) => !item.isCustom)).toBe(true);
    });

    it("inserta ejercicio personalizado con externalId determinista y deduplica", async () => {
      const { POST } = await import("@/app/api/gym/catalog/route");
      const payload = {
        name: "Landmine Press",
        muscleGroup: "shoulders",
        equipment: "barbell",
        defaultStepNote: "Empuje diagonal",
      };

      const first = await POST(jsonRequest("http://localhost/api/gym/catalog", payload));
      const firstData = await readJson(first);
      expect(first.status).toBe(201);
      expect(firstData.deduplicated).toBe(false);
      expect(firstData.item).toMatchObject({
        externalId: "ex:landmine-press:barbell",
        isCustom: true,
      });

      const second = await POST(
        jsonRequest("http://localhost/api/gym/catalog", { ...payload, name: "  LANDMINE press " }),
      );
      const secondData = await readJson(second);
      expect(second.status).toBe(200);
      expect(secondData.deduplicated).toBe(true);
      expect((secondData.item as JsonBody).externalId).toBe("ex:landmine-press:barbell");
    });

    it("aisla el catalogo por actor", async () => {
      const { GET, POST } = await import("@/app/api/gym/catalog/route");
      await POST(
        jsonRequest(
          "http://localhost/api/gym/catalog",
          { name: "Zercher Squat", muscleGroup: "quads", equipment: "barbell" },
          { "x-user-id": "actor-a" },
        ),
      );
      const own = await readJson(
        await GET(new Request("http://localhost/api/gym/catalog", { headers: { "x-user-id": "actor-a" } })),
      );
      const other = await readJson(
        await GET(new Request("http://localhost/api/gym/catalog", { headers: { "x-user-id": "actor-b" } })),
      );
      const ownIds = (own.items as Array<{ externalId: string }>).map((item) => item.externalId);
      const otherIds = (other.items as Array<{ externalId: string }>).map((item) => item.externalId);
      expect(ownIds).toContain("ex:zercher-squat:barbell");
      expect(otherIds).not.toContain("ex:zercher-squat:barbell");
    });

    it("rechaza textos vacios con 400 y apple_health con 403", async () => {
      const { POST } = await import("@/app/api/gym/catalog/route");
      const empty = await POST(
        jsonRequest("http://localhost/api/gym/catalog", {
          name: "   ",
          muscleGroup: "chest",
          equipment: "cable",
        }),
      );
      expect(empty.status).toBe(400);

      const missing = await POST(
        jsonRequest("http://localhost/api/gym/catalog", { name: "Fly", muscleGroup: 4, equipment: "cable" }),
      );
      expect(missing.status).toBe(400);

      const apple = await POST(
        jsonRequest("http://localhost/api/gym/catalog", {
          source: "apple_health",
          name: "Fly",
          muscleGroup: "chest",
          equipment: "cable",
        }),
      );
      expect(apple.status).toBe(403);
    });
  });

  describe("/api/gym/sessions", () => {
    it("retorna rutinas, 28 dias de sesiones, tonelaje, ACWR y recuperacion", async () => {
      const { GET } = await import("@/app/api/gym/sessions/route");
      const res = await GET(new Request("http://localhost/api/gym/sessions"));
      const data = await readJson(res);
      const routines = data.routines as Array<{ name: string; exercises: unknown[] }>;
      const sessions = data.sessions as Array<{ date: string; totalVolumeKg: number }>;
      expect(res.status).toBe(200);
      expect(data.ok).toBe(true);
      expect(routines.map((routine) => routine.name)).toEqual(["Push", "Pull", "Legs"]);
      expect(routines.every((routine) => routine.exercises.length >= 5)).toBe(true);
      expect(sessions).toHaveLength(21);
      expect(sessions.every((session) => session.totalVolumeKg > 0)).toBe(true);
      const dates = sessions.map((session) => session.date);
      expect([...dates].sort().reverse()).toEqual(dates);
      expect(Array.isArray(data.weeklyTonnage)).toBe(true);
      expect(Array.isArray(data.recommendations)).toBe(true);
      expect(data.acwr).toMatchObject({ zone: "optimal" });
      expect(typeof data.recoveryScore).toBe("number");
      expect(Number.isFinite(data.recoveryScore)).toBe(true);
    });

    it("registra sesion nueva, calcula volumen sin calentamiento y deduplica", async () => {
      const { POST } = await import("@/app/api/gym/sessions/route");
      const payload = {
        title: "Push extra",
        startedAt: "2026-11-18T10:00:00.000Z",
        source: "hevy",
        sets: validSets,
      };

      const first = await POST(jsonRequest("http://localhost/api/gym/sessions", payload));
      const firstData = await readJson(first);
      expect(first.status).toBe(201);
      expect(firstData.deduplicated).toBe(false);
      expect(firstData.session).toMatchObject({
        title: "Push extra",
        date: "2026-11-18",
        source: "hevy",
        totalVolumeKg: 80 * 6 + 80 * 5,
      });
      expect(firstData.acwr).toBeDefined();
      expect(firstData.weeklyTonnage).toBeDefined();
      expect(firstData.recommendations).toBeDefined();

      const second = await POST(jsonRequest("http://localhost/api/gym/sessions", payload));
      const secondData = await readJson(second);
      expect(second.status).toBe(200);
      expect(secondData.deduplicated).toBe(true);
      expect((secondData.session as JsonBody).externalId).toBe(
        (firstData.session as JsonBody).externalId,
      );

      const { GET } = await import("@/app/api/gym/sessions/route");
      const listed = await readJson(await GET(new Request("http://localhost/api/gym/sessions")));
      expect((listed.sessions as unknown[]).length).toBe(22);
    });

    it("rechaza apple_health con 403", async () => {
      const { POST } = await import("@/app/api/gym/sessions/route");
      const res = await POST(
        jsonRequest("http://localhost/api/gym/sessions", {
          title: "Push",
          source: "apple_health",
          sets: validSets,
        }),
      );
      expect(res.status).toBe(403);
    });

    it("rechaza series invalidas, vacias y fechas invalidas con 400", async () => {
      const { POST } = await import("@/app/api/gym/sessions/route");
      const post = (body: unknown): Promise<Response> =>
        POST(jsonRequest("http://localhost/api/gym/sessions", body));

      expect((await post({ title: "Push", sets: [] })).status).toBe(400);
      expect((await post({ sets: validSets })).status).toBe(400);
      expect(
        (await post({ title: "Push", sets: [{ exerciseName: "Bench", weightKg: 80, reps: 0 }] })).status,
      ).toBe(400);
      expect(
        (await post({ title: "Push", sets: [{ exerciseName: "Bench", weightKg: -1, reps: 5 }] })).status,
      ).toBe(400);
      expect(
        (await post({ title: "Push", sets: [{ exerciseName: "Bench", weightKg: null, reps: 5 }] })).status,
      ).toBe(400);
      expect(
        (await post({ title: "Push", sets: [{ exerciseName: "Bench", weightKg: "NaN", reps: 5 }] })).status,
      ).toBe(400);
      expect((await post({ title: "Push", date: "2026-02-31", sets: validSets })).status).toBe(400);

      const malformed = await POST(
        new Request("http://localhost/api/gym/sessions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{no-json",
        }),
      );
      expect(malformed.status).toBe(400);
    });

    it("aisla sesiones por actor", async () => {
      const { GET, POST } = await import("@/app/api/gym/sessions/route");
      await POST(
        jsonRequest(
          "http://localhost/api/gym/sessions",
          { title: "Solo actor A", startedAt: "2026-11-18T09:00:00.000Z", sets: validSets },
          { "x-user-id": "actor-a" },
        ),
      );
      const other = await readJson(
        await GET(new Request("http://localhost/api/gym/sessions", { headers: { "x-user-id": "actor-b" } })),
      );
      const titles = (other.sessions as Array<{ title: string }>).map((session) => session.title);
      expect(titles).not.toContain("Solo actor A");
    });
  });

  describe("/api/gym/export-garmin", () => {
    it("exporta la rutina del actor a formato Garmin", async () => {
      const { POST } = await import("@/app/api/gym/export-garmin/route");
      const res = await POST(
        jsonRequest("http://localhost/api/gym/export-garmin", { routineId: "routine-push" }),
      );
      const data = await readJson(res);
      const workout = data.workout as { routineId: string; workoutName: string; steps: unknown[] };
      expect(res.status).toBe(200);
      expect(data.ok).toBe(true);
      expect(workout.routineId).toBe("routine-push");
      expect(workout.workoutName).toBe("Push");
      expect(workout.steps.length).toBeGreaterThanOrEqual(5);
    });

    it("retorna 404 si la rutina no existe y 400 si falta routineId", async () => {
      const { POST } = await import("@/app/api/gym/export-garmin/route");
      const missing = await POST(
        jsonRequest("http://localhost/api/gym/export-garmin", { routineId: "routine-arms" }),
      );
      expect(missing.status).toBe(404);

      const invalid = await POST(jsonRequest("http://localhost/api/gym/export-garmin", {}));
      expect(invalid.status).toBe(400);
    });
  });

  describe("/api/body-composition", () => {
    const measurement = {
      measuredAt: "2026-11-18T07:45:00.000Z",
      source: "renpho",
      weightKg: 77.4,
      bodyFatPct: 17.1,
      muscleMassKg: 36.2,
      waterPct: 57.5,
      visceralFat: 5.8,
      bmrKcal: 1795,
    };

    it("expone 30 dias de serie RENPHO sincronizada con Garmin", async () => {
      const { GET } = await import("@/app/api/body-composition/route");
      const res = await GET(new Request("http://localhost/api/body-composition"));
      const data = await readJson(res);
      const series = data.series as Array<{
        measuredAt: string;
        syncedToGarmin: boolean;
        weightKg: number;
      }>;
      expect(res.status).toBe(200);
      expect(data.authority).toBe("renpho->garmin");
      expect(series).toHaveLength(30);
      expect(series.every((point) => point.syncedToGarmin && Number.isFinite(point.weightKg))).toBe(true);
      expect(data.latest).toEqual(series[series.length - 1]);
    });

    it("falla cerrado en escritura cliente sin secreto, sin token o con token invalido", async () => {
      const { POST } = await import("@/app/api/body-composition/route");
      const url = "http://localhost/api/body-composition";

      const noSecret = await POST(jsonRequest(url, measurement, { "x-service-token": SERVICE_SECRET }));
      expect(noSecret.status).toBe(403);

      process.env.PULSETRACK_SERVICE_SECRET = SERVICE_SECRET;

      const noToken = await POST(jsonRequest(url, measurement));
      expect(noToken.status).toBe(401);

      const wrongToken = await POST(jsonRequest(url, measurement, { "x-service-token": "otro-valor" }));
      expect(wrongToken.status).toBe(403);

      const { GET } = await import("@/app/api/body-composition/route");
      const data = await readJson(await GET(new Request(url)));
      expect(data.series).toHaveLength(30);
    });

    it("rechaza apple_health con 403 incluso con token valido", async () => {
      process.env.PULSETRACK_SERVICE_SECRET = SERVICE_SECRET;
      const { POST } = await import("@/app/api/body-composition/route");
      const res = await POST(
        jsonRequest(
          "http://localhost/api/body-composition",
          { ...measurement, source: "apple_health" },
          { "x-service-token": SERVICE_SECRET },
        ),
      );
      expect(res.status).toBe(403);

      const unauthenticated = await POST(
        jsonRequest("http://localhost/api/body-composition", { ...measurement, source: "apple_health" }),
      );
      expect(unauthenticated.status).toBe(403);
    });

    it("acepta escritura de servicio, marca syncedToGarmin y deduplica por measuredAt y source", async () => {
      process.env.PULSETRACK_SERVICE_SECRET = SERVICE_SECRET;
      const { GET, POST } = await import("@/app/api/body-composition/route");
      const url = "http://localhost/api/body-composition";
      const headers = { "x-service-token": SERVICE_SECRET };

      const first = await POST(jsonRequest(url, measurement, headers));
      const firstData = await readJson(first);
      expect(first.status).toBe(201);
      expect(firstData.deduplicated).toBe(false);
      expect(firstData.item).toMatchObject({ weightKg: 77.4, syncedToGarmin: true, source: "renpho" });

      const second = await POST(jsonRequest(url, { ...measurement, weightKg: 99 }, headers));
      const secondData = await readJson(second);
      expect(second.status).toBe(200);
      expect(secondData.deduplicated).toBe(true);
      expect((secondData.item as JsonBody).weightKg).toBe(77.4);

      const listed = await readJson(await GET(new Request(url)));
      expect((listed.series as unknown[]).length).toBe(31);
    });

    it("valida weightKg positivo y finito", async () => {
      process.env.PULSETRACK_SERVICE_SECRET = SERVICE_SECRET;
      const { POST } = await import("@/app/api/body-composition/route");
      const headers = { "x-service-token": SERVICE_SECRET };
      const url = "http://localhost/api/body-composition";

      for (const weightKg of [0, -5, null, "NaN", "80"]) {
        const res = await POST(jsonRequest(url, { ...measurement, weightKg }, headers));
        expect(res.status).toBe(400);
      }
      const negativeFat = await POST(jsonRequest(url, { ...measurement, bodyFatPct: -1 }, headers));
      expect(negativeFat.status).toBe(400);
    });
  });
});
