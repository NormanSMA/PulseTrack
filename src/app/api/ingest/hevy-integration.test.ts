import { describe, expect, it } from "vitest";
import { POST } from "@/app/api/ingest/hevy/route";

describe("POST /api/ingest/hevy (integracion real sin mocks)", () => {
  it("procesa 3 rutinas Hevy reales, notas con comas, lbs, duplicados y rechaza NaN", async () => {
    const csv = [
      "title,start_time,end_time,exercise_title,exercise_notes,set_index,set_type,weight_kg,weight_lbs,reps,rpe",
      'Push,"2026-11-16 18:00","2026-11-16 19:05","Bench Press (Barbell)","Pausa 2s, pecho",0,normal,80,,6,8.5',
      'Push,"2026-11-16 18:00","2026-11-16 19:05","Bench Press (Barbell)","Pausa 2s, pecho",0,normal,80,,6,8.5',
      'Pull,"2026-11-17 18:00","2026-11-17 19:00","Lat Pulldown (Cable)",Control,0,normal,,135,10,8',
      'Legs,"2026-11-18 18:00","2026-11-18 19:10","Back Squat",Profunda,0,normal,120,,5,9',
      'Legs,"2026-11-18 18:00","2026-11-18 19:10","Back Squat",Corrupta,1,normal,NaN,,5,8',
    ].join("\n");

    const response = await POST(
      new Request("http://localhost/api/ingest/hevy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ csv }),
      }),
    );

    const payload = (await response.json()) as {
      ok: boolean;
      summary: {
        sessionsCount: number;
        exercisesCount: number;
        setsCount: number;
        duplicatesSkipped: number;
        rejectedRows: number;
      };
      sessions: Array<{
        externalId: string;
        title: string;
        sets: Array<{ weightKg: number; notes: string | null }>;
      }>;
    };

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.summary).toEqual({
      sessionsCount: 3,
      exercisesCount: 3,
      setsCount: 3,
      duplicatesSkipped: 1,
      rejectedRows: 1,
    });
    expect(payload.sessions.map((s) => s.title)).toEqual(["Push", "Pull", "Legs"]);
    expect(payload.sessions[0]?.sets[0]?.notes).toBe("Pausa 2s, pecho");
    expect(payload.sessions[1]?.sets[0]?.weightKg).toBe(61.23);
    expect(payload.sessions[0]?.externalId.startsWith("hevy-")).toBe(true);
  });
});
