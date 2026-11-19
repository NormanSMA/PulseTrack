import { NextResponse } from "next/server";
import {
  BiometricAuthorityError,
  assertBiometricAuthority,
} from "@/lib/ingest/swr-policy";

interface SubjectiveCheckinRecord {
  actorKey: string;
  date: string;
  subjEnergy: number;
  subjSoreness: number;
  subjMood: number;
  updatedAt: string;
}

// Almacen temporal por actor:fecha hasta enlazar Supabase Auth/Postgres en despliegue
const checkinStore = new Map<string, SubjectiveCheckinRecord>();

function resolveActorKey(request: Request): string {
  const headerUser = request.headers.get("x-user-id")?.trim();
  if (headerUser && headerUser.length > 0 && headerUser.length <= 64) {
    return headerUser;
  }
  return "local-owner";
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidScaleInt(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 5
  );
}

function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export async function PATCH(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Cuerpo JSON invalido en /api/biometrics/checkin." },
      { status: 400 },
    );
  }

  if (!isPlainRecord(body)) {
    return NextResponse.json(
      { ok: false, error: "El payload de check-in debe ser un objeto JSON." },
      { status: 400 },
    );
  }

  try {
    assertBiometricAuthority(body, "authenticated_checkin");
  } catch (err: unknown) {
    if (err instanceof BiometricAuthorityError) {
      return NextResponse.json(
        {
          ok: false,
          code: err.code,
          error: err.message,
          forbiddenFields: err.forbiddenFields,
        },
        { status: err.statusCode },
      );
    }
    throw err;
  }

  const subjEnergy = body.subjEnergy;
  const subjSoreness = body.subjSoreness;
  const subjMood = body.subjMood;

  if (!isValidScaleInt(subjEnergy) || !isValidScaleInt(subjSoreness) || !isValidScaleInt(subjMood)) {
    return NextResponse.json(
      {
        ok: false,
        error: "subjEnergy, subjSoreness y subjMood deben ser enteros entre 1 y 5.",
      },
      { status: 400 },
    );
  }

  let date = new Date().toISOString().slice(0, 10);
  if (body.date !== undefined) {
    if (typeof body.date !== "string" || !isValidIsoDate(body.date)) {
      return NextResponse.json(
        { ok: false, error: "date debe tener formato YYYY-MM-DD valido." },
        { status: 400 },
      );
    }
    date = body.date;
  }

  const actorKey = resolveActorKey(request);
  const updatedAt = new Date().toISOString();
  const record: SubjectiveCheckinRecord = {
    actorKey,
    date,
    subjEnergy,
    subjSoreness,
    subjMood,
    updatedAt,
  };
  checkinStore.set(`${actorKey}:${date}`, record);

  return NextResponse.json(
    {
      ok: true,
      checkin: record,
      updatedColumns: ["subj_energy", "subj_soreness", "subj_mood", "updated_at"],
    },
    { status: 200 },
  );
}
