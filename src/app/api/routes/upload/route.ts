import { NextResponse } from "next/server";
import { parseGpxTrack } from "@/lib/geo/gpx-engine";
import {
  insertRoute,
  resolveActorKey,
  type RouteSource,
  type StoredRoute,
} from "@/lib/geo/routes-store";
import type { RouteColorMode as GeoColorMode } from "@/lib/geo/types";
import { isAppleHealthSource } from "@/lib/ingest/swr-policy";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_TITLE_LENGTH = 120;
const MAX_ACTIVITY_LENGTH = 40;
const NO_STORE = { "Cache-Control": "no-store" } as const;

const POSTGIS_SQL_PREVIEW = [
  "INSERT INTO gpx_routes (",
  "  user_id, external_id, source, title, geom, distance_m,",
  "  elevation_gain_m, gap_pace_sec_km, started_at, activity_type, pa_hr_decoupling_pct",
  ") VALUES (",
  "  $1, $2, $3, $4, ST_GeomFromText($5, 4326), $6,",
  "  $7, $8, $9, $10, $11",
  ")",
  "ON CONFLICT (user_id, external_id) DO NOTHING",
].join("\n");

interface UploadFields {
  gpx: unknown;
  title: unknown;
  activityType: unknown;
  source: unknown;
  colorMode: unknown;
}

class PayloadTooLargeError extends Error {}

function fail(error: string, status: number): NextResponse {
  return NextResponse.json({ ok: false, error }, { status, headers: NO_STORE });
}

function tooLarge(): NextResponse {
  return fail("El archivo GPX excede el limite de 10 MB.", 413);
}

function appleHealthForbidden(): NextResponse {
  return fail("ADR-001: apple_health esta estrictamente prohibido en PulseTrack.", 403);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readBodyLimited(request: Request): Promise<Uint8Array<ArrayBuffer>> {
  if (request.body === null) {
    return new Uint8Array(0);
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_UPLOAD_BYTES) {
      await reader.cancel();
      throw new PayloadTooLargeError("payload excede el limite");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function formValueToText(value: FormDataEntryValue | null): Promise<unknown> {
  if (value === null) {
    return undefined;
  }
  if (typeof value === "string") {
    return value;
  }
  return value.text();
}

async function readFields(request: Request, bytes: Uint8Array<ArrayBuffer>): Promise<UploadFields | null> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.toLowerCase().includes("multipart/form-data")) {
    let form: FormData;
    try {
      form = await new Response(bytes, { headers: { "content-type": contentType } }).formData();
    } catch {
      return null;
    }
    const fileText = await formValueToText(form.get("file"));
    const gpxText = fileText !== undefined ? fileText : await formValueToText(form.get("gpx"));
    return {
      gpx: gpxText,
      title: await formValueToText(form.get("title")),
      activityType: await formValueToText(form.get("activityType")),
      source: await formValueToText(form.get("source")),
      colorMode: await formValueToText(form.get("colorMode")),
    };
  }

  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
  if (!isPlainRecord(body)) {
    return null;
  }
  return {
    gpx: body.gpx,
    title: body.title,
    activityType: body.activityType,
    source: body.source,
    colorMode: body.colorMode,
  };
}

function optionalText(value: unknown, maxLength: number): string | null | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  return trimmed.length > maxLength ? null : trimmed;
}

export async function POST(request: Request): Promise<NextResponse> {
  const querySource = new URL(request.url).searchParams.get("source");
  if (querySource !== null && isAppleHealthSource(querySource)) {
    return appleHealthForbidden();
  }

  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    const declared = Number(declaredLength);
    if (Number.isFinite(declared) && declared > MAX_UPLOAD_BYTES) {
      return tooLarge();
    }
  }

  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = await readBodyLimited(request);
  } catch (err: unknown) {
    if (err instanceof PayloadTooLargeError) {
      return tooLarge();
    }
    return fail("No se pudo leer el cuerpo de la solicitud.", 400);
  }

  const fields = await readFields(request, bytes);
  if (fields === null) {
    return fail(
      "Cuerpo invalido: envie JSON { gpx } o multipart/form-data con file o gpx.",
      400,
    );
  }

  if (isAppleHealthSource(fields.source)) {
    return appleHealthForbidden();
  }

  let source: RouteSource = "gpx_upload";
  if (fields.source !== undefined && fields.source !== null) {
    if (typeof fields.source !== "string") {
      return fail("source debe ser gpx_upload o garmin.", 400);
    }
    const normalized = fields.source.trim().toLowerCase();
    if (normalized === "garmin" || normalized === "gpx_upload") {
      source = normalized;
    } else if (normalized.length > 0) {
      return fail("source debe ser gpx_upload o garmin.", 400);
    }
  }

  const title = optionalText(fields.title, MAX_TITLE_LENGTH);
  if (title === null) {
    return fail(`title debe ser texto de maximo ${MAX_TITLE_LENGTH} caracteres.`, 400);
  }
  const activityType = optionalText(fields.activityType, MAX_ACTIVITY_LENGTH);
  if (activityType === null) {
    return fail(`activityType debe ser texto de maximo ${MAX_ACTIVITY_LENGTH} caracteres.`, 400);
  }

  let colorMode: GeoColorMode | undefined;
  if (fields.colorMode !== undefined && fields.colorMode !== null) {
    if (fields.colorMode !== "grade" && fields.colorMode !== "hr" && fields.colorMode !== "pulse") {
      return fail("colorMode debe ser grade, hr o pulse.", 400);
    }
    colorMode = fields.colorMode === "pulse" ? "hr" : fields.colorMode;
  }

  if (typeof fields.gpx !== "string" || fields.gpx.trim().length === 0) {
    return fail("El GPX esta vacio o no es texto.", 400);
  }
  if (new TextEncoder().encode(fields.gpx).byteLength > MAX_UPLOAD_BYTES) {
    return tooLarge();
  }

  let route: StoredRoute;
  try {
    route = parseGpxTrack(fields.gpx, {
      title,
      activityType,
      source,
      colorMode,
    });
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : "formato desconocido";
    return fail(`GPX invalido: ${detail}`, 400);
  }

  const { route: stored, deduplicated } = insertRoute(resolveActorKey(request), route);

  return NextResponse.json(
    { ok: true, route: stored, deduplicated, postgisSqlPreview: POSTGIS_SQL_PREVIEW },
    { status: deduplicated ? 200 : 201, headers: NO_STORE },
  );
}
