import { describe, expect, it } from "vitest";
import {
  buildGarminStrengthWorkoutExport,
  buildLiftAiRecommendations,
  calculateDecoupledAcwr,
  calculateEpley1RM,
  calculateSessionTonnage,
  calculateWeeklyTonnage,
} from "./strength-metrics";
import type {
  AcwrResult,
  RoutineExercisePlan,
  RoutineTemplate,
  StrengthSessionRecord,
  StrengthSetInput,
} from "./types";

function strengthSet(overrides: Partial<StrengthSetInput> = {}): StrengthSetInput {
  return { exerciseExternalId: "bench", exerciseName: "Bench Press", setIndex: 0, weightKg: 100, reps: 5, rpe: 8, ...overrides };
}

function strengthSession(overrides: Partial<StrengthSessionRecord> = {}): StrengthSessionRecord {
  return {
    externalId: "session",
    title: "Push",
    date: "2026-11-02",
    startedAt: "2026-11-02T18:00:00Z",
    source: "hevy",
    totalVolumeKg: 500,
    sets: [strengthSet()],
    ...overrides,
  };
}

describe("calculateEpley1RM", () => {
  it.each([
    [100, 1, 100],
    [100, 5, 116.67],
    [80, 8, 101.33],
    [62.375, 1, 62.38],
  ])("estima %s kg por %s repeticiones como %s kg", (weightKg, reps, expected) => {
    expect(calculateEpley1RM(weightKg, reps)).toBe(expected);
  });

  it.each([[NaN, 5], [100, NaN], [Infinity, 5], [100, Infinity], [-100, 5], [0, 5], [100, -1], [100, 0], [100, 2.5]])(
    "rechaza %s kg por %s repeticiones",
    (weightKg, reps) => expect(calculateEpley1RM(weightKg, reps)).toBe(0),
  );
});

describe("calculateSessionTonnage", () => {
  it("incluye las series de calentamiento solo cuando se solicitan", () => {
    const sets = [
      strengthSet({ weightKg: 12.345, reps: 1 }),
      strengthSet({ weightKg: 20, reps: 3, setType: "warmup" }),
      strengthSet({ weightKg: 0, reps: 8 }),
      strengthSet({ weightKg: -1 }),
      strengthSet({ weightKg: NaN }),
      strengthSet({ reps: 0 }),
      strengthSet({ reps: Infinity }),
    ];

    expect(calculateSessionTonnage(sets)).toBe(12.35);
    expect(calculateSessionTonnage(sets, true)).toBe(72.35);
  });
});

describe("calculateWeeklyTonnage", () => {
  it("agrupa por lunes ISO y usa la fecha de inicio cuando falta la fecha", () => {
    const sessions = [
      strengthSession({ date: "2027-01-04", totalVolumeKg: 250 }),
      strengthSession({ date: "2027-01-03", startedAt: "2027-01-04T02:00:00Z", totalVolumeKg: 200.124 }),
      strengthSession({ date: "2026-12-28", totalVolumeKg: 300.124 }),
      strengthSession({ date: "", startedAt: "2027-01-04T23:45:00-06:00", totalVolumeKg: 150 }),
      strengthSession({ date: "", startedAt: "11 Jan 2027, 22:00", totalVolumeKg: 100 }),
      strengthSession({ date: "2027-02-30" }),
    ];

    expect(calculateWeeklyTonnage(sessions)).toEqual([
      { weekStart: "2026-12-28", tonnageKg: 500.25, sessionsCount: 2 },
      { weekStart: "2027-01-04", tonnageKg: 400, sessionsCount: 2 },
      { weekStart: "2027-01-11", tonnageKg: 100, sessionsCount: 1 },
    ]);
  });
});

describe("calculateDecoupledAcwr", () => {
  it.each([
    [0, 0.75, "undertraining", "Carga baja"],
    [20, 0.8, "optimal", "Carga óptima"],
    [100, 1, "optimal", "Carga óptima"],
    [220, 1.3, "optimal", "Carga óptima"],
    [240, 1.35, "caution", "Precaución"],
    [300, 1.5, "caution", "Precaución"],
    [500, 2, "high_risk", "Riesgo alto"],
  ])("clasifica la carga final %s con un ratio de %s", (load, ratio, zone, label) => {
    const result = calculateDecoupledAcwr([
      { date: "2026-11-03", load },
      { date: "2026-11-02", load: 100 },
    ]);
    expect(result).toEqual({ acuteLoad: 75 + load / 4, chronicLoad: 100, ratio, zone, label });
  });

  it("aplica el factor crónico a los días anteriores al último pulso", () => {
    const result = calculateDecoupledAcwr([
      { date: "2026-11-02", load: 80 },
      { date: "2026-11-03", load: 120 },
      { date: "2026-11-04", load: 500 },
    ]);
    expect(result).toMatchObject({ acuteLoad: 192.5, chronicLoad: 82.76, ratio: 2.326 });
  });

  it("suma cargas diarias, descarta cargas inválidas y rellena días sin carga", () => {
    const result = calculateDecoupledAcwr([
      { date: "2026-11-04", load: 200 },
      { date: "2026-11-02", load: 100 },
      { date: "2026-11-04", load: 100 },
      { date: "2026-11-04", load: -1 },
      { date: "2026-11-05", load: Infinity },
      { date: "2026-11-05", load: NaN },
      { date: "sin fecha", load: 1000 },
    ]);
    expect(result).toMatchObject({ acuteLoad: 131.25, chronicLoad: 93.1, ratio: 1.41, zone: "caution" });
  });

  it("devuelve ratio cero cuando falta una carga crónica positiva", () => {
    expect(calculateDecoupledAcwr([])).toMatchObject({ acuteLoad: 0, chronicLoad: 0, ratio: 0, zone: "undertraining" });
    expect(calculateDecoupledAcwr([{ date: "2026-11-03", load: 50 }]))
      .toMatchObject({ acuteLoad: 50, chronicLoad: 0, ratio: 0 });
    expect(calculateDecoupledAcwr([{ date: "2026-11-02", load: 0 }, { date: "2026-11-03", load: 100 }]))
      .toMatchObject({ acuteLoad: 25, chronicLoad: 0, ratio: 0 });
  });
});

describe("buildLiftAiRecommendations", () => {
  const optimal: AcwrResult = { acuteLoad: 100, chronicLoad: 100, ratio: 1, zone: "optimal", label: "Carga óptima" };

  it("usa los máximos del ejercicio y el RPE de su última serie válida", () => {
    const sessions = [
      strengthSession({ sets: [strengthSet({ weightKg: 100, reps: 1, rpe: 9 })] }),
      strengthSession({
        date: "2026-11-03",
        startedAt: "2026-11-03T18:00:00Z",
        sets: [
          strengthSet({ weightKg: 80, setIndex: 2, rpe: 8.5 }),
          strengthSet({ weightKg: 95, setIndex: 1, reps: 10, rpe: 10 }),
          strengthSet({ weightKg: Infinity, setIndex: 3, rpe: 10 }),
          strengthSet({ exerciseExternalId: "row", exerciseName: "Remo", weightKg: 50, rpe: null }),
          strengthSet({ exerciseExternalId: "invalid", reps: 0 }),
        ],
      }),
    ];

    expect(buildLiftAiRecommendations(sessions, optimal, 70)).toMatchObject([
      { exerciseExternalId: "bench", exerciseName: "Bench Press", currentTopKg: 100, currentE1rmKg: 126.67, suggestedKg: 102.5, deltaKg: 2.5 },
      { exerciseExternalId: "row", exerciseName: "Remo", currentTopKg: 50, suggestedKg: 52.5, deltaKg: 2.5 },
    ]);
  });

  it.each([
    { zone: "caution", rpe: 8, recoveryScore: 80, suggestedKg: 100, deltaKg: 0 },
    { zone: "optimal", rpe: 9, recoveryScore: 80, suggestedKg: 100, deltaKg: 0 },
    { zone: "optimal", rpe: 8, recoveryScore: 50, suggestedKg: 100, deltaKg: 0 },
    { zone: "high_risk", rpe: 8, recoveryScore: 80, suggestedKg: 90, deltaKg: -10 },
    { zone: "optimal", rpe: 8, recoveryScore: 49, suggestedKg: 90, deltaKg: -10 },
  ] satisfies Array<{ zone: AcwrResult["zone"]; rpe: number; recoveryScore: number; suggestedKg: number; deltaKg: number }>)(
    "recomienda $suggestedKg kg con zona $zone, recuperación $recoveryScore y RPE $rpe",
    ({ zone, rpe, recoveryScore, suggestedKg, deltaKg }) => {
      const sessions = [strengthSession({ sets: [strengthSet({ rpe })] })];
      const recommendations = buildLiftAiRecommendations(sessions, { ...optimal, zone }, recoveryScore);
      expect(recommendations).toMatchObject([{ suggestedKg, deltaKg, rationale: expect.stringMatching(/\S/) }]);
    },
  );

  it("redondea la descarga a incrementos de 2.5 kg sin subir la carga", () => {
    const sessions = [strengthSession({ sets: [
      strengthSet({ weightKg: 63 }),
      strengthSet({ exerciseExternalId: "row", weightKg: 2 }),
    ] })];
    expect(buildLiftAiRecommendations(sessions, optimal, 40)).toMatchObject([
      { suggestedKg: 57.5, deltaKg: -5.5 },
      { suggestedKg: 0, deltaKg: -2 },
    ]);
  });
});

describe("buildGarminStrengthWorkoutExport", () => {
  const exercises = [
    { exerciseName: "Sentadilla frontal", category: "SQUAT" },
    { exerciseName: "Incline Bench Press (Dumbbell)", category: "BENCH_PRESS" },
    { exerciseName: "Peso muerto rumano", category: "DEADLIFT" },
    { exerciseName: "Weighted Pull-up", category: "PULL_UP" },
    { exerciseName: "Seated Cable Row", category: "ROW" },
    { exerciseName: "Press de hombros", category: "SHOULDER_PRESS" },
    { exerciseName: "Plancha lateral", category: "CORE" },
    { exerciseName: "Rotación\nlunar", category: "STRENGTH_CUSTOM", notes: " Pausa\r\n al final\u0000\t sin impulso. " },
  ];
  const routine: RoutineTemplate = {
    id: "routine-1",
    name: "Rutina de fuerza",
    splitTag: "Custom",
    exercises: exercises.map(({ exerciseName, notes }, index) => ({
      exerciseExternalId: `exercise-${index}`,
      exerciseName,
      sets: 3,
      targetReps: "8-10",
      targetRpe: 8,
      restSeconds: 90,
      notes: notes ?? null,
    })),
  };

  it("mapea las categorías y limpia la nota para ejercicios personalizados", () => {
    const generatedAt = "2026-11-03T00:00:00Z";
    const workout = buildGarminStrengthWorkoutExport(routine, generatedAt);
    expect(workout).toMatchObject({ routineId: routine.id, workoutName: routine.name, sportType: "STRENGTH_TRAINING", generatedAt });
    expect(workout.steps.map((step) => step.exerciseCategory)).toEqual(exercises.map(({ category }) => category));
    expect(workout.steps[0]?.garminStepNote).toBe("Sentadilla frontal | RPE 8");
    expect(workout.steps[7]).toMatchObject({ stepOrder: 8, sets: 3, targetReps: "8-10", restSeconds: 90, garminStepNote: "Rotación lunar | RPE 8 | Pausa al final sin impulso." });
  });

  it("trunca la nota sin dividir un par sustituto", () => {
    const prefix = "Rotación lunar | RPE 8 | ";
    const text = "a".repeat(199 - prefix.length);
    const custom = { exerciseExternalId: "custom", exerciseName: "Rotación lunar", sets: 3, targetReps: "8-10", targetRpe: 8, restSeconds: 90, notes: `${text}\ud834\udd1e sigue` };
    const workout = buildGarminStrengthWorkoutExport({ ...routine, exercises: [custom] });
    expect(workout.steps[0]?.garminStepNote).toBe(prefix + text);
    expect(workout.steps[0]?.garminStepNote.length).toBeLessThanOrEqual(200);
  });

  it("conserva el ID al cambiar la fecha de generación", () => {
    const first = buildGarminStrengthWorkoutExport(routine, "2026-11-03T00:00:00Z");
    const second = buildGarminStrengthWorkoutExport(routine, "2026-11-04T00:00:00Z");
    const changed = buildGarminStrengthWorkoutExport({ ...routine, name: "Rutina modificada" });
    expect(first.exportId).toMatch(/^garmin-wo-[0-9a-f]{16}$/);
    expect(second.exportId).toBe(first.exportId);
    expect(changed.exportId).not.toBe(first.exportId);
  });

  it("elimina caracteres bidi de formato \\p{Cf} en garminStepNote", () => {
    const custom: RoutineExercisePlan = {
      exerciseExternalId: "custom-bidi",
      exerciseName: "Remo\u202E Polea",
      sets: 3,
      targetReps: "10",
      targetRpe: 8,
      restSeconds: 60,
      notes: "Control\u200B estricto",
    };
    const workout = buildGarminStrengthWorkoutExport({ ...routine, exercises: [custom] });
    expect(workout.steps[0]?.garminStepNote).toBe("Remo Polea | RPE 8 | Control estricto");
  });

  it("filtra Lift AI a la ventana reciente de 28 dias", () => {
    const acwr: AcwrResult = { acuteLoad: 1200, chronicLoad: 1200, ratio: 1, zone: "optimal", label: "Carga óptima" };
    const oldSession: StrengthSessionRecord = {
      externalId: "s-old",
      title: "Push antiguo",
      date: "2026-09-01",
      startedAt: "2026-09-01T10:00:00Z",
      source: "hevy",
      totalVolumeKg: 2000,
      sets: [{ exerciseExternalId: "bench", exerciseName: "Bench Press", setIndex: 0, weightKg: 140, reps: 5, rpe: 8 }],
    };
    const recentSession: StrengthSessionRecord = {
      externalId: "s-new",
      title: "Push actual",
      date: "2026-11-18",
      startedAt: "2026-11-18T10:00:00Z",
      source: "hevy",
      totalVolumeKg: 1200,
      sets: [{ exerciseExternalId: "bench", exerciseName: "Bench Press", setIndex: 0, weightKg: 90, reps: 5, rpe: 8 }],
    };
    const recs = buildLiftAiRecommendations([oldSession, recentSession], acwr, 85);
    expect(recs[0]?.currentTopKg).toBe(90);
    expect(recs[0]?.suggestedKg).toBe(92.5);
  });
});
