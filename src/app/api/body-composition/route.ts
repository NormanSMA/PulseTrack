import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import {
  BiometricAuthorityError,
  assertBiometricAuthority,
  isAppleHealthSource,
} from "@/lib/ingest/swr-policy";
import {
  insertBodyComposition,
  listBodyComposition,
  resolveActorKey,
} from "@/lib/sports/gym-store";
import type { BodyCompositionPoint } from "@/lib/sports/types";

const ALLOWED_SOURCES: ReadonlySet<string> = new Set(["renpho", "garmin"]);
const MAX_BODY_BYTES = 64 * 1024;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function safeEqual(received: string, expected: string): boolean {
  return timingSafeEqual(digest(received), digest(expected));
}

function readOptionalMetric(
  value: unknown,
  field: string,
  max: number,
  min = 0,
): { value: number | null } | { error: string } {
  if (value === undefined || value === null) {
    return { value: null };
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    return { error: `${field} debe ser un numero finito entre ${min} y ${max}.` };
  }
  return { value };
}

function forbidden(error: string, code?: string): NextResponse {
  return NextResponse.json({ ok: false, error, code }, { status: 403 });
}

export async function GET(request: Request): Promise<NextResponse> {
  const series = listBodyComposition(resolveActorKey(request));
  const latest = series.length > 0 ? series[series.length - 1] : null;
  return NextResponse.json({ ok: true, authority: "renpho->garmin", latest, series });
}

export async function POST(request: Request): Promise<NextResponse> {
  const rawContentLength = request.headers.get("content-length");
  if (rawContentLength !== null) {
    const declaredBytes = Number(rawContentLength);
    if (Number.isFinite(declaredBytes) && declaredBytes > MAX_BODY_BYTES) {
      return NextResponse.json(
        { ok: false, error: "El payload supera el limite de 64 KB." },
        { status: 413 },
      );
    }
  }

  let rawBodyText = "";
  try {
    rawBodyText = await request.text();
  } catch {
    return NextResponse.json(
      { ok: false, error: "No se pudo leer el cuerpo en /api/body-composition." },
      { status: 400 },
    );
  }
  if (Buffer.byteLength(rawBodyText, "utf8") > MAX_BODY_BYTES) {
    return NextResponse.json(
      { ok: false, error: "El payload supera el limite de 64 KB." },
      { status: 413 },
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBodyText);
  } catch {
    return NextResponse.json(
      { ok: false, error: "Cuerpo JSON invalido en /api/body-composition." },
      { status: 400 },
    );
  }

  if (!isPlainRecord(body)) {
    return NextResponse.json(
      { ok: false, error: "El payload de composicion corporal debe ser un objeto JSON." },
      { status: 400 },
    );
  }

  try {
    assertBiometricAuthority(body, "service_role");
  } catch (err: unknown) {
    if (err instanceof BiometricAuthorityError) {
      return forbidden(err.message, err.code);
    }
    throw err;
  }

  const secret = process.env.PULSETRACK_SERVICE_SECRET;
  if (typeof secret !== "string" || secret.length === 0) {
    return forbidden("ADR-001: escritura de body_composition no disponible sin secreto de servicio.");
  }
  const token = request.headers.get("x-service-token");
  if (token === null || token.length === 0) {
    return NextResponse.json(
      { ok: false, error: "ADR-001: body_composition exige la cabecera X-Service-Token." },
      { status: 401 },
    );
  }
  if (!safeEqual(token, secret)) {
    return forbidden("ADR-001: X-Service-Token invalido para escribir body_composition.");
  }

  let source: "renpho" | "garmin" = "renpho";
  if (body.source !== undefined) {
    if (typeof body.source !== "string") {
      return NextResponse.json({ ok: false, error: "source debe ser texto." }, { status: 400 });
    }
    if (isAppleHealthSource(body.source)) {
      return forbidden("ADR-001: apple_health esta estrictamente prohibido en PulseTrack.");
    }
    const normalized = body.source.trim().toLowerCase();
    if (!ALLOWED_SOURCES.has(normalized)) {
      return NextResponse.json(
        { ok: false, error: "source debe ser renpho o garmin." },
        { status: 400 },
      );
    }
    source = normalized as "renpho" | "garmin";
  }

  const { weightKg } = body;
  if (typeof weightKg !== "number" || !Number.isFinite(weightKg) || weightKg <= 0 || weightKg > 500) {
    return NextResponse.json(
      { ok: false, error: "weightKg debe ser un numero finito mayor que 0 y hasta 500 kg." },
      { status: 400 },
    );
  }

  let measuredAt = new Date().toISOString();
  if (body.measuredAt !== undefined) {
    if (typeof body.measuredAt !== "string" || Number.isNaN(Date.parse(body.measuredAt))) {
      return NextResponse.json(
        { ok: false, error: "measuredAt debe ser una fecha ISO valida." },
        { status: 400 },
      );
    }
    measuredAt = new Date(body.measuredAt).toISOString();
  }

  const bodyFat = readOptionalMetric(body.bodyFatPct, "bodyFatPct", 100);
  const muscle = readOptionalMetric(body.muscleMassKg, "muscleMassKg", 300);
  const water = readOptionalMetric(body.waterPct, "waterPct", 100);
  const visceral = readOptionalMetric(body.visceralFat, "visceralFat", 60);
  const bmr = readOptionalMetric(body.bmrKcal, "bmrKcal", 10000, 1);
  if ("error" in bodyFat) {
    return NextResponse.json({ ok: false, error: bodyFat.error }, { status: 400 });
  }
  if ("error" in muscle) {
    return NextResponse.json({ ok: false, error: muscle.error }, { status: 400 });
  }
  if ("error" in water) {
    return NextResponse.json({ ok: false, error: water.error }, { status: 400 });
  }
  if ("error" in visceral) {
    return NextResponse.json({ ok: false, error: visceral.error }, { status: 400 });
  }
  if ("error" in bmr) {
    return NextResponse.json({ ok: false, error: bmr.error }, { status: 400 });
  }

  const point: BodyCompositionPoint = {
    measuredAt,
    date: measuredAt.slice(0, 10),
    source,
    weightKg,
    bodyFatPct: bodyFat.value,
    muscleMassKg: muscle.value,
    waterPct: water.value,
    visceralFat: visceral.value,
    bmrKcal: bmr.value,
    syncedToGarmin: true,
  };

  const { point: stored, deduplicated } = insertBodyComposition(resolveActorKey(request), point);
  return NextResponse.json(
    { ok: true, item: stored, deduplicated },
    { status: deduplicated ? 200 : 201 },
  );
}
