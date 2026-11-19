import { NextResponse } from "next/server";
import {
  BiometricAuthorityError,
  assertBiometricAuthority,
  isAppleHealthSource,
} from "@/lib/ingest/swr-policy";
import {
  buildExerciseExternalId,
  buildGymSnapshot,
  buildSessionExternalId,
  computeSessionVolume,
  insertSession,
  resolveActorKey,
  slugify,
  type GymSet,
  type GymSession,
} from "@/lib/sports/gym-store";

const MAX_SETS = 200;
const MAX_TEXT_LENGTH = 120;
const SOURCE_PATTERN = /^[a-z0-9_-]{1,32}$/;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function badRequest(error: string): NextResponse {
  return NextResponse.json({ ok: false, error }, { status: 400 });
}

function parseSet(value: unknown, index: number): GymSet | string {
  if (!isPlainRecord(value)) {
    return `sets[${index}] debe ser un objeto.`;
  }
  const exerciseName =
    typeof value.exerciseName === "string" ? value.exerciseName.trim() : "";
  if (exerciseName.length === 0 || exerciseName.length > MAX_TEXT_LENGTH) {
    return `sets[${index}].exerciseName debe ser texto no vacio.`;
  }
  const { weightKg, reps, rpe, isWarmup } = value;
  if (typeof weightKg !== "number" || !Number.isFinite(weightKg) || weightKg < 0) {
    return `sets[${index}].weightKg debe ser un numero finito mayor o igual a 0.`;
  }
  if (typeof reps !== "number" || !Number.isFinite(reps) || reps <= 0) {
    return `sets[${index}].reps debe ser un numero finito mayor que 0.`;
  }
  let parsedRpe: number | null = null;
  if (rpe !== undefined && rpe !== null) {
    if (typeof rpe !== "number" || !Number.isFinite(rpe) || rpe < 1 || rpe > 10) {
      return `sets[${index}].rpe debe estar entre 1 y 10.`;
    }
    parsedRpe = rpe;
  }
  if (isWarmup !== undefined && typeof isWarmup !== "boolean") {
    return `sets[${index}].isWarmup debe ser booleano.`;
  }
  let exerciseExternalId = buildExerciseExternalId(exerciseName, "other");
  if (value.exerciseExternalId !== undefined) {
    if (
      typeof value.exerciseExternalId !== "string" ||
      value.exerciseExternalId.trim().length === 0 ||
      value.exerciseExternalId.length > MAX_TEXT_LENGTH
    ) {
      return `sets[${index}].exerciseExternalId debe ser texto no vacio.`;
    }
    exerciseExternalId = value.exerciseExternalId.trim();
  }
  return {
    exerciseExternalId,
    exerciseName,
    weightKg,
    reps,
    rpe: parsedRpe,
    isWarmup: isWarmup === true,
  };
}

export async function GET(request: Request): Promise<NextResponse> {
  const snapshot = buildGymSnapshot(resolveActorKey(request));
  return NextResponse.json({ ok: true, ...snapshot });
}

export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest("Cuerpo JSON invalido en /api/gym/sessions.");
  }

  if (!isPlainRecord(body)) {
    return badRequest("El payload de sesion debe ser un objeto JSON.");
  }

  try {
    assertBiometricAuthority(body, "service_role");
  } catch (err: unknown) {
    if (err instanceof BiometricAuthorityError) {
      return NextResponse.json({ ok: false, error: err.message, code: err.code }, { status: 403 });
    }
    throw err;
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (title.length === 0 || title.length > MAX_TEXT_LENGTH || slugify(title).length === 0) {
    return badRequest("title debe ser texto no vacio.");
  }

  let source = "manual";
  if (body.source !== undefined) {
    if (typeof body.source !== "string") {
      return badRequest("source debe ser texto.");
    }
    if (isAppleHealthSource(body.source)) {
      return NextResponse.json(
        { ok: false, error: "ADR-001: apple_health esta estrictamente prohibido en PulseTrack." },
        { status: 403 },
      );
    }
    source = body.source.trim().toLowerCase();
    if (!SOURCE_PATTERN.test(source)) {
      return badRequest("source debe usar solo letras, numeros, guion y guion bajo.");
    }
  }

  let startedAt: string;
  let date: string;
  if (body.startedAt !== undefined) {
    if (typeof body.startedAt !== "string" || Number.isNaN(Date.parse(body.startedAt))) {
      return badRequest("startedAt debe ser una fecha ISO valida.");
    }
    startedAt = new Date(body.startedAt).toISOString();
    date = startedAt.slice(0, 10);
  } else if (body.date !== undefined) {
    if (typeof body.date !== "string" || !isValidIsoDate(body.date)) {
      return badRequest("date debe tener formato YYYY-MM-DD valido.");
    }
    date = body.date;
    startedAt = `${date}T12:00:00.000Z`;
  } else {
    startedAt = new Date().toISOString();
    date = startedAt.slice(0, 10);
  }
  if (body.startedAt !== undefined && body.date !== undefined) {
    if (typeof body.date !== "string" || !isValidIsoDate(body.date) || body.date !== date) {
      return badRequest("date debe coincidir con startedAt en formato YYYY-MM-DD.");
    }
  }

  if (!Array.isArray(body.sets) || body.sets.length === 0 || body.sets.length > MAX_SETS) {
    return badRequest("sets debe ser una lista con entre 1 y 200 series.");
  }
  const sets: GymSet[] = [];
  for (const [index, rawSet] of body.sets.entries()) {
    const parsed = parseSet(rawSet, index);
    if (typeof parsed === "string") {
      return badRequest(parsed);
    }
    sets.push(parsed);
  }

  const session: GymSession = {
    externalId: buildSessionExternalId(source, startedAt, title),
    title,
    date,
    startedAt,
    source,
    totalVolumeKg: computeSessionVolume(sets),
    sets,
  };

  const actorKey = resolveActorKey(request);
  const { session: stored, deduplicated } = insertSession(actorKey, session);
  const snapshot = buildGymSnapshot(actorKey);

  return NextResponse.json(
    {
      ok: true,
      session: stored,
      deduplicated,
      acwr: snapshot.acwr,
      weeklyTonnage: snapshot.weeklyTonnage,
      recommendations: snapshot.recommendations,
    },
    { status: deduplicated ? 200 : 201 },
  );
}
