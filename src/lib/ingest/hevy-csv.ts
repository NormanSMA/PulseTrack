import type { HevyExerciseMeta, HevyParseResult, HevySessionRecord, HevySetType } from "./types";

const HEADER_ALIASES = {
  title: ["titulo", "titulo_entrenamiento", "nombre_entrenamiento", "entrenamiento", "rutina"],
  start_time: ["inicio", "hora_inicio", "fecha_inicio", "fecha_hora_inicio", "hora_de_inicio", "tiempo_inicio"],
  end_time: ["fin", "hora_fin", "fecha_fin", "fecha_hora_fin", "hora_de_fin", "tiempo_fin"],
  exercise_title: ["ejercicio", "titulo_ejercicio", "titulo_del_ejercicio", "nombre_ejercicio", "nombre_del_ejercicio"],
  exercise_notes: ["notas", "notas_ejercicio", "notas_del_ejercicio"],
  set_index: ["serie", "indice_serie", "indice_de_serie", "numero_serie", "numero_de_serie"],
  set_type: ["tipo_serie", "tipo_de_serie"],
  weight_kg: ["peso_kg", "peso_en_kg", "kilogramos"],
  weight_lbs: ["peso_lb", "peso_lbs", "peso_en_libras", "peso_libras", "libras"],
  reps: ["repeticiones"],
  rpe: ["esfuerzo_percibido"],
  is_custom: ["personalizado", "es_personalizado"],
};

type Column = keyof typeof HEADER_ALIASES;

const SET_TYPES: ReadonlyMap<string, HevySetType> = new Map([
  ["normal", "normal"],
  ["warmup", "warmup"],
  ["warm-up", "warmup"],
  ["calentamiento", "warmup"],
  ["dropset", "dropset"],
  ["drop set", "dropset"],
  ["descendente", "dropset"],
  ["failure", "failure"],
  ["fallo", "failure"],
  ["al fallo", "failure"],
]);

const COMMON_STANDARD_EXERCISES = new Set([
  "bench press", "bench press (barbell)", "bench press (dumbbell)", "press de banca",
  "incline bench press (barbell)", "incline bench press (dumbbell)", "chest press (machine)",
  "overhead press", "overhead press (barbell)", "shoulder press (dumbbell)",
  "push up", "push-up", "push ups", "flexiones", "lateral raise (dumbbell)",
  "triceps pushdown", "triceps pushdown (cable)", "triceps dip", "bicep curl (dumbbell)",
  "pull up", "pull-up", "pull ups", "weighted pull-up", "dominadas", "chin up",
  "lat pulldown", "lat pulldown (cable)", "seated cable row", "seated row (cable)",
  "bent over row (barbell)", "bent over row (dumbbell)", "face pull",
  "squat", "squat (barbell)", "back squat", "sentadilla", "sentadilla con barra", "front squat",
  "deadlift", "deadlift (barbell)", "romanian deadlift", "romanian deadlift (barbell)", "peso muerto",
  "leg press", "leg press (machine)", "leg extension (machine)", "seated leg curl (machine)",
  "lying leg curl (machine)", "standing calf raise", "hip thrust (barbell)", "lunge (dumbbell)",
]);

interface CsvRecord {
  fields: string[];
  line: number;
  malformed: boolean;
}

function readCsv(text: string): CsvRecord[] {
  const records: CsvRecord[] = [];
  let fields: string[] = [];
  let field = "";
  let state: "start" | "unquoted" | "quoted" | "closed" = "start";
  let line = 1;
  let recordLine = 1;
  let malformed = false;

  function endRecord() {
    if (fields.length || field.trim() || state === "closed" || malformed) {
      records.push({ fields: [...fields, field], line: recordLine, malformed });
    }
    fields = [];
    field = "";
    state = "start";
    malformed = false;
  }

  for (let index = text.startsWith("\uFEFF") ? 1 : 0; index < text.length; index++) {
    const char = text.charAt(index);
    if (state === "quoted") {
      if (char === '"' && text.charAt(index + 1) === '"') {
        field += '"';
        index++;
      } else if (char === '"') {
        state = "closed";
      } else {
        field += char;
        if (char === "\n" || (char === "\r" && text.charAt(index + 1) !== "\n")) line++;
      }
    } else if (char === "\n" || char === "\r") {
      endRecord();
      if (char === "\r" && text.charAt(index + 1) === "\n") index++;
      recordLine = ++line;
    } else if (char === ",") {
      fields.push(field);
      field = "";
      state = "start";
    } else if (char === '"' && state === "start") {
      state = "quoted";
    } else {
      if (char === '"' || state === "closed") malformed = true;
      field += char;
      state = "unquoted";
    }
  }

  if (state === "quoted") malformed = true;
  endRecord();
  return records;
}

function slug(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function fnv1a64(text: string): string {
  let value = BigInt("0xcbf29ce484222325");
  const prime = BigInt("0x100000001b3");
  const bytes = new TextEncoder().encode(text);

  bytes.forEach((byte) => {
    value = BigInt.asUintN(64, (value ^ BigInt(byte)) * prime);
  });
  return value.toString(16).padStart(16, "0");
}

function numberFrom(text: string): number {
  if (!/^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:e[+-]?\d+)?$/i.test(text)) return NaN;
  return Number(text.replace(",", "."));
}

function roundKg(value: number): number {
  const cents = value * 100;
  return cents < Number.MAX_SAFE_INTEGER ? Math.round(cents + cents * Number.EPSILON) / 100 : value;
}

const MAX_CSV_ROWS = 50_000;
const MAX_WARNINGS = 50;

export function parseHevyCsv(csvText: string): HevyParseResult {
  const result: HevyParseResult = {
    sessions: [], exercisesCount: 0, setsCount: 0, duplicatesSkipped: 0, rejectedRows: 0, warnings: [],
  };
  const [header, ...rawRows] = readCsv(csvText);
  if (!header) return result;
  const rows = rawRows.slice(0, MAX_CSV_ROWS);
  if (rawRows.length > MAX_CSV_ROWS) {
    result.rejectedRows += rawRows.length - MAX_CSV_ROWS;
    result.warnings.push(`Archivo truncado a ${MAX_CSV_ROWS} filas para proteger memoria.`);
  }

  const headers = header.fields.map((field) => slug(field).replace(/-/g, "_"));
  const columns = new Map<Column, number>();
  (Object.keys(HEADER_ALIASES) as Column[]).forEach((column) => {
    const canonicalIndex = headers.indexOf(column);
    const index = canonicalIndex >= 0 ? canonicalIndex : headers.findIndex((name) => HEADER_ALIASES[column].includes(name));
    if (index >= 0) columns.set(column, index);
  });

  const required: Column[] = ["title", "start_time", "exercise_title", "set_index", "reps"];
  const missing = required.filter((column) => !columns.has(column));
  if (header.malformed || missing.length) {
    result.rejectedRows = rows.length;
    result.warnings.push(header.malformed
      ? `Línea ${header.line}: encabezado CSV malformado.`
      : `Línea ${header.line}: faltan columnas: ${missing.join(", ")}.`);
    return result;
  }

  const sessions = new Map<string, { record: HevySessionRecord; setKeys: Set<string>; exerciseIds: Set<string> }>();
  const exercises = new Map<string, HevyExerciseMeta>();

  for (const row of rows) {
    const reject = (reason: string) => {
      result.rejectedRows++;
      if (result.warnings.length < MAX_WARNINGS) {
        result.warnings.push(`Línea ${row.line}: ${reason}.`);
      }
    };
    if (row.malformed || row.fields.length !== headers.length) {
      reject("fila CSV malformada");
      continue;
    }

    const read = (column: Column) => row.fields[columns.get(column) ?? -1] ?? "";
    const title = read("title").trim();
    const startedAt = read("start_time").trim();
    const endedAt = read("end_time").trim() || null;
    const exerciseName = read("exercise_title").trim();
    if (!title || !startedAt || !exerciseName) {
      reject("title, start_time y exercise_title son obligatorios");
      continue;
    }

    const setIndex = numberFrom(read("set_index").trim());
    const reps = numberFrom(read("reps").trim());
    const kg = read("weight_kg").trim();
    const lbs = read("weight_lbs").trim();
    const rawWeight = kg || lbs ? numberFrom(kg || lbs) : 0;
    const rpeText = read("rpe").trim();
    const rpe = rpeText ? numberFrom(rpeText) : null;
    const setType = SET_TYPES.get(read("set_type").trim().toLowerCase() || "normal");

    if (!Number.isSafeInteger(setIndex) || setIndex < 0) {
      reject("set_index debe ser un entero no negativo");
      continue;
    }
    if (!Number.isFinite(rawWeight) || rawWeight < 0) {
      reject(`${kg ? "weight_kg" : "weight_lbs"} debe ser finito y no negativo`);
      continue;
    }
    if (!Number.isSafeInteger(reps) || reps <= 0) {
      reject("reps debe ser un entero positivo");
      continue;
    }
    if (rpe !== null && (!Number.isFinite(rpe) || rpe < 1 || rpe > 10)) {
      reject("rpe debe estar entre 1 y 10");
      continue;
    }
    if (!setType) {
      reject("set_type desconocido");
      continue;
    }

    const weightKg = !kg && lbs ? roundKg(rawWeight * 0.45359237) : rawWeight;
    const exerciseKey = exerciseName.normalize("NFC").toLowerCase().replace(/\s+/g, " ");
    let exercise = exercises.get(exerciseKey);
    const exerciseExternalId = exercise?.externalId ?? `${slug(exerciseKey) || "exercise"}-${fnv1a64(exerciseKey)}`;
    const sessionKey = `${title}|${startedAt}`;
    const setKey = `${exerciseExternalId}|${setIndex}`;
    let session = sessions.get(sessionKey);
    if (session?.setKeys.has(setKey)) {
      result.duplicatesSkipped++;
      continue;
    }
    const volume = (session?.record.totalVolumeKg ?? 0) + weightKg * reps;
    if (!Number.isFinite(volume)) {
      reject("volumen fuera de rango");
      continue;
    }

    if (!exercise) {
      const custom = read("is_custom").trim().toLowerCase();
      exercise = {
        externalId: exerciseExternalId,
        name: exerciseName,
        muscleGroup: null,
        equipment: null,
        isCustom: /^(1|true|yes|sí|si)$/.test(custom)
          || (!/^(0|false|no)$/.test(custom) && !COMMON_STANDARD_EXERCISES.has(exerciseKey)),
      };
      exercises.set(exerciseKey, exercise);
    }
    if (!session) {
      session = {
        record: {
          externalId: `hevy-${fnv1a64(sessionKey)}`, title, source: "hevy", startedAt, endedAt,
          totalVolumeKg: 0, setsCount: 0, exercises: [], sets: [],
        },
        setKeys: new Set(),
        exerciseIds: new Set(),
      };
      sessions.set(sessionKey, session);
      result.sessions.push(session.record);
    }
    if (!session.exerciseIds.has(exerciseExternalId)) {
      session.record.exercises.push(exercise);
      session.exerciseIds.add(exerciseExternalId);
    }

    // Al exportar estos textos a CSV/hojas de calculo en fases futuras, prefijar celdas (=, +, -, @).
    const notesText = read("exercise_notes");
    const notes = notesText.trim() ? notesText : null;
    const garminStepNote = [exerciseName, rpe === null ? "" : `RPE ${rpe}`, notes ?? ""]
      .map((part) => part.replace(/\s+/g, " ").trim()).filter(Boolean).join(" | ");
    session.record.sets.push({ exerciseExternalId, exerciseName, setIndex, weightKg, reps, rpe, setType, notes, garminStepNote });
    session.record.endedAt ??= endedAt;
    session.record.totalVolumeKg = volume;
    session.record.setsCount++;
    session.setKeys.add(setKey);
    result.setsCount++;
  }

  for (const session of result.sessions) session.totalVolumeKg = roundKg(session.totalVolumeKg);
  result.exercisesCount = exercises.size;
  return result;
}
