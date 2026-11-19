import { NextResponse } from "next/server";
import { resolveNimModel, routeAiRequest } from "@/lib/ai/cloud-router";
import {
  AI_TELEMETRY_INSERT_SQL,
  appendTelemetryLog,
  getProviderQuotaStatuses,
  listTelemetryLogs,
  resolveActorKey,
} from "@/lib/ai/telemetry-store";
import type { AiCloudProviderId, AiTaskKind } from "@/lib/ai/types";
import { isAppleHealthSource } from "@/lib/ingest/swr-policy";

const NO_STORE = { "Cache-Control": "no-store" } as const;
const MAX_PROMPT_LENGTH = 4000;
const MAX_NIM_MODEL_OVERRIDE_LENGTH = 120;

const VALID_TASK_KINDS: ReadonlySet<AiTaskKind> = new Set([
  "tactical_summary",
  "biometric_reasoning",
  "multimodal_vision",
]);

const VALID_CLOUD_PROVIDERS: ReadonlySet<AiCloudProviderId> = new Set([
  "workers_ai",
  "nim",
  "gemini",
  "openrouter",
]);

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTaskKind(value: unknown): value is AiTaskKind {
  return (
    typeof value === "string" && VALID_TASK_KINDS.has(value as AiTaskKind)
  );
}

function isCloudProviderId(value: unknown): value is AiCloudProviderId {
  return (
    typeof value === "string" &&
    VALID_CLOUD_PROVIDERS.has(value as AiCloudProviderId)
  );
}

export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const source = searchParams.get("source");
  if (source !== null && isAppleHealthSource(source)) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "ADR-001: apple_health esta estrictamente prohibido en PulseTrack.",
      },
      { status: 403, headers: NO_STORE },
    );
  }

  const actor = resolveActorKey(request);

  return NextResponse.json(
    {
      ok: true,
      logs: listTelemetryLogs(actor),
      providers: getProviderQuotaStatuses(actor),
      activeModels: {
        workers_ai: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
        nim: resolveNimModel(),
        gemini: "gemini-2.5-flash-lite",
        openrouter: "openrouter/free",
        onnx_local: "pulsetrack-readiness-mlp-v1.onnx",
      },
    },
    { headers: NO_STORE },
  );
}

export async function POST(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const querySource = searchParams.get("source");
  if (querySource !== null && isAppleHealthSource(querySource)) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "ADR-001: apple_health esta estrictamente prohibido en PulseTrack.",
      },
      { status: 403, headers: NO_STORE },
    );
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Cuerpo JSON invalido." },
      { status: 400, headers: NO_STORE },
    );
  }

  if (!isPlainRecord(rawBody)) {
    return NextResponse.json(
      { ok: false, error: "El cuerpo debe ser un objeto JSON." },
      { status: 400, headers: NO_STORE },
    );
  }

  if ("source" in rawBody && isAppleHealthSource(rawBody.source)) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "ADR-001: apple_health esta estrictamente prohibido en PulseTrack.",
      },
      { status: 403, headers: NO_STORE },
    );
  }

  const { taskKind, prompt, simulateFailureProviders, nimModelOverride } =
    rawBody;

  if (!isTaskKind(taskKind)) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "taskKind invalido. Valores permitidos: tactical_summary, biometric_reasoning, multimodal_vision.",
      },
      { status: 400, headers: NO_STORE },
    );
  }

  if (
    typeof prompt !== "string" ||
    prompt.trim().length === 0 ||
    prompt.length > MAX_PROMPT_LENGTH
  ) {
    return NextResponse.json(
      {
        ok: false,
        error: "prompt debe ser un texto no vacio de hasta 4000 caracteres.",
      },
      { status: 400, headers: NO_STORE },
    );
  }

  let validatedSimulateFailures: AiCloudProviderId[] | undefined;
  if (simulateFailureProviders !== undefined) {
    if (
      !Array.isArray(simulateFailureProviders) ||
      !simulateFailureProviders.every(isCloudProviderId)
    ) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "simulateFailureProviders debe ser un arreglo de proveedores cloud validos.",
        },
        { status: 400, headers: NO_STORE },
      );
    }
    validatedSimulateFailures = simulateFailureProviders;
  }

  let validatedNimOverride: string | undefined;
  if (nimModelOverride !== undefined) {
    if (
      typeof nimModelOverride !== "string" ||
      nimModelOverride.trim().length === 0 ||
      nimModelOverride.length > MAX_NIM_MODEL_OVERRIDE_LENGTH
    ) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "nimModelOverride debe ser un texto no vacio de hasta 120 caracteres.",
        },
        { status: 400, headers: NO_STORE },
      );
    }
    validatedNimOverride = nimModelOverride.trim();
  }

  const actor = resolveActorKey(request);

  try {
    const result = await routeAiRequest({
      taskKind,
      prompt: prompt.trim(),
      simulateFailureProviders: validatedSimulateFailures,
      nimModelOverride: validatedNimOverride,
    });

    appendTelemetryLog(actor, result.telemetry);

    return NextResponse.json(
      {
        ok: true,
        result,
        logs: listTelemetryLogs(actor),
        providers: getProviderQuotaStatuses(actor),
        sqlPreview: AI_TELEMETRY_INSERT_SQL,
      },
      { status: 200, headers: NO_STORE },
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Fallo en la cadena de enrutamiento IA.";
    return NextResponse.json(
      { ok: false, error: message },
      { status: 502, headers: NO_STORE },
    );
  }
}
