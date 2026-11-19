import { NextResponse } from "next/server";
import {
  BiometricAuthorityError,
  assertBiometricAuthority,
  isAppleHealthSource,
} from "@/lib/ingest/swr-policy";
import {
  insertCustomExercise,
  insertSession,
  resolveActorKey,
} from "@/lib/sports/gym-store";
import type { StrengthSetInput } from "@/lib/sports/types";

const MAX_CSV_BYTES = 10 * 1024 * 1024;

interface HevyImportSummary {
  sessionsCount: number;
  exercisesCount: number;
  setsCount: number;
  duplicatesSkipped: number;
  rejectedRows: number;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readCountField(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.trunc(value);
  }
  if (Array.isArray(value)) {
    return value.length;
  }
  return null;
}

function extractSummaryAndSessions(parsed: unknown): {
  summary: HevyImportSummary;
  sessions: readonly unknown[];
} {
  if (!isPlainRecord(parsed)) {
    return {
      summary: {
        sessionsCount: 0,
        exercisesCount: 0,
        setsCount: 0,
        duplicatesSkipped: 0,
        rejectedRows: 0,
      },
      sessions: [],
    };
  }

  const sessions = Array.isArray(parsed.sessions) ? parsed.sessions : [];
  const rawSummary = isPlainRecord(parsed.summary) ? parsed.summary : null;

  const exerciseKeys = new Set<string>();
  let computedSets = 0;

  for (const session of sessions) {
    if (!isPlainRecord(session)) {
      continue;
    }
    if (Array.isArray(session.exercises)) {
      for (const exercise of session.exercises) {
        if (!isPlainRecord(exercise)) {
          continue;
        }
        const key =
          typeof exercise.externalId === "string"
            ? exercise.externalId
            : typeof exercise.name === "string"
              ? exercise.name
              : typeof exercise.title === "string"
                ? exercise.title
                : "";
        if (key.length > 0) {
          exerciseKeys.add(key);
        }
        if (Array.isArray(exercise.sets)) {
          computedSets += exercise.sets.length;
        }
      }
    }
    if (Array.isArray(session.sets)) {
      computedSets += session.sets.length;
      for (const setItem of session.sets) {
        if (!isPlainRecord(setItem)) {
          continue;
        }
        const key =
          typeof setItem.exerciseExternalId === "string"
            ? setItem.exerciseExternalId
            : typeof setItem.exerciseName === "string"
              ? setItem.exerciseName
              : typeof setItem.exerciseTitle === "string"
                ? setItem.exerciseTitle
                : "";
        if (key.length > 0) {
          exerciseKeys.add(key);
        }
      }
    }
  }

  const catalogCount = readCountField(parsed.catalog);
  const topSetsCount = readCountField(parsed.sets);

  const sessionsCount =
    readCountField(rawSummary?.sessionsCount) ?? sessions.length;
  const exercisesCount =
    readCountField(rawSummary?.exercisesCount) ??
    readCountField(parsed.exercisesCount) ??
    catalogCount ??
    exerciseKeys.size;
  const setsCount =
    readCountField(rawSummary?.setsCount) ??
    readCountField(parsed.setsCount) ??
    topSetsCount ??
    computedSets;
  const duplicatesSkipped =
    readCountField(rawSummary?.duplicatesSkipped) ??
    readCountField(parsed.duplicatesSkipped) ??
    0;
  const rejectedRows =
    readCountField(rawSummary?.rejectedRows) ??
    readCountField(parsed.rejectedRows) ??
    0;

  return {
    summary: {
      sessionsCount,
      exercisesCount,
      setsCount,
      duplicatesSkipped,
      rejectedRows,
    },
    sessions,
  };
}

function isFileLike(value: unknown): value is { text: () => Promise<string>; size?: number } {
  return (
    typeof value === "object" &&
    value !== null &&
    "text" in value &&
    typeof (value as { text?: unknown }).text === "function"
  );
}

export async function POST(request: Request): Promise<NextResponse> {
  const rawContentLength = request.headers.get("content-length");
  if (rawContentLength !== null) {
    const declaredBytes = Number(rawContentLength);
    if (Number.isFinite(declaredBytes) && declaredBytes > MAX_CSV_BYTES) {
      return NextResponse.json(
        { ok: false, error: "El contenido CSV excede el limite de 10 MB." },
        { status: 413 },
      );
    }
  }

  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  let csvText = "";

  try {
    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const sourceField = formData.get("source");
      if (isAppleHealthSource(sourceField)) {
        return NextResponse.json(
          {
            ok: false,
            code: "APPLE_HEALTH_FORBIDDEN",
            error: "ADR-001: apple_health esta estrictamente prohibido en PulseTrack.",
          },
          { status: 403 },
        );
      }

      const fileEntry = formData.get("file");
      if (isFileLike(fileEntry)) {
        if (typeof fileEntry.size === "number" && fileEntry.size > MAX_CSV_BYTES) {
          return NextResponse.json(
            { ok: false, error: "El archivo CSV excede el limite de 10 MB." },
            { status: 413 },
          );
        }
        csvText = await fileEntry.text();
      } else if (typeof fileEntry === "string") {
        csvText = fileEntry;
      } else {
        const csvField = formData.get("csv");
        if (typeof csvField === "string") {
          csvText = csvField;
        }
      }
    } else if (contentType.includes("application/json")) {
      const body: unknown = await request.json();
      assertBiometricAuthority(body, "sync_request");
      if (isPlainRecord(body) && typeof body.csv === "string") {
        csvText = body.csv;
      }
    } else if (contentType.includes("text/csv") || contentType.includes("text/plain")) {
      csvText = await request.text();
    } else {
      // Intento JSON por defecto si no se envio cabecera Content-Type explicita
      const rawText = await request.text();
      if (rawText.trim().startsWith("{")) {
        const parsedBody: unknown = JSON.parse(rawText);
        assertBiometricAuthority(parsedBody, "sync_request");
        if (isPlainRecord(parsedBody) && typeof parsedBody.csv === "string") {
          csvText = parsedBody.csv;
        }
      } else {
        csvText = rawText;
      }
    }
  } catch (err: unknown) {
    if (err instanceof BiometricAuthorityError) {
      return NextResponse.json(
        { ok: false, code: err.code, error: err.message },
        { status: err.statusCode },
      );
    }
    return NextResponse.json(
      { ok: false, error: "No se pudo leer el cuerpo de la solicitud Hevy CSV." },
      { status: 400 },
    );
  }

  if (Buffer.byteLength(csvText, "utf8") > MAX_CSV_BYTES) {
    return NextResponse.json(
      { ok: false, error: "El contenido CSV excede el limite de 10 MB." },
      { status: 413 },
    );
  }

  if (csvText.trim().length === 0) {
    return NextResponse.json(
      { ok: false, error: "El campo csv o archivo file es obligatorio y no puede estar vacio." },
      { status: 400 },
    );
  }

  try {
    const { parseHevyCsv } = await import("@/lib/ingest/hevy-csv");
    const parsed: unknown = await Promise.resolve(parseHevyCsv(csvText));
    const { summary, sessions } = extractSummaryAndSessions(parsed);
    const actorKey = resolveActorKey(request);
    let persistedInserted = 0;
    let persistedDeduplicated = 0;

    for (const rawSession of sessions) {
      if (!isPlainRecord(rawSession)) continue;
      const externalId = typeof rawSession.externalId === "string" ? rawSession.externalId : "";
      const title = typeof rawSession.title === "string" ? rawSession.title : "";
      const startedAt = typeof rawSession.startedAt === "string" ? rawSession.startedAt : "";
      if (!externalId || !title || !startedAt) continue;

      if (Array.isArray(rawSession.exercises)) {
        for (const ex of rawSession.exercises) {
          if (!isPlainRecord(ex) || ex.isCustom !== true) continue;
          const exName = typeof ex.name === "string" ? ex.name : "";
          if (!exName) continue;
          insertCustomExercise(actorKey, {
            name: exName,
            muscleGroup: typeof ex.muscleGroup === "string" && ex.muscleGroup ? ex.muscleGroup : "custom",
            equipment: typeof ex.equipment === "string" && ex.equipment ? ex.equipment : "custom",
            defaultStepNote: "",
          });
        }
      }

      const rawSets = Array.isArray(rawSession.sets) ? rawSession.sets : [];
      const mappedSets: StrengthSetInput[] = [];
      for (const [idx, s] of rawSets.entries()) {
        if (!isPlainRecord(s)) continue;
        const exName = typeof s.exerciseName === "string" ? s.exerciseName : "";
        const exId = typeof s.exerciseExternalId === "string" ? s.exerciseExternalId : "";
        const weightKg = typeof s.weightKg === "number" && Number.isFinite(s.weightKg) ? s.weightKg : 0;
        const reps = typeof s.reps === "number" && Number.isFinite(s.reps) ? s.reps : 0;
        if (!exName || !exId || reps <= 0) continue;
        const setType =
          s.setType === "warmup" || s.setType === "dropset" || s.setType === "failure"
            ? s.setType
            : "normal";
        mappedSets.push({
          exerciseExternalId: exId,
          exerciseName: exName,
          setIndex: typeof s.setIndex === "number" ? s.setIndex : idx,
          weightKg,
          reps,
          rpe: typeof s.rpe === "number" && Number.isFinite(s.rpe) ? s.rpe : null,
          setType,
          notes: typeof s.notes === "string" ? s.notes : null,
        });
      }

      const parsedDate = Date.parse(startedAt);
      const isoStartedAt = Number.isNaN(parsedDate)
        ? new Date().toISOString()
        : new Date(parsedDate).toISOString();
      const totalVolumeKg =
        typeof rawSession.totalVolumeKg === "number" && Number.isFinite(rawSession.totalVolumeKg)
          ? rawSession.totalVolumeKg
          : 0;

      const { deduplicated } = insertSession(actorKey, {
        externalId,
        title,
        date: isoStartedAt.slice(0, 10),
        startedAt: isoStartedAt,
        source: "hevy",
        totalVolumeKg,
        sets: mappedSets,
      });
      if (deduplicated) {
        persistedDeduplicated += 1;
      } else {
        persistedInserted += 1;
      }
    }

    return NextResponse.json(
      {
        ok: true,
        summary,
        sessions,
        persistence: {
          inserted: persistedInserted,
          deduplicated: persistedDeduplicated,
        },
      },
      { status: 200 },
    );
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Error al procesar el archivo CSV de Hevy.";
    return NextResponse.json({ ok: false, error: message }, { status: 422 });
  }
}
