import { NextResponse } from "next/server";
import { findRoutine, resolveActorKey } from "@/lib/sports/gym-store";
import { buildGarminStrengthWorkoutExport } from "@/lib/sports/strength-metrics";

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Cuerpo JSON invalido en /api/gym/export-garmin." },
      { status: 400 },
    );
  }

  if (
    !isPlainRecord(body) ||
    typeof body.routineId !== "string" ||
    body.routineId.trim().length === 0
  ) {
    return NextResponse.json(
      { ok: false, error: "routineId debe ser texto no vacio." },
      { status: 400 },
    );
  }

  const routine = findRoutine(resolveActorKey(request), body.routineId.trim());
  if (!routine) {
    return NextResponse.json(
      { ok: false, error: "Rutina no encontrada para el actor." },
      { status: 404 },
    );
  }

  return NextResponse.json(
    { ok: true, workout: buildGarminStrengthWorkoutExport(routine) },
    { status: 200 },
  );
}
