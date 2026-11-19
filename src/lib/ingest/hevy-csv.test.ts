import { describe, expect, it } from "vitest";
import { parseHevyCsv } from "./hevy-csv";

describe("parseHevyCsv", () => {
  it("agrupa Push, Pull y Legs con ejercicios estándar y personalizados", () => {
    const result = parseHevyCsv([
      "title,start_time,end_time,description,exercise_title,superset_id,exercise_notes,set_index,set_type,weight_kg,reps,distance_km,duration_seconds,rpe",
      'Push,"2 Nov 2026, 18:00","2 Nov 2026, 19:00",,Bench Press (Barbell),,,0,warmup,20,10,,,',
      'Push,"2 Nov 2026, 18:00","2 Nov 2026, 19:00",,Bench Press (Barbell),1,Pausa,1,normal,62.375,8,,,8.5',
      'Push,"2 Nov 2026, 18:00","2 Nov 2026, 19:00",,Press lunar (Banda),1,,0,dropset,12.345,3,,,9',
      'Pull,"3 Nov 2026, 18:00",,,Pull Up,,,0,failure,,8,,,10',
      'Pull,"3 Nov 2026, 18:00",,,Remo lunar,,,0,normal,20,12,,,7',
      'Legs,"4 Nov 2026, 18:00",,,Squat (Barbell),,,0,normal,100,5,,,8',
      'Legs,"4 Nov 2026, 18:00",,,Remo lunar,,,0,normal,25,10,,,7',
    ].join("\n"));

    expect(result).toMatchObject({ exercisesCount: 5, setsCount: 7, duplicatesSkipped: 0, rejectedRows: 0, warnings: [] });
    expect(result.sessions).toMatchObject([
      {
        title: "Push", source: "hevy", startedAt: "2 Nov 2026, 18:00", endedAt: "2 Nov 2026, 19:00",
        setsCount: 3, totalVolumeKg: 736.04,
        exercises: [
          { name: "Bench Press (Barbell)", muscleGroup: null, equipment: null, isCustom: false },
          { name: "Press lunar (Banda)", isCustom: true },
        ],
        sets: [
          { setIndex: 0, setType: "warmup", weightKg: 20, reps: 10, rpe: null, notes: null },
          { setIndex: 1, setType: "normal", weightKg: 62.375, garminStepNote: "Bench Press (Barbell) | RPE 8.5 | Pausa" },
          { setIndex: 0, setType: "dropset" },
        ],
      },
      {
        title: "Pull", endedAt: null, setsCount: 2, totalVolumeKg: 240,
        exercises: [{ name: "Pull Up", isCustom: false }, { name: "Remo lunar", isCustom: true }],
        sets: [{ setType: "failure", weightKg: 0, reps: 8 }, { setType: "normal" }],
      },
      {
        title: "Legs", setsCount: 2, totalVolumeKg: 750,
        exercises: [{ name: "Squat (Barbell)", isCustom: false }, { name: "Remo lunar", isCustom: true }],
      },
    ]);
  });

  it("conserva comas, saltos internos y comillas en notas con BOM y CRLF", () => {
    const result = parseHevyCsv([
      "\uFEFFtitle,start_time,exercise_title,exercise_notes,set_index,reps,rpe",
      'Push,2026-11-02,"Bench Press (Barbell)","Primera, parte\r\nDijo ""pausa"".",0,8,8',
      "Push,2026-11-02,Push Up,,0,12,",
    ].join("\r\n"));

    expect(result.rejectedRows).toBe(0);
    expect(result.sessions[0]?.sets).toMatchObject([
      { notes: 'Primera, parte\r\nDijo "pausa".', garminStepNote: 'Bench Press (Barbell) | RPE 8 | Primera, parte Dijo "pausa".' },
      { notes: null, rpe: null, garminStepNote: "Push Up" },
    ]);
  });

  it("convierte libras cuando faltan kg y prioriza kg cuando ambos existen", () => {
    const result = parseHevyCsv([
      "title,start_time,exercise_title,set_index,weight_lbs,weight_kg,reps",
      "Push,2026-11-02,Bench Press,0,135,,8",
      "Push,2026-11-02,Bench Press,1,135,62,4",
      "Push,2026-11-02,Push Up,0,,,10",
    ].join("\n"));
    const imperial = parseHevyCsv([
      "title,start_time,exercise_title,set_index,weight_lbs,reps",
      "Push,2026-11-02,Bench Press,0,185,8",
    ].join("\n"));

    expect(result.sessions[0]?.sets.map((set) => set.weightKg)).toEqual([61.23, 62, 0]);
    expect(result.sessions[0]?.totalVolumeKg).toBe(737.84);
    expect(imperial.sessions[0]?.sets[0]?.weightKg).toBe(83.91);
  });

  it("acepta encabezados en español, decimales con coma y marcas de personalización", () => {
    const result = parseHevyCsv([
      "Título,Hora de inicio,Hora de fin,Nombre del ejercicio,Notas del ejercicio,Índice de serie,Tipo de serie,Peso (kg),Repeticiones,RPE,Es personalizado",
      'Torso,"2 nov, 18:00",,Press de banca,Control,0,calentamiento,"12,5",8,"8,5",sí',
      'Torso,"2 nov, 18:00",,Remo local,,0,al fallo,10,5,10,no',
    ].join("\n"));

    expect(result.rejectedRows).toBe(0);
    expect(result.sessions[0]).toMatchObject({
      title: "Torso", startedAt: "2 nov, 18:00", endedAt: null,
      exercises: [{ isCustom: true }, { isCustom: false }],
      sets: [
        { setType: "warmup", notes: "Control", weightKg: 12.5, rpe: 8.5 },
        { setType: "failure", weightKg: 10, rpe: 10 },
      ],
    });
  });

  it("deduplica por sesión, ejercicio e índice y conserva los IDs entre parseos", () => {
    const csv = [
      "title,start_time,exercise_title,set_index,weight_kg,reps",
      "Push,2026-11-02,A,0,50,8",
      "Push,2026-11-02,A,0,60,6",
      "Push,2026-11-02,A,1,55,6",
      "Pull,2026-11-02,A,0,55,6",
      "Push,2026-11-03,A,0,55,6",
    ].join("\n");
    const result = parseHevyCsv(csv);

    expect(parseHevyCsv(csv)).toEqual(result);
    expect(result).toMatchObject({ setsCount: 4, duplicatesSkipped: 1, exercisesCount: 1, rejectedRows: 0 });
    expect(result.sessions).toHaveLength(3);
    expect(new Set(result.sessions.map((session) => session.externalId)).size).toBe(3);
    expect(result.sessions[0]).toMatchObject({ setsCount: 2, totalVolumeKg: 730 });
    for (const session of result.sessions) {
      expect(session.externalId).toMatch(/^hevy-[a-f0-9]{16}$/);
      expect(session.exercises[0]?.externalId).toBe("a-af63dc4c8601ec8c");
      expect(session.sets[0]?.exerciseExternalId).toBe(session.exercises[0]?.externalId);
    }
  });

  it("rechaza valores corruptos y continúa con las filas válidas", () => {
    const result = parseHevyCsv([
      "title,start_time,exercise_title,set_index,weight_kg,weight_lbs,reps,rpe",
      "Push,2026-11-02,Press,0,NaN,,8,8",
      "Push,2026-11-02,Press,0,-20,,8,8",
      "Push,2026-11-02,Press,0,Infinity,,8,8",
      "Push,2026-11-02,Press,0,50,,0,8",
      "Push,2026-11-02,Press,0,50,,2.5,8",
      "Push,2026-11-02,Press,0,50,,8,14",
      "Push,2026-11-02,Press,0,,-0.001,8,8",
      "Push,2026-11-02,Press,0,50,,8,7",
    ].join("\n"));

    expect(result).toMatchObject({ setsCount: 1, rejectedRows: 7, duplicatesSkipped: 0 });
    expect(result.warnings).toEqual([
      "Línea 2: weight_kg debe ser finito y no negativo.",
      "Línea 3: weight_kg debe ser finito y no negativo.",
      "Línea 4: weight_kg debe ser finito y no negativo.",
      "Línea 5: reps debe ser un entero positivo.",
      "Línea 6: reps debe ser un entero positivo.",
      "Línea 7: rpe debe estar entre 1 y 10.",
      "Línea 8: weight_lbs debe ser finito y no negativo.",
    ]);
    expect(result.sessions[0]?.sets[0]?.rpe).toBe(7);
  });

  it("rechaza registros CSV malformados y conserva el número de línea", () => {
    const result = parseHevyCsv([
      "title,start_time,exercise_title,set_index,reps,exercise_notes",
      'Push,2026-11-02,Press,0,8,"línea uno\nlínea dos"',
      'Push,2026-11-02,Press,1,8,"nota"inválida',
      "Push,2026-11-02,Press,1,8",
      "Push,2026-11-02,Press,1,8,",
      'Push,2026-11-02,Press,2,8,"sin cierre',
    ].join("\n"));

    expect(result).toMatchObject({ setsCount: 2, rejectedRows: 3 });
    expect(result.warnings).toEqual([
      "Línea 4: fila CSV malformada.",
      "Línea 5: fila CSV malformada.",
      "Línea 7: fila CSV malformada.",
    ]);
  });
});
