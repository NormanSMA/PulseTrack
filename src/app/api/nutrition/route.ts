import { NextResponse } from "next/server";
import { resolveActorKey } from "@/lib/ai/telemetry-store";
import { assertBiometricAuthority, BiometricAuthorityError, isAppleHealthSource } from "@/lib/ingest/swr-policy";
import {
  analyzeMealVision,
  appendNutritionLog,
  computeNetEnergyBalance,
  getPassiveNocturnalBiometrics,
  listNutritionLogs,
  PORTION_TEMPLATES,
  searchPortionTemplates,
  type MealSlot,
} from "@/lib/nutrition/nutrition-engine";

const NO_STORE = { "Cache-Control": "no-store" };
const MAX_TEXT_LENGTH = 2000;
const SELECT_SQL = `SELECT *, 1 - (embedding <=> $1::vector(768)) AS similarity
  FROM nutrition_logs WHERE user_id = $2 AND embedding IS NOT NULL
  ORDER BY embedding <=> $1::vector(768) LIMIT $3;`;
const INSERT_SQL = `INSERT INTO nutrition_logs
  (user_id, logged_at, meal_slot, food_name, portion_templates, kcal, protein_g, carbs_g, fat_g, embedding, source)
  VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10::vector(768), 'pulsetrack') RETURNING *;`;

function fail(error: string, status = 400): NextResponse {
  return NextResponse.json({ ok: false, error }, { status, headers: NO_STORE });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMealSlot(value: unknown): value is MealSlot {
  return value === "desayuno" || value === "almuerzo" || value === "cena" || value === "snack";
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_TEXT_LENGTH && value.trim().length > 0;
}

export function GET(request: Request): NextResponse {
  const { searchParams } = new URL(request.url);
  if (searchParams.getAll("source").some(isAppleHealthSource)) {
    return fail("ADR-001: apple_health esta prohibido.", 403);
  }
  const query = searchParams.get("q")?.trim();
  if (query && query.length > MAX_TEXT_LENGTH) return fail("La consulta excede 2000 caracteres.");
  const logs = listNutritionLogs(resolveActorKey(request));
  return NextResponse.json({
    ok: true,
    logs,
    templates: PORTION_TEMPLATES,
    matches: query ? searchPortionTemplates(query) : [],
    balance: computeNetEnergyBalance(logs),
    nocturnal: getPassiveNocturnalBiometrics(),
    sqlPreview: SELECT_SQL,
  }, { headers: NO_STORE });
}

export async function POST(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  if (searchParams.getAll("source").some(isAppleHealthSource)) {
    return fail("ADR-001: apple_health esta prohibido.", 403);
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("Cuerpo JSON invalido.");
  }
  try {
    assertBiometricAuthority(body, "service_role");
  } catch (error) {
    if (error instanceof BiometricAuthorityError) return fail(error.message, error.statusCode);
    throw error;
  }
  if (!isRecord(body)) return fail("El cuerpo debe ser un objeto JSON.");
  const { templateId, description, mealSlot, portionMultiplier, source } = body;
  if (source !== undefined && (typeof source !== "string" || source.trim().toLowerCase() !== "pulsetrack")) {
    return fail("source debe ser pulsetrack.");
  }
  if (mealSlot !== undefined && !isMealSlot(mealSlot)) return fail("mealSlot invalido.");
  if (portionMultiplier !== undefined && (
    typeof portionMultiplier !== "number" || !Number.isFinite(portionMultiplier) || portionMultiplier < 0.25 || portionMultiplier > 4
  )) {
    return fail("portionMultiplier debe estar entre 0.25 y 4.");
  }
  if (description !== undefined && !isText(description)) return fail("description debe ser texto no vacio.");
  const template = PORTION_TEMPLATES.find(({ id }) => id === templateId);
  if (templateId !== undefined && !template) return fail("templateId invalido.");
  const meal = template?.name ?? description;
  if (meal === undefined) return fail("Indica templateId o description.");

  const actor = resolveActorKey(request);
  const log = analyzeMealVision({ description: meal, mealSlot, portionMultiplier });
  appendNutritionLog(actor, log);
  const logs = listNutritionLogs(actor);
  return NextResponse.json({
    ok: true,
    log,
    logs,
    balance: computeNetEnergyBalance(logs),
    sqlPreview: INSERT_SQL,
  }, { status: 201, headers: NO_STORE });
}
