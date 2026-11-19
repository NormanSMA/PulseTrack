import { NextResponse } from "next/server";
import {
  BiometricAuthorityError,
  assertBiometricAuthority,
} from "@/lib/ingest/swr-policy";
import { insertCustomExercise, listCatalog, resolveActorKey } from "@/lib/sports/gym-store";

const MAX_TEXT_LENGTH = 120;
const MAX_NOTE_LENGTH = 280;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRequiredText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_TEXT_LENGTH) {
    return null;
  }
  return trimmed;
}

export async function GET(request: Request): Promise<NextResponse> {
  return NextResponse.json({ ok: true, items: listCatalog(resolveActorKey(request)) });
}

export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Cuerpo JSON invalido en /api/gym/catalog." },
      { status: 400 },
    );
  }

  if (!isPlainRecord(body)) {
    return NextResponse.json(
      { ok: false, error: "El payload del catalogo debe ser un objeto JSON." },
      { status: 400 },
    );
  }

  try {
    assertBiometricAuthority(body, "service_role");
  } catch (err: unknown) {
    if (err instanceof BiometricAuthorityError) {
      return NextResponse.json({ ok: false, error: err.message, code: err.code }, { status: 403 });
    }
    throw err;
  }

  const name = readRequiredText(body.name);
  const muscleGroup = readRequiredText(body.muscleGroup);
  const equipment = readRequiredText(body.equipment);
  if (name === null || muscleGroup === null || equipment === null) {
    return NextResponse.json(
      {
        ok: false,
        error: "name, muscleGroup y equipment deben ser textos no vacios (maximo 120 caracteres).",
      },
      { status: 400 },
    );
  }

  let defaultStepNote = "";
  if (body.defaultStepNote !== undefined) {
    if (typeof body.defaultStepNote !== "string" || body.defaultStepNote.length > MAX_NOTE_LENGTH) {
      return NextResponse.json(
        { ok: false, error: "defaultStepNote debe ser texto de maximo 280 caracteres." },
        { status: 400 },
      );
    }
    defaultStepNote = body.defaultStepNote.trim();
  }

  const { item, deduplicated } = insertCustomExercise(resolveActorKey(request), {
    name,
    muscleGroup,
    equipment,
    defaultStepNote,
  });

  return NextResponse.json({ ok: true, item, deduplicated }, { status: deduplicated ? 200 : 201 });
}
