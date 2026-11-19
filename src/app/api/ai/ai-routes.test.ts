import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AiAttemptRecord,
  AiCloudProviderId,
  AiRouteRequest,
  AiRouteResult,
  AiTaskKind,
  AiTelemetryLogEntry,
  ProviderQuotaStatus,
  ScriptableWidgetMetrics,
  ScriptableWidgetPayload,
} from "@/lib/ai/types";

vi.mock("@/lib/ai/cloud-router", () => {
  const DEFAULT_NIM_MODEL = "nvidia/nemotron-3-ultra-550b-a55b";

  const resolveNimModel = (override?: string): string => {
    const candidate = override?.trim();
    if (!candidate) {
      return DEFAULT_NIM_MODEL;
    }
    if (
      candidate.toLowerCase().startsWith("nvidia/nemotron-3-super") ||
      candidate.toLowerCase().includes("gemma-4-31b")
    ) {
      return DEFAULT_NIM_MODEL;
    }
    return candidate;
  };

  const getChain = (
    taskKind: AiTaskKind,
    nimModelOverride?: string,
  ): Array<{ provider: AiCloudProviderId; modelName: string }> => {
    const nimModel = resolveNimModel(nimModelOverride);
    if (taskKind === "multimodal_vision") {
      return [
        { provider: "gemini", modelName: "gemini-2.5-flash-lite" },
        { provider: "openrouter", modelName: "openrouter/free" },
        {
          provider: "workers_ai",
          modelName: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
        },
      ];
    }
    if (taskKind === "tactical_summary") {
      return [
        {
          provider: "workers_ai",
          modelName: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
        },
        { provider: "nim", modelName: nimModel },
        { provider: "gemini", modelName: "gemini-2.5-flash-lite" },
        { provider: "openrouter", modelName: "openrouter/free" },
      ];
    }
    return [
      { provider: "nim", modelName: nimModel },
      {
        provider: "workers_ai",
        modelName: "@cf/qwen/qwen2.5-coder-32b-instruct",
      },
      { provider: "gemini", modelName: "gemini-2.5-flash-lite" },
      { provider: "openrouter", modelName: "openrouter/free" },
    ];
  };

  let counter = 1;

  const routeAiRequest = async (
    request: AiRouteRequest,
  ): Promise<AiRouteResult> => {
    const chain = getChain(request.taskKind, request.nimModelOverride);
    const attempts: AiAttemptRecord[] = [];
    for (const step of chain) {
      if (request.simulateFailureProviders?.includes(step.provider)) {
        attempts.push({
          provider: step.provider,
          modelName: step.modelName,
          latencyMs: 1,
          statusCode: 503,
          ok: false,
          errorReason: "simulated_provider_outage",
        });
        continue;
      }

      const latencyMs = step.provider === "nim" ? 290 : 125;
      const fallbackUsed = attempts.length > 0;
      attempts.push({
        provider: step.provider,
        modelName: step.modelName,
        latencyMs,
        statusCode: 200,
        ok: true,
        errorReason: null,
      });

      const seq = counter;
      counter += 1;
      const requestId = `10000000-0000-4000-8000-${String(seq).padStart(12, "0")}`;
      const telemetry: AiTelemetryLogEntry = {
        id: `20000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
        requestId,
        provider: step.provider,
        modelName: step.modelName,
        taskKind: request.taskKind,
        latencyMs,
        tokensIn: Math.max(8, Math.ceil(request.prompt.length / 4)),
        tokensOut: 32,
        status: fallbackUsed ? "fallback" : "ok",
        fallbackUsed,
        statusCode: 200,
        createdAt: "2026-11-18T12:30:00.000Z",
      };

      return {
        requestId,
        taskKind: request.taskKind,
        provider: step.provider,
        modelName: step.modelName,
        outputText: `Respuesta determinista (${step.provider}/${step.modelName})`,
        latencyMs,
        tokensIn: telemetry.tokensIn,
        tokensOut: telemetry.tokensOut,
        fallbackUsed,
        statusCode: 200,
        attempts,
        telemetry,
      };
    }

    throw new Error("Todos los proveedores IA fallaron en la cadena de conmutacion.");
  };

  const buildScriptableWidgetPayload = (
    overrides?: Partial<ScriptableWidgetMetrics>,
  ): ScriptableWidgetPayload => ({
    version: "1.0",
    theme: "amoled-pure-black",
    ttlSeconds: 900,
    generatedAt: "2026-11-18T12:30:00.000Z",
    palette: {
      background: "#000000",
      surface: "#0A0A0A",
      border: "#1F1F1F",
      textPrimary: "#FFFFFF",
      textSecondary: "#A3A3A3",
      accentRecovery: "#10B981",
      accentStrain: "#3B82F6",
      accentSleep: "#8B5CF6",
      accentAlert: "#F59E0B",
    },
    metrics: {
      readinessScore: 86.4,
      readinessLabel: "Optimo",
      strainScore: 12.3,
      acwr: 1.08,
      sleepScore: 82,
      weeklyTonnageKg: 12450,
      latestWeightKg: 76.4,
      weatherTempC: 27,
      weatherCondition: "Parcialmente nublado",
      activeProvider: "workers_ai",
      activeModel: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
      routerLatencyMs: 120,
      fallbackActive: false,
      ...overrides,
    },
    shapSummary: "El sueno y la carga reciente explican el Readiness.",
    scriptableCode: "const widget = new ListWidget();",
  });

  return {
    resolveNimModel,
    routeAiRequest,
    buildScriptableWidgetPayload,
  };
});

import { GET as getAiRoute, POST as postAiRoute } from "@/app/api/ai/route/route";
import { GET as getScriptable } from "@/app/api/scriptable/route";
import {
  AI_TELEMETRY_INSERT_SQL,
  MAX_ACTORS,
  MAX_LOGS_PER_ACTOR,
  appendTelemetryLog,
  countTelemetryActors,
  getLatestTelemetryLog,
  getProviderQuotaStatuses,
  listTelemetryLogs,
  resetTelemetryStore,
  resolveActorKey,
} from "@/lib/ai/telemetry-store";

const BASE = "http://localhost";

interface GetAiRouteResponse {
  ok: boolean;
  logs: AiTelemetryLogEntry[];
  providers: ProviderQuotaStatus[];
  activeModels: Record<string, string>;
  error?: string;
}

interface PostAiRouteResponse {
  ok: boolean;
  result?: AiRouteResult;
  logs?: AiTelemetryLogEntry[];
  providers?: ProviderQuotaStatus[];
  sqlPreview?: string;
  error?: string;
}

interface GetScriptableResponse {
  ok: boolean;
  payload?: ScriptableWidgetPayload;
  error?: string;
}

function makeAiGetRequest(
  query = "",
  headers: Record<string, string> = {},
): Request {
  return new Request(`${BASE}/api/ai/route${query}`, { headers });
}

function makeAiPostRequest(
  body: unknown,
  headers: Record<string, string> = {},
  query = "",
): Request {
  return new Request(`${BASE}/api/ai/route${query}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function makeScriptableGetRequest(
  query = "",
  headers: Record<string, string> = {},
): Request {
  return new Request(`${BASE}/api/scriptable${query}`, { headers });
}

function buildTelemetryEntry(
  index: number,
  provider: AiTelemetryLogEntry["provider"] = "workers_ai",
): AiTelemetryLogEntry {
  return {
    id: `id-${index}`,
    requestId: `req-${index}`,
    provider,
    modelName: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    taskKind: "tactical_summary",
    latencyMs: 110 + (index % 20),
    tokensIn: 120,
    tokensOut: 40,
    status: "ok",
    fallbackUsed: false,
    statusCode: 200,
    createdAt: "2026-11-18T12:10:00.000Z",
  };
}

beforeEach(() => {
  resetTelemetryStore();
});

describe("GET /api/ai/route", () => {
  it("devuelve la semilla determinista de 6 logs, 5 proveedores y modelos activos", async () => {
    const response = await getAiRoute(makeAiGetRequest());
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");

    const body = (await response.json()) as GetAiRouteResponse;
    expect(body.ok).toBe(true);
    expect(body.logs).toHaveLength(6);

    const providersInLogs = new Set(body.logs.map((entry) => entry.provider));
    expect(providersInLogs).toEqual(
      new Set(["workers_ai", "nim", "gemini", "openrouter", "onnx_local"]),
    );

    const onnxEntry = body.logs.find((entry) => entry.provider === "onnx_local");
    expect(onnxEntry?.modelName).toBe("pulsetrack-readiness-mlp-v1.onnx");
    expect(onnxEntry?.latencyMs).toBe(1);

    const openrouterEntry = body.logs.find(
      (entry) => entry.provider === "openrouter",
    );
    expect(openrouterEntry?.modelName).toBe("openrouter/free");
    expect(openrouterEntry?.fallbackUsed).toBe(true);
    expect(openrouterEntry?.status).toBe("fallback");

    expect(body.providers).toHaveLength(5);
    const nimStatus = body.providers.find((item) => item.provider === "nim");
    expect(nimStatus?.defaultModel).toBe("nvidia/nemotron-3-ultra-550b-a55b");
    expect(nimStatus?.state).toBe("healthy");

    const openrouterStatus = body.providers.find(
      (item) => item.provider === "openrouter",
    );
    expect(openrouterStatus?.state).toBe("fallback");

    expect(body.activeModels).toEqual({
      workers_ai: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
      nim: "nvidia/nemotron-3-ultra-550b-a55b",
      gemini: "gemini-2.5-flash-lite",
      openrouter: "openrouter/free",
      onnx_local: "pulsetrack-readiness-mlp-v1.onnx",
    });
  });

  it("rechaza source=apple_health con 403 (ADR-001)", async () => {
    const response = await getAiRoute(makeAiGetRequest("?source=apple_health"));
    expect(response.status).toBe(403);
    const body = (await response.json()) as GetAiRouteResponse;
    expect(body.ok).toBe(false);
    expect(body.error).toContain("ADR-001");
  });
});

describe("POST /api/ai/route", () => {
  it("enruta en el camino feliz, persiste telemetria y devuelve sqlPreview", async () => {
    const response = await postAiRoute(
      makeAiPostRequest({
        taskKind: "biometric_reasoning",
        prompt: "Analiza ACWR 1.08, HRV 68 ms y sueno 82 puntos.",
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");

    const body = (await response.json()) as PostAiRouteResponse;
    expect(body.ok).toBe(true);
    expect(body.result?.provider).toBe("nim");
    expect(body.result?.modelName).toBe("nvidia/nemotron-3-ultra-550b-a55b");
    expect(body.result?.fallbackUsed).toBe(false);
    expect(body.logs).toHaveLength(7);
    expect(body.logs?.[0]?.requestId).toBe(body.result?.requestId);
    expect(body.sqlPreview).toBe(AI_TELEMETRY_INSERT_SQL);
  });

  it("ejecuta failover simulado cuando caen proveedores primarios", async () => {
    const response = await postAiRoute(
      makeAiPostRequest({
        taskKind: "tactical_summary",
        prompt: "Sintetiza el estado de carga semanal.",
        simulateFailureProviders: ["workers_ai", "nim"],
      }),
    );
    expect(response.status).toBe(200);

    const body = (await response.json()) as PostAiRouteResponse;
    expect(body.ok).toBe(true);
    expect(body.result?.provider).toBe("gemini");
    expect(body.result?.fallbackUsed).toBe(true);
    expect(body.result?.attempts).toHaveLength(3);
    expect(body.result?.telemetry.status).toBe("fallback");
    expect(body.logs?.[0]?.fallbackUsed).toBe(true);

    const geminiProvider = body.providers?.find(
      (item) => item.provider === "gemini",
    );
    expect(geminiProvider?.state).toBe("fallback");
  });

  it("rechaza input invalido con 400", async () => {
    const badJson = await postAiRoute(
      new Request(`${BASE}/api/ai/route`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{bad-json",
      }),
    );
    expect(badJson.status).toBe(400);

    const nonObject = await postAiRoute(makeAiPostRequest(["array"]));
    expect(nonObject.status).toBe(400);

    const badTask = await postAiRoute(
      makeAiPostRequest({ taskKind: "invalid_task", prompt: "Hola" }),
    );
    expect(badTask.status).toBe(400);

    const emptyPrompt = await postAiRoute(
      makeAiPostRequest({ taskKind: "tactical_summary", prompt: "   " }),
    );
    expect(emptyPrompt.status).toBe(400);

    const longPrompt = await postAiRoute(
      makeAiPostRequest({
        taskKind: "tactical_summary",
        prompt: "a".repeat(4001),
      }),
    );
    expect(longPrompt.status).toBe(400);

    const badSimProviders = await postAiRoute(
      makeAiPostRequest({
        taskKind: "tactical_summary",
        prompt: "Test",
        simulateFailureProviders: ["onnx_local"],
      }),
    );
    expect(badSimProviders.status).toBe(400);

    const badNimOverride = await postAiRoute(
      makeAiPostRequest({
        taskKind: "biometric_reasoning",
        prompt: "Test",
        nimModelOverride: "m".repeat(121),
      }),
    );
    expect(badNimOverride.status).toBe(400);
  });

  it("rechaza apple_health en query o body con 403 (ADR-001)", async () => {
    const byQuery = await postAiRoute(
      makeAiPostRequest(
        { taskKind: "tactical_summary", prompt: "Resumen" },
        {},
        "?source=apple_health",
      ),
    );
    expect(byQuery.status).toBe(403);

    const byBody = await postAiRoute(
      makeAiPostRequest({
        source: "Apple-Health",
        taskKind: "tactical_summary",
        prompt: "Resumen",
      }),
    );
    expect(byBody.status).toBe(403);
    expect(listTelemetryLogs("local-owner")).toHaveLength(6);
  });

  it("aisla bitacoras por actor x-user-id", async () => {
    await postAiRoute(
      makeAiPostRequest(
        { taskKind: "tactical_summary", prompt: "Actor A" },
        { "x-user-id": "actor-a" },
      ),
    );

    const logsA = listTelemetryLogs("actor-a");
    const logsB = listTelemetryLogs("actor-b");
    expect(logsA).toHaveLength(7);
    expect(logsB).toHaveLength(6);
  });
});

describe("GET /api/scriptable", () => {
  it("devuelve 200, cabeceras cache 900s, paleta #000000 y refleja el ultimo log del actor", async () => {
    await postAiRoute(
      makeAiPostRequest(
        {
          taskKind: "tactical_summary",
          prompt: "Falla primaria para activar fallback",
          simulateFailureProviders: ["workers_ai"],
        },
        { "x-user-id": "ios-user" },
      ),
    );

    const response = await getScriptable(
      makeScriptableGetRequest("", { "x-user-id": "ios-user" }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe(
      "public, max-age=900, stale-while-revalidate=900",
    );
    expect(response.headers.get("X-PulseTrack-Cache-TTL")).toBe("900");

    const body = (await response.json()) as GetScriptableResponse;
    expect(body.ok).toBe(true);
    expect(body.payload?.theme).toBe("amoled-pure-black");
    expect(body.payload?.ttlSeconds).toBe(900);
    expect(body.payload?.palette.background).toBe("#000000");
    expect(body.payload?.metrics.activeProvider).toBe("nim");
    expect(body.payload?.metrics.activeModel).toBe(
      "nvidia/nemotron-3-ultra-550b-a55b",
    );
    expect(body.payload?.metrics.fallbackActive).toBe(true);
  });

  it("rechaza source=apple_health con 403 (ADR-001)", async () => {
    const response = await getScriptable(
      makeScriptableGetRequest("?source=apple_health"),
    );
    expect(response.status).toBe(403);
    const body = (await response.json()) as GetScriptableResponse;
    expect(body.ok).toBe(false);
  });
});

describe("telemetry-store cuotas LRU", () => {
  it("resuelve cabecera x-user-id invalida a local-owner", () => {
    const req = new Request(BASE, { headers: { "x-user-id": "invalid actor!" } });
    expect(resolveActorKey(req)).toBe("local-owner");
  });

  it("evicta el log mas antiguo al superar MAX_LOGS_PER_ACTOR y actualiza getLatestTelemetryLog", () => {
    for (let i = 0; i < MAX_LOGS_PER_ACTOR + 5; i += 1) {
      appendTelemetryLog("quota-actor", buildTelemetryEntry(i));
    }

    const logs = listTelemetryLogs("quota-actor");
    expect(logs).toHaveLength(MAX_LOGS_PER_ACTOR);
    expect(logs.some((entry) => entry.requestId === "req-0")).toBe(false);
    expect(
      logs.some(
        (entry) => entry.requestId === `req-${MAX_LOGS_PER_ACTOR + 4}`,
      ),
    ).toBe(true);
    expect(getLatestTelemetryLog("quota-actor")?.requestId).toBe(
      `req-${MAX_LOGS_PER_ACTOR + 4}`,
    );

    const quotas = getProviderQuotaStatuses("quota-actor");
    const workersQuota = quotas.find((item) => item.provider === "workers_ai");
    expect(workersQuota?.requestsCount).toBe(MAX_LOGS_PER_ACTOR);
  });

  it("evicta el actor menos usado al superar MAX_ACTORS", () => {
    for (let i = 0; i < MAX_ACTORS + 4; i += 1) {
      listTelemetryLogs(`actor-${i}`);
    }
    expect(countTelemetryActors()).toBe(MAX_ACTORS);
  });
});
