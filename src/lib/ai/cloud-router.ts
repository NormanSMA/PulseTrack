import { randomUUID } from "node:crypto";
import type {
  AiAttemptRecord,
  AiCloudProviderId,
  AiProviderTransport,
  AiProviderTransportRequest,
  AiProviderTransportResponse,
  AiRouteRequest,
  AiRouteResult,
  AiTaskKind,
  AiTelemetryLogEntry,
  ScriptableWidgetMetrics,
  ScriptableWidgetPayload,
} from "./types";

export const VALIDATED_NIM_DEFAULT_MODEL = "nvidia/nemotron-3-ultra-550b-a55b";
export const EXCLUDED_NIM_MODELS: readonly string[] = [
  "nvidia/nemotron-3-super",
  "nvidia/nemotron-3-super-120b-a12b",
  "google/gemma-4-31b-it",
  "gemma-4-31b",
];

const WORKERS_AI_FAST_DEFAULT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

export function isExcludedModel(modelName: string): boolean {
  const normalized = modelName.trim().toLowerCase();
  return (
    EXCLUDED_NIM_MODELS.includes(normalized) ||
    normalized.startsWith("nvidia/nemotron-3-super") ||
    normalized.includes("gemma-4-31b")
  );
}

export function resolveNimModel(
  override?: string,
  env: Record<string, string | undefined> = process.env,
): string {
  const model = override?.trim() || env.NIM_PRIMARY_MODEL?.trim() || VALIDATED_NIM_DEFAULT_MODEL;
  return isExcludedModel(model) ? VALIDATED_NIM_DEFAULT_MODEL : model;
}

export function getProviderChain(
  taskKind: AiTaskKind,
  options?: { nimModelOverride?: string; env?: Record<string, string | undefined> },
): Array<{ provider: AiCloudProviderId; modelName: string }> {
  const env = options?.env ?? process.env;
  const workersFast = {
    provider: "workers_ai",
    modelName: env.WORKERS_AI_FAST_MODEL?.trim() || WORKERS_AI_FAST_DEFAULT_MODEL,
  } as const;
  const openrouter = {
    provider: "openrouter",
    modelName: env.OPENROUTER_FALLBACK_MODEL?.trim() || "openrouter/free",
  } as const;

  if (taskKind === "multimodal_vision") {
    return [
      { provider: "gemini", modelName: env.GEMINI_VISION_MODEL?.trim() || "gemini-2.5-flash-lite" },
      openrouter,
      workersFast,
    ];
  }

  const nim = { provider: "nim", modelName: resolveNimModel(options?.nimModelOverride, env) } as const;
  const gemini = {
    provider: "gemini",
    modelName: env.GEMINI_FAST_MODEL?.trim() || "gemini-2.5-flash-lite",
  } as const;

  if (taskKind === "tactical_summary") return [workersFast, nim, gemini, openrouter];

  return [
    nim,
    { provider: "workers_ai", modelName: env.WORKERS_AI_CODE_MODEL?.trim() || "@cf/qwen/qwen2.5-coder-32b-instruct" },
    gemini,
    openrouter,
  ];
}

const TIMEOUT_RESPONSE: AiProviderTransportResponse = {
  ok: false,
  statusCode: 504,
  outputText: "",
  tokensIn: 0,
  tokensOut: 0,
  errorReason: "timeout",
};

const FIXTURE_SUMMARIES: Record<AiTaskKind, string> = {
  tactical_summary: "Readiness estable. ACWR dentro del rango habitual. Mantén la carga planificada.",
  biometric_reasoning: "ACWR estable. El sueño favorece la recuperación. Vigila el balance energético.",
  multimodal_vision: "Contrasta el GAP con el ritmo observado. Revisa el desnivel antes de interpretar la carga.",
};

export function createDeterministicFixtureTransport(): AiProviderTransport {
  return async (request) => {
    if (request.signal.aborted) return { ...TIMEOUT_RESPONSE };

    const outputText = `${FIXTURE_SUMMARIES[request.taskKind]} (${request.provider}/${request.modelName})`;
    return {
      ok: true,
      statusCode: 200,
      outputText,
      tokensIn: Math.max(8, Math.ceil(request.prompt.trim().length / 4)),
      tokensOut: Math.ceil(outputText.length / 4),
    };
  };
}

async function runProviderAttempt(
  transport: AiProviderTransport,
  request: Omit<AiProviderTransportRequest, "signal">,
): Promise<AiProviderTransportResponse> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<AiProviderTransportResponse>((resolve) => {
    timer = setTimeout(() => {
      resolve(TIMEOUT_RESPONSE);
      controller.abort();
    }, request.timeoutMs);
  });

  try {
    return await Promise.race([transport({ ...request, signal: controller.signal }), timeout]);
  } catch {
    return {
      ok: false,
      statusCode: 502,
      outputText: "",
      tokensIn: 0,
      tokensOut: 0,
      errorReason: "transport_error",
    };
  } finally {
    clearTimeout(timer);
  }
}

function nonNegativeInteger(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

export async function routeAiRequest(
  request: AiRouteRequest,
  options?: {
    transport?: AiProviderTransport;
    env?: Record<string, string | undefined>;
    now?: () => number;
    uuid?: () => string;
    nowIso?: () => string;
  },
): Promise<AiRouteResult> {
  const prompt = typeof request.prompt === "string" ? request.prompt.trim() : "";
  if (!prompt || prompt.length > 4000) throw new RangeError("El prompt debe contener entre 1 y 4000 caracteres.");

  const timeoutMs = request.timeoutMs ?? 4500;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 50 || timeoutMs > 30000) {
    throw new RangeError("El timeout debe estar entre 50 y 30000 ms.");
  }

  const { taskKind, nimModelOverride, simulateFailureProviders } = request;
  const transport = options?.transport ?? createDeterministicFixtureTransport();
  const now = options?.now ?? Date.now;
  const uuid = options?.uuid ?? randomUUID;
  const attempts: AiAttemptRecord[] = [];

  for (const step of getProviderChain(taskKind, { nimModelOverride, env: options?.env })) {
    if (simulateFailureProviders?.includes(step.provider)) {
      attempts.push({ ...step, latencyMs: 1, statusCode: 503, ok: false, errorReason: "simulated_provider_outage" });
      continue;
    }

    const startedAt = now();
    const response = await runProviderAttempt(transport, { ...step, taskKind, prompt, timeoutMs });
    const { statusCode, outputText } = response;
    const ok = response.ok && Number.isInteger(statusCode) && statusCode >= 200 && statusCode < 300;
    const latencyMs = nonNegativeInteger(now() - startedAt);
    const fallbackUsed = attempts.length > 0;
    const errorReason = ok ? null : response.errorReason ?? `http_${statusCode}`;
    attempts.push({ ...step, latencyMs, statusCode, ok, errorReason });
    if (!ok) continue;

    const result = {
      ...step,
      requestId: uuid(),
      taskKind,
      latencyMs,
      tokensIn: nonNegativeInteger(response.tokensIn),
      tokensOut: nonNegativeInteger(response.tokensOut),
      fallbackUsed,
      statusCode,
    };
    const telemetry: AiTelemetryLogEntry = {
      ...result,
      id: uuid(),
      status: fallbackUsed ? "fallback" : "ok",
      createdAt: options?.nowIso?.() ?? new Date().toISOString(),
    };
    return { ...result, outputText, attempts, telemetry };
  }

  throw new Error("Todos los proveedores IA fallaron en la cadena de conmutacion.");
}

const SCRIPTABLE_TTL_SECONDS = 900;
const SCRIPTABLE_PALETTE: ScriptableWidgetPayload["palette"] = {
  background: "#000000",
  surface: "#0A0A0A",
  border: "#1F1F1F",
  textPrimary: "#FFFFFF",
  textSecondary: "#A3A3A3",
  accentRecovery: "#10B981",
  accentStrain: "#3B82F6",
  accentSleep: "#8B5CF6",
  accentAlert: "#F59E0B",
};

export function generateScriptableIosCode(endpointUrl = "https://pulsetrack.nsma.dev/api/scriptable"): string {
  return `const endpointUrl = ${JSON.stringify(endpointUrl)};
const ttlMs = ${SCRIPTABLE_TTL_SECONDS} * 1000;
const palette = ${JSON.stringify(SCRIPTABLE_PALETTE)};
const fm = FileManager.local();
const cachePath = fm.joinPath(fm.documentsDirectory(), "pulsetrack-widget.json");
const widget = new ListWidget();
widget.backgroundColor = new Color(palette.background);
widget.spacing = 3;

function addLine(value, color, lineLimit = 1) {
  const line = widget.addText(value);
  line.font = Font.regularMonospacedSystemFont(11);
  line.textColor = new Color(color);
  line.lineLimit = lineLimit;
  line.minimumScaleFactor = 0.75;
}

let cached;
try {
  if (fm.fileExists(cachePath)) {
    const entry = JSON.parse(fm.readString(cachePath));
    if (entry?.endpointUrl === endpointUrl && Number.isFinite(entry.savedAt) && entry.payload?.metrics) {
      cached = entry;
    }
  }
} catch {
  cached = undefined;
}

let payload = cached?.payload;
let refreshAt = (cached?.savedAt ?? 0) + ttlMs;
if (!payload || Date.now() >= refreshAt) {
  try {
    const request = new Request(endpointUrl);
    request.timeoutInterval = 5;
    const raw = await request.loadJSON();
    const response = raw && typeof raw === "object" && "payload" in raw && raw.payload ? raw.payload : raw;
    const statusCode = request.response?.statusCode;
    if (!(statusCode >= 200 && statusCode < 300) || !response?.metrics || typeof response.shapSummary !== "string") {
      throw new Error("Respuesta Scriptable inválida.");
    }
    const savedAt = Date.now();
    payload = response;
    refreshAt = savedAt + ttlMs;
    fm.writeString(cachePath, JSON.stringify({ endpointUrl, savedAt, payload }));
  } catch {
    refreshAt = Date.now() + ttlMs;
  }
}

widget.refreshAfterDate = new Date(refreshAt);
if (payload) {
  const metrics = payload.metrics;
  addLine("Readiness " + metrics.readinessScore + "%", palette.accentRecovery);
  addLine("Strain " + metrics.strainScore, palette.accentStrain);
  addLine("ACWR " + metrics.acwr, palette.textPrimary);
  addLine("Tonelaje semanal " + metrics.weeklyTonnageKg + " kg", palette.textPrimary);
  addLine("Clima " + metrics.weatherTempC + " °C · " + metrics.weatherCondition, palette.textSecondary);
  addLine("SHAP " + payload.shapSummary, palette.textSecondary, 2);
} else {
  addLine("Datos no disponibles", palette.accentAlert);
}

Script.setWidget(widget);
Script.complete();`;
}

export function buildScriptableWidgetPayload(
  overrides?: Partial<ScriptableWidgetMetrics> & { endpointUrl?: string; generatedAt?: string; shapSummary?: string },
): ScriptableWidgetPayload {
  const {
    endpointUrl,
    generatedAt = new Date().toISOString(),
    shapSummary = "El sueño y la carga reciente explican el Readiness.",
  } = overrides ?? {};

  return {
    version: "1.0",
    theme: "amoled-pure-black",
    ttlSeconds: SCRIPTABLE_TTL_SECONDS,
    generatedAt,
    palette: { ...SCRIPTABLE_PALETTE },
    metrics: {
      readinessScore: overrides?.readinessScore ?? 86.4,
      readinessLabel: overrides?.readinessLabel ?? "Optimo",
      strainScore: overrides?.strainScore ?? 12.3,
      acwr: overrides?.acwr ?? 1.08,
      sleepScore: overrides?.sleepScore ?? 82,
      weeklyTonnageKg: overrides?.weeklyTonnageKg ?? 12450,
      latestWeightKg: overrides?.latestWeightKg ?? 76.4,
      weatherTempC: overrides?.weatherTempC ?? 27,
      weatherCondition: overrides?.weatherCondition ?? "Parcialmente nublado",
      activeProvider: overrides?.activeProvider ?? "workers_ai",
      activeModel: overrides?.activeModel ?? WORKERS_AI_FAST_DEFAULT_MODEL,
      routerLatencyMs: overrides?.routerLatencyMs ?? 120,
      fallbackActive: overrides?.fallbackActive ?? false,
    },
    shapSummary,
    scriptableCode: generateScriptableIosCode(endpointUrl),
  };
}
