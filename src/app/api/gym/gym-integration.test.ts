import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as getBodyComposition, POST as postBodyComposition } from "@/app/api/body-composition/route";
import { POST as postCatalog } from "@/app/api/gym/catalog/route";
import { POST as postExportGarmin } from "@/app/api/gym/export-garmin/route";
import { GET as getGymSessions, POST as postGymSession } from "@/app/api/gym/sessions/route";
import { POST as postHevyCsv } from "@/app/api/ingest/hevy/route";
import { resetGymStore } from "@/lib/sports/gym-store";

describe("Integracion real modulo Gym & RENPHO sin mocks", () => {
  beforeEach(() => {
    resetGymStore();
    delete process.env.PULSETRACK_SERVICE_SECRET;
  });

  afterEach(() => {
    resetGymStore();
    delete process.env.PULSETRACK_SERVICE_SECRET;
  });

  it("calcula ACWR, tonelaje semanal y recomendaciones Lift AI reales", async () => {
    const res = await getGymSessions(new Request("http://localhost/api/gym/sessions"));
    const data = (await res.json()) as {
      ok: boolean;
      routines: Array<{ id: string; splitTag: string }>;
      sessions: Array<{ source: string; sets: unknown[] }>;
      weeklyTonnage: Array<{ weekStart: string; tonnageKg: number }>;
      acwr: { ratio: number; zone: string };
      recommendations: Array<{ exerciseName: string; currentE1rmKg: number; suggestedKg: number }>;
    };

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.routines.map((r) => r.splitTag)).toEqual(["Push", "Pull", "Legs"]);
    expect(data.sessions[0]?.source).toBe("pulsetrack");
    expect(Array.isArray(data.sessions[0]?.sets)).toBe(true);
    expect(data.weeklyTonnage.length).toBeGreaterThanOrEqual(4);
    expect(data.acwr.ratio).toBeGreaterThan(0);
    expect(data.recommendations.length).toBeGreaterThan(0);
    expect(data.recommendations.every((rec) => rec.currentE1rmKg > 0 && rec.suggestedKg > 0)).toBe(
      true,
    );
  });

  it("exporta rutina Push hacia Garmin con garminStepNote real e ingiere CSV Hevy al tablero Gym", async () => {
    const exportRes = await postExportGarmin(
      new Request("http://localhost/api/gym/export-garmin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ routineId: "routine-push" }),
      }),
    );
    const exportJson = (await exportRes.json()) as {
      ok: boolean;
      workout: {
        exportId: string;
        sportType: string;
        steps: Array<{ exerciseCategory: string; garminStepNote: string }>;
      };
    };

    expect(exportRes.status).toBe(200);
    expect(exportJson.workout.sportType).toBe("STRENGTH_TRAINING");
    expect(exportJson.workout.exportId.startsWith("garmin-wo-")).toBe(true);
    expect(exportJson.workout.steps[0]?.exerciseCategory).toBe("BENCH_PRESS");
    expect(exportJson.workout.steps[0]?.garminStepNote).toContain("Bench Press");

    const catalogRes = await postCatalog(
      new Request("http://localhost/api/gym/catalog", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Remo Pendlay Custom",
          muscleGroup: "back",
          equipment: "barbell",
          defaultStepNote: "Pausa en suelo",
        }),
      }),
    );
    expect(catalogRes.status).toBe(201);

    const hevyCsv = [
      "title,start_time,end_time,exercise_title,exercise_notes,set_index,set_type,weight_kg,reps,rpe",
      'Pull Extra,"2026-11-18 19:00","2026-11-18 20:00","Remo Pendlay Custom","Explosivo",0,normal,85,6,8.5',
    ].join("\n");

    const hevyRes = await postHevyCsv(
      new Request("http://localhost/api/ingest/hevy", {
        method: "POST",
        headers: { "content-type": "application/json", "x-user-id": "integracion-user" },
        body: JSON.stringify({ csv: hevyCsv }),
      }),
    );
    expect(hevyRes.status).toBe(200);

    const afterRes = await getGymSessions(
      new Request("http://localhost/api/gym/sessions", {
        headers: { "x-user-id": "integracion-user" },
      }),
    );
    const afterData = (await afterRes.json()) as {
      sessions: Array<{ title: string; source: string; sets: unknown[] }>;
    };
    expect(afterData.sessions.some((s) => s.title === "Pull Extra" && s.source === "hevy")).toBe(
      true,
    );
  });

  it("protege /api/body-composition bajo ADR-001 (solo servicio con token)", async () => {
    const getRes = await getBodyComposition(new Request("http://localhost/api/body-composition"));
    const getJson = (await getRes.json()) as {
      authority: string;
      latest: { syncedToGarmin: boolean };
    };
    expect(getRes.status).toBe(200);
    expect(getJson.authority).toBe("renpho->garmin");
    expect(getJson.latest.syncedToGarmin).toBe(true);

    process.env.PULSETRACK_SERVICE_SECRET = "gym-secret-token";
    const clientAttempt = await postBodyComposition(
      new Request("http://localhost/api/body-composition", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ weightKg: 76.2 }),
      }),
    );
    expect(clientAttempt.status).toBe(401);

    const oversized = await postBodyComposition(
      new Request("http://localhost/api/body-composition", {
        method: "POST",
        headers: { "content-type": "application/json", "x-service-token": "gym-secret-token" },
        body: JSON.stringify({ weightKg: 76.2, filler: "x".repeat(70_000) }),
      }),
    );
    expect(oversized.status).toBe(413);
  });

  it("aplica cotas humanas, conserva fecha calendario en startedAt y reporta persistence Hevy", async () => {
    const emptySlug = await postCatalog(
      new Request("http://localhost/api/gym/catalog", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "!!!", muscleGroup: "back", equipment: "---" }),
      }),
    );
    expect(emptySlug.status).toBe(400);

    const overflowWeight = await postGymSession(
      new Request("http://localhost/api/gym/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "Push",
          sets: [{ exerciseName: "Bench Press", weightKg: 5000, reps: 5 }],
        }),
      }),
    );
    expect(overflowWeight.status).toBe(400);

    const tzSession = await postGymSession(
      new Request("http://localhost/api/gym/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "Nocturno Local",
          startedAt: "2026-11-18T22:30:00-06:00",
          sets: [{ exerciseName: "Bench Press", weightKg: 80, reps: 5 }],
        }),
      }),
    );
    const tzData = (await tzSession.json()) as { session: { date: string } };
    expect(tzSession.status).toBe(201);
    expect(tzData.session.date).toBe("2026-11-18");

    const hevyCsv = [
      "title,start_time,exercise_title,set_index,weight_kg,reps",
      'Push,"2026-11-18 19:00",Bench Press,0,80,5',
    ].join("\n");
    const hevyFirst = await postHevyCsv(
      new Request("http://localhost/api/ingest/hevy", {
        method: "POST",
        headers: { "content-type": "application/json", "x-user-id": "dedup-user" },
        body: JSON.stringify({ csv: hevyCsv }),
      }),
    );
    const hevySecond = await postHevyCsv(
      new Request("http://localhost/api/ingest/hevy", {
        method: "POST",
        headers: { "content-type": "application/json", "x-user-id": "dedup-user" },
        body: JSON.stringify({ csv: hevyCsv }),
      }),
    );
    const firstBody = (await hevyFirst.json()) as { persistence: { inserted: number; deduplicated: number } };
    const secondBody = (await hevySecond.json()) as { persistence: { inserted: number; deduplicated: number } };
    expect(firstBody.persistence).toEqual({ inserted: 1, deduplicated: 0 });
    expect(secondBody.persistence).toEqual({ inserted: 0, deduplicated: 1 });
  });
});
