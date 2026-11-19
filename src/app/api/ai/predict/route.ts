import { NextResponse } from "next/server";
import {
  DEFAULT_WHAT_IF_SLIDERS,
  ONNX_MODEL_METADATA,
  simulateWhatIf,
  type WhatIfSliders,
} from "@/lib/ai/onnx-readiness";
import { assertBiometricAuthority, BiometricAuthorityError, isAppleHealthSource } from "@/lib/ingest/swr-policy";

const NO_STORE = { "Cache-Control": "no-store" };
const SLIDER_BOUNDS = {
  sleepHours: [0, 14],
  sleepTempC: [10, 40],
  hrvRmssdMs: [10, 200],
  plannedGymTonnageKg: [0, 30000],
  plannedTrailKm: [0, 100],
  hydrationLiters: [0, 10],
} as const satisfies Record<keyof WhatIfSliders, readonly [number, number]>;

const PREDICTION_SQL = `INSERT INTO ai_predictions
  (user_id, target_date, model_version, readiness_score, acwr, strain_score, anomaly_mse, shap_breakdown)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
  ON CONFLICT (user_id, target_date, model_version) DO UPDATE SET
    readiness_score = EXCLUDED.readiness_score, acwr = EXCLUDED.acwr,
    strain_score = EXCLUDED.strain_score, anomaly_mse = EXCLUDED.anomaly_mse,
    shap_breakdown = EXCLUDED.shap_breakdown;`;

function fail(error: string, status = 400): NextResponse {
  return NextResponse.json({ ok: false, error }, { status, headers: NO_STORE });
}

function appleHealthInQuery(request: Request): boolean {
  return new URL(request.url).searchParams.getAll("source").some(isAppleHealthSource);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSliderKey(key: string): key is keyof WhatIfSliders {
  return Object.hasOwn(SLIDER_BOUNDS, key);
}

function parseSliders(input: unknown): WhatIfSliders | string {
  if (!isRecord(input)) return "sliders debe ser un objeto.";
  const sliders = { ...DEFAULT_WHAT_IF_SLIDERS };
  for (const [key, value] of Object.entries(input)) {
    if (!isSliderKey(key)) return "El objeto incluye un slider desconocido.";
    const [min, max] = SLIDER_BOUNDS[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
      return `${key} debe estar entre ${min} y ${max}.`;
    }
    sliders[key] = value;
  }
  return sliders;
}

function respond(sliders: WhatIfSliders): NextResponse {
  return NextResponse.json({
    ok: true,
    model: ONNX_MODEL_METADATA,
    simulation: simulateWhatIf(sliders),
    sqlPreview: PREDICTION_SQL,
  }, { headers: NO_STORE });
}

export function GET(request: Request): NextResponse {
  if (appleHealthInQuery(request)) return fail("ADR-001: apple_health esta prohibido.", 403);
  return respond(DEFAULT_WHAT_IF_SLIDERS);
}

export async function POST(request: Request): Promise<NextResponse> {
  if (appleHealthInQuery(request)) return fail("ADR-001: apple_health esta prohibido.", 403);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("Cuerpo JSON invalido.");
  }
  try {
    assertBiometricAuthority(body, "service_role");
    if (isRecord(body)) assertBiometricAuthority(body.sliders, "service_role");
  } catch (error) {
    if (error instanceof BiometricAuthorityError) return fail(error.message, error.statusCode);
    throw error;
  }
  if (!isRecord(body)) return fail("El cuerpo debe ser un objeto JSON.");
  if (body.source !== undefined && (typeof body.source !== "string" || !body.source.trim())) {
    return fail("source debe ser texto no vacio.");
  }
  const sliders = parseSliders(body.sliders);
  return typeof sliders === "string" ? fail(sliders) : respond(sliders);
}
