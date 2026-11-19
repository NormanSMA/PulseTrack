"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AiAttemptRecord,
  AiCloudProviderId,
  AiProviderId,
  AiRouteResult,
  AiTaskKind,
  AiTelemetryLogEntry,
  AiTelemetryStatus,
  ProviderQuotaStatus,
  ScriptableWidgetPayload,
} from "@/lib/ai/types";

interface TelemetryApiResponse {
  ok: boolean;
  logs: AiTelemetryLogEntry[];
  providers: ProviderQuotaStatus[];
  activeModels?: Partial<Record<AiProviderId, string>>;
}

interface RoutePostApiResponse {
  ok: boolean;
  result: AiRouteResult;
  logs?: AiTelemetryLogEntry[];
  providers?: ProviderQuotaStatus[];
  sqlPreview?: string;
}

interface ScriptableApiResponse {
  ok: boolean;
  payload: ScriptableWidgetPayload;
}

type ProviderFilterId = "all" | AiProviderId;

const TASK_OPTIONS: {
  id: AiTaskKind;
  label: string;
  primaryHint: string;
  defaultPrompt: string;
}[] = [
  {
    id: "tactical_summary",
    label: "Resumen Tactico",
    primaryHint: "Cloudflare Workers AI -> NVIDIA NIM -> OpenRouter :free",
    defaultPrompt:
      "Resume readiness 86.4, ACWR 1.08 y sueno 84 con recomendacion de carga para sesion de fuerza.",
  },
  {
    id: "biometric_reasoning",
    label: "Razonamiento Biometrico",
    primaryHint: "NVIDIA NIM (nemotron-3-ultra-550b-a55b) -> Workers AI -> OpenRouter :free",
    defaultPrompt:
      "Evalua desacoplamiento Pa:Hr 3.2%, HRV 78 ms, RHR 46 bpm y tonelaje semanal 14820 kg para ajuste de microciclo.",
  },
  {
    id: "multimodal_vision",
    label: "Vision Multimodal",
    primaryHint: "Google AI Studio (Gemini 2.5 Flash-Lite) -> NVIDIA NIM -> OpenRouter :free",
    defaultPrompt:
      "Analiza captura nutricional pre-entreno: avena 80g, whey 35g, platano 120g y estima impacto glucemico.",
  },
];

const FAILOVER_SIM_OPTIONS: {
  id: AiCloudProviderId;
  label: string;
  modelHint: string;
}[] = [
  {
    id: "workers_ai",
    label: "Simular caida workers_ai",
    modelHint: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  },
  {
    id: "nim",
    label: "Simular caida nim",
    modelHint: "nvidia/nemotron-3-ultra-550b-a55b",
  },
  {
    id: "gemini",
    label: "Simular caida gemini",
    modelHint: "gemini-2.5-flash-lite",
  },
];

const TELEMETRY_FILTERS: { id: ProviderFilterId; label: string }[] = [
  { id: "all", label: "all" },
  { id: "workers_ai", label: "workers_ai" },
  { id: "nim", label: "nim" },
  { id: "gemini", label: "gemini" },
  { id: "openrouter", label: "openrouter" },
  { id: "onnx_local", label: "onnx_local" },
];

const BUTTON_BASE =
  "min-h-11 min-w-11 rounded-xl border px-4 text-sm font-semibold pt-motion-gpu motion-reduce:transform-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-strain active:scale-95 disabled:cursor-not-allowed disabled:opacity-40";
const BUTTON_IDLE =
  "border-border-subtle bg-surface text-ink-secondary hover:border-border-strong hover:text-ink-primary";
const BUTTON_ACTIVE =
  "border-accent-strain/60 bg-accent-strain/10 text-accent-strain hover:bg-accent-strain/20";
const BUTTON_ALERT_ACTIVE =
  "border-accent-danger/60 bg-accent-danger/10 text-accent-danger hover:bg-accent-danger/20";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isTelemetryApiResponse(value: unknown): value is TelemetryApiResponse {
  return (
    isRecord(value) &&
    value.ok === true &&
    Array.isArray(value.logs) &&
    Array.isArray(value.providers)
  );
}

function isRoutePostApiResponse(value: unknown): value is RoutePostApiResponse {
  return (
    isRecord(value) &&
    value.ok === true &&
    isRecord(value.result) &&
    typeof value.result.provider === "string" &&
    typeof value.result.modelName === "string" &&
    typeof value.result.outputText === "string" &&
    Array.isArray(value.result.attempts)
  );
}

function isScriptableApiResponse(value: unknown): value is ScriptableApiResponse {
  return (
    isRecord(value) &&
    value.ok === true &&
    isRecord(value.payload) &&
    isRecord(value.payload.metrics) &&
    typeof value.payload.scriptableCode === "string"
  );
}

export function buildFallbackTelemetry(): {
  logs: AiTelemetryLogEntry[];
  providers: ProviderQuotaStatus[];
  initialResult: AiRouteResult;
} {
  const logs: AiTelemetryLogEntry[] = [
    {
      id: "tel-fallback-01",
      requestId: "req-seed-workers-01",
      provider: "workers_ai",
      modelName: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
      taskKind: "tactical_summary",
      latencyMs: 284,
      tokensIn: 142,
      tokensOut: 96,
      status: "ok",
      fallbackUsed: false,
      statusCode: 200,
      createdAt: "2026-11-18T18:00:00.000Z",
    },
    {
      id: "tel-fallback-02",
      requestId: "req-seed-nim-02",
      provider: "nim",
      modelName: "nvidia/nemotron-3-ultra-550b-a55b",
      taskKind: "biometric_reasoning",
      latencyMs: 612,
      tokensIn: 310,
      tokensOut: 224,
      status: "ok",
      fallbackUsed: false,
      statusCode: 200,
      createdAt: "2026-11-18T17:55:00.000Z",
    },
    {
      id: "tel-fallback-03",
      requestId: "req-seed-gemini-03",
      provider: "gemini",
      modelName: "gemini-2.5-flash-lite",
      taskKind: "multimodal_vision",
      latencyMs: 418,
      tokensIn: 520,
      tokensOut: 164,
      status: "ok",
      fallbackUsed: false,
      statusCode: 200,
      createdAt: "2026-11-18T17:50:00.000Z",
    },
    {
      id: "tel-fallback-04",
      requestId: "req-seed-openrouter-04",
      provider: "openrouter",
      modelName: "openrouter/free",
      taskKind: "biometric_reasoning",
      latencyMs: 890,
      tokensIn: 280,
      tokensOut: 190,
      status: "fallback",
      fallbackUsed: true,
      statusCode: 200,
      createdAt: "2026-11-18T17:45:00.000Z",
    },
    {
      id: "tel-fallback-05",
      requestId: "req-seed-onnx-05",
      provider: "onnx_local",
      modelName: "pulsetrack-readiness-mlp-v1.onnx",
      taskKind: "tactical_summary",
      latencyMs: 1,
      tokensIn: 14,
      tokensOut: 4,
      status: "ok",
      fallbackUsed: false,
      statusCode: 200,
      createdAt: "2026-11-18T17:40:00.000Z",
    },
  ];

  const providers: ProviderQuotaStatus[] = [
    {
      provider: "workers_ai",
      label: "Cloudflare Workers AI",
      defaultModel: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
      p50LatencyMs: 284,
      p95LatencyMs: 340,
      successRatePct: 100,
      requestsCount: 18,
      tokensTotal: 4280,
      quotaUsedPct: 14.2,
      state: "healthy",
    },
    {
      provider: "nim",
      label: "NVIDIA NIM",
      defaultModel: "nvidia/nemotron-3-ultra-550b-a55b",
      p50LatencyMs: 612,
      p95LatencyMs: 745,
      successRatePct: 100,
      requestsCount: 12,
      tokensTotal: 6420,
      quotaUsedPct: 21.4,
      state: "healthy",
    },
    {
      provider: "gemini",
      label: "Google AI Studio",
      defaultModel: "gemini-2.5-flash-lite",
      p50LatencyMs: 418,
      p95LatencyMs: 510,
      successRatePct: 100,
      requestsCount: 9,
      tokensTotal: 6150,
      quotaUsedPct: 18.0,
      state: "healthy",
    },
    {
      provider: "openrouter",
      label: "OpenRouter :free",
      defaultModel: "openrouter/free",
      p50LatencyMs: 890,
      p95LatencyMs: 1120,
      successRatePct: 100,
      requestsCount: 3,
      tokensTotal: 1410,
      quotaUsedPct: 9.5,
      state: "fallback",
    },
    {
      provider: "onnx_local",
      label: "ONNX Local",
      defaultModel: "pulsetrack-readiness-mlp-v1.onnx",
      p50LatencyMs: 1,
      p95LatencyMs: 2,
      successRatePct: 100,
      requestsCount: 42,
      tokensTotal: 756,
      quotaUsedPct: 1.0,
      state: "healthy",
    },
  ];

  const firstLog = logs[0]!;
  const initialResult: AiRouteResult = {
    requestId: firstLog.requestId,
    taskKind: firstLog.taskKind,
    provider: "workers_ai",
    modelName: firstLog.modelName,
    outputText:
      "Readiness 86.4/100 (Optimo) y ACWR 1.08 en zona segura. Manten volumen planificado de hipertrofia con margen RIR 1-2 y prioriza hidratacion post-entreno.",
    latencyMs: firstLog.latencyMs,
    tokensIn: firstLog.tokensIn,
    tokensOut: firstLog.tokensOut,
    fallbackUsed: false,
    statusCode: 200,
    attempts: [
      {
        provider: "workers_ai",
        modelName: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
        latencyMs: 284,
        statusCode: 200,
        ok: true,
        errorReason: null,
      },
    ],
    telemetry: firstLog,
  };

  return { logs, providers, initialResult };
}

export function buildFallbackScriptable(): ScriptableWidgetPayload {
  const scriptableCode = [
    "// PulseTrack iOS Scriptable Widget (AMOLED #000000 - Cache 15 min)",
    'const API_URL = "https://pulsetrack.app/api/scriptable";',
    "const fm = FileManager.local();",
    'const cachePath = fm.joinPath(fm.documentsDirectory(), "pulsetrack-widget-cache.json");',
    "let data = null;",
    "try {",
    "  const req = new Request(API_URL);",
    "  req.timeoutInterval = 8;",
    "  const res = await req.loadJSON();",
    "  data = res.payload ?? res;",
    "  fm.writeString(cachePath, JSON.stringify(data));",
    "} catch (e) {",
    "  if (fm.fileExists(cachePath)) data = JSON.parse(fm.readString(cachePath));",
    "}",
    "const w = new ListWidget();",
    'w.backgroundColor = new Color("#000000");',
    'const title = w.addText("PULSETRACK // READINESS " + (data?.metrics?.readinessScore ?? 86.4));',
    'title.textColor = new Color("#10B981");',
    "title.font = Font.boldMonospacedSystemFont(12);",
    "w.refreshAfterDate = new Date(Date.now() + 900 * 1000);",
    "Script.setWidget(w);",
    "Script.complete();",
  ].join("\n");

  return {
    version: "1.0",
    theme: "amoled-pure-black",
    ttlSeconds: 900,
    generatedAt: "2026-11-18T18:00:00.000Z",
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
      strainScore: 14.2,
      acwr: 1.08,
      sleepScore: 84,
      weeklyTonnageKg: 14820,
      latestWeightKg: 74.6,
      weatherTempC: 19.4,
      weatherCondition: "Despejado",
      activeProvider: "workers_ai",
      activeModel: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
      routerLatencyMs: 284,
      fallbackActive: false,
    },
    shapSummary: "HRV +12% (+6.4 pts) · RHR 46 bpm (+4.1 pts) · ACWR 1.08 (-1.2 pts)",
    scriptableCode,
  };
}

function buildLocalSimulatedRouteResult(
  taskKind: AiTaskKind,
  prompt: string,
  failedProviders: readonly AiCloudProviderId[],
): AiRouteResult {
  const chains: Record<
    AiTaskKind,
    { provider: AiCloudProviderId; modelName: string; baseLatencyMs: number }[]
  > = {
    tactical_summary: [
      {
        provider: "workers_ai",
        modelName: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
        baseLatencyMs: 278,
      },
      {
        provider: "nim",
        modelName: "nvidia/nemotron-3-ultra-550b-a55b",
        baseLatencyMs: 590,
      },
      {
        provider: "gemini",
        modelName: "gemini-2.5-flash-lite",
        baseLatencyMs: 410,
      },
      {
        provider: "openrouter",
        modelName: "openrouter/free",
        baseLatencyMs: 840,
      },
    ],
    biometric_reasoning: [
      {
        provider: "nim",
        modelName: "nvidia/nemotron-3-ultra-550b-a55b",
        baseLatencyMs: 605,
      },
      {
        provider: "workers_ai",
        modelName: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
        baseLatencyMs: 295,
      },
      {
        provider: "gemini",
        modelName: "gemini-2.5-flash-lite",
        baseLatencyMs: 425,
      },
      {
        provider: "openrouter",
        modelName: "openrouter/free",
        baseLatencyMs: 880,
      },
    ],
    multimodal_vision: [
      {
        provider: "gemini",
        modelName: "gemini-2.5-flash-lite",
        baseLatencyMs: 412,
      },
      {
        provider: "nim",
        modelName: "nvidia/nemotron-3-ultra-550b-a55b",
        baseLatencyMs: 630,
      },
      {
        provider: "workers_ai",
        modelName: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
        baseLatencyMs: 310,
      },
      {
        provider: "openrouter",
        modelName: "openrouter/free",
        baseLatencyMs: 910,
      },
    ],
  };

  const chain = chains[taskKind];
  const attempts: AiAttemptRecord[] = [];
  let chosen = chain[chain.length - 1]!;

  for (const step of chain) {
    const shouldFail = failedProviders.includes(step.provider);
    if (shouldFail) {
      attempts.push({
        provider: step.provider,
        modelName: step.modelName,
        latencyMs: 120,
        statusCode: 503,
        ok: false,
        errorReason: `Simulated provider outage (${step.provider})`,
      });
    } else {
      attempts.push({
        provider: step.provider,
        modelName: step.modelName,
        latencyMs: step.baseLatencyMs,
        statusCode: 200,
        ok: true,
        errorReason: null,
      });
      chosen = step;
      break;
    }
  }

  const fallbackUsed = attempts.length > 1;
  const tokensIn = Math.max(24, Math.round(prompt.trim().length * 0.35));
  const tokensOut = 118;
  const totalLatencyMs = attempts.reduce((acc, item) => acc + item.latencyMs, 0);
  const requestId = `req-local-${Date.now()}`;
  const status: AiTelemetryStatus = fallbackUsed ? "fallback" : "ok";
  const outputText = `[${chosen.provider} :: ${chosen.modelName}] Analisis completado (${taskKind}): Readiness 86.4/100, ACWR 1.08, Pa:Hr 3.2%. Recomendacion: mantener intensidad objetivo con ventana de recuperacion parasimpatica optima.`;

  const telemetry: AiTelemetryLogEntry = {
    id: `tel-${Date.now()}`,
    requestId,
    provider: chosen.provider,
    modelName: chosen.modelName,
    taskKind,
    latencyMs: totalLatencyMs,
    tokensIn,
    tokensOut,
    status,
    fallbackUsed,
    statusCode: 200,
    createdAt: new Date().toISOString(),
  };

  return {
    requestId,
    taskKind,
    provider: chosen.provider,
    modelName: chosen.modelName,
    outputText,
    latencyMs: totalLatencyMs,
    tokensIn,
    tokensOut,
    fallbackUsed,
    statusCode: 200,
    attempts,
    telemetry,
  };
}

function formatStateBadge(state: ProviderQuotaStatus["state"]): {
  label: string;
  classes: string;
} {
  if (state === "healthy") {
    return {
      label: "healthy",
      classes: "border-accent-recovery/40 bg-accent-recovery/10 text-accent-recovery",
    };
  }
  if (state === "degraded") {
    return {
      label: "degraded",
      classes: "border-accent-alert/40 bg-accent-alert/10 text-accent-alert",
    };
  }
  return {
    label: "fallback",
    classes: "border-accent-sleep/40 bg-accent-sleep/10 text-accent-sleep",
  };
}

function formatTaskKindLabel(taskKind: AiTaskKind): string {
  if (taskKind === "tactical_summary") return "Resumen Tactico";
  if (taskKind === "biometric_reasoning") return "Razonamiento Biometrico";
  return "Vision Multimodal";
}

export function AiEngineDashboardClient() {
  const initialFallback = useMemo(() => buildFallbackTelemetry(), []);
  const initialScriptable = useMemo(() => buildFallbackScriptable(), []);

  const [logs, setLogs] = useState<AiTelemetryLogEntry[]>(initialFallback.logs);
  const [providers, setProviders] = useState<ProviderQuotaStatus[]>(
    initialFallback.providers,
  );
  const [routeResult, setRouteResult] = useState<AiRouteResult>(
    initialFallback.initialResult,
  );
  const [scriptablePayload, setScriptablePayload] =
    useState<ScriptableWidgetPayload>(initialScriptable);

  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selectedTask, setSelectedTask] = useState<AiTaskKind>("tactical_summary");
  const [promptText, setPromptText] = useState<string>(
    TASK_OPTIONS[0]?.defaultPrompt ?? "",
  );
  const [simulatedFailures, setSimulatedFailures] = useState<AiCloudProviderId[]>(
    [],
  );
  const [routing, setRouting] = useState<boolean>(false);
  const [routeStatusMessage, setRouteStatusMessage] = useState<string | null>(null);

  const [providerFilter, setProviderFilter] = useState<ProviderFilterId>("all");

  const [refreshingScriptable, setRefreshingScriptable] = useState<boolean>(false);
  const [scriptableAnnouncement, setScriptableAnnouncement] = useState<string>("");

  const requestSeqRef = useRef<number>(0);

  const loadDashboardData = useCallback(async () => {
    const seq = requestSeqRef.current + 1;
    requestSeqRef.current = seq;
    setLoading(true);
    setLoadError(null);

    try {
      const [telemetryRes, scriptableRes] = await Promise.all([
        fetch("/api/ai/route", { cache: "no-store" }),
        fetch("/api/scriptable", { cache: "no-store" }),
      ]);

      if (!telemetryRes.ok) {
        throw new Error(`GET /api/ai/route HTTP ${telemetryRes.status}`);
      }
      if (!scriptableRes.ok) {
        throw new Error(`GET /api/scriptable HTTP ${scriptableRes.status}`);
      }

      const [telemetryJson, scriptableJson]: [unknown, unknown] = await Promise.all([
        telemetryRes.json(),
        scriptableRes.json(),
      ]);

      if (!isTelemetryApiResponse(telemetryJson)) {
        throw new Error("Formato invalido en /api/ai/route");
      }
      if (!isScriptableApiResponse(scriptableJson)) {
        throw new Error("Formato invalido en /api/scriptable");
      }
      if (seq !== requestSeqRef.current) return;

      setLogs(telemetryJson.logs);
      setProviders(telemetryJson.providers);
      setScriptablePayload(scriptableJson.payload);
    } catch (error) {
      if (seq !== requestSeqRef.current) return;
      const detail = error instanceof Error ? error.message : "Error de red";
      setLoadError(
        `No se pudo sincronizar la telemetria cloud (${detail}). Se muestran datos locales deterministas.`,
      );
      const fallbackTelemetry = buildFallbackTelemetry();
      setLogs(fallbackTelemetry.logs);
      setProviders(fallbackTelemetry.providers);
      setScriptablePayload(buildFallbackScriptable());
    } finally {
      if (seq === requestSeqRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadDashboardData();
  }, [loadDashboardData]);

  const handleSelectTask = (taskKind: AiTaskKind) => {
    setSelectedTask(taskKind);
    const preset = TASK_OPTIONS.find((item) => item.id === taskKind);
    if (preset) {
      setPromptText(preset.defaultPrompt);
    }
  };

  const toggleSimulatedFailure = (provider: AiCloudProviderId) => {
    setSimulatedFailures((prev) =>
      prev.includes(provider)
        ? prev.filter((item) => item !== provider)
        : [...prev, provider],
    );
  };

  const handleExecuteRoute = async () => {
    const trimmedPrompt = promptText.trim();
    if (!trimmedPrompt) {
      setRouteStatusMessage("Ingresa un prompt biometrico valido antes de enrutar.");
      return;
    }

    setRouting(true);
    setRouteStatusMessage("Enrutando solicitud en cascada Cloud...");

    try {
      const response = await fetch("/api/ai/route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskKind: selectedTask,
          prompt: trimmedPrompt,
          simulateFailureProviders: simulatedFailures,
        }),
      });

      const json: unknown = await response.json().catch(() => null);
      if (!response.ok || !isRoutePostApiResponse(json)) {
        const msg =
          isRecord(json) && typeof json.error === "string"
            ? json.error
            : `HTTP ${response.status}`;
        throw new Error(msg);
      }

      setRouteResult(json.result);
      if (Array.isArray(json.logs)) {
        setLogs(json.logs);
      } else {
        setLogs((prev) => [json.result.telemetry, ...prev]);
      }
      if (Array.isArray(json.providers)) {
        setProviders(json.providers);
      }
      setLoadError(null);
      setRouteStatusMessage(
        `Respuesta completada por ${json.result.provider} (${json.result.latencyMs} ms).`,
      );
    } catch {
      const simulated = buildLocalSimulatedRouteResult(
        selectedTask,
        trimmedPrompt,
        simulatedFailures,
      );
      setRouteResult(simulated);
      setLogs((prev) => [simulated.telemetry, ...prev]);
      setRouteStatusMessage(
        `Simulacion determinista local ejecutada via ${simulated.provider} (${simulated.latencyMs} ms).`,
      );
    } finally {
      setRouting(false);
    }
  };

  const handleRefreshScriptable = async () => {
    setRefreshingScriptable(true);
    setScriptableAnnouncement("Actualizando payload Scriptable...");
    try {
      const response = await fetch("/api/scriptable", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const json: unknown = await response.json();
      if (!isScriptableApiResponse(json)) {
        throw new Error("Payload Scriptable invalido");
      }
      setScriptablePayload(json.payload);
      setScriptableAnnouncement(
        `Payload Scriptable actualizado (${json.payload.ttlSeconds} s TTL).`,
      );
    } catch {
      const fallback = buildFallbackScriptable();
      setScriptablePayload(fallback);
      setScriptableAnnouncement(
        "Payload Scriptable regenerado desde cache local determinista (900 s TTL).",
      );
    } finally {
      setRefreshingScriptable(false);
    }
  };

  const handleCopyScriptable = async () => {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(scriptablePayload.scriptableCode);
        setScriptableAnnouncement("Script iOS copiado al portapapeles.");
      } else {
        setScriptableAnnouncement("Portapapeles no disponible en este contexto.");
      }
    } catch {
      setScriptableAnnouncement("No se pudo copiar el script automaticamente.");
    }
  };

  const filteredLogs = useMemo(() => {
    if (providerFilter === "all") return logs;
    return logs.filter((entry) => entry.provider === providerFilter);
  }, [logs, providerFilter]);

  return (
    <div className="space-y-6">
      <header className="border-b border-border-subtle pb-5">
        <p className="text-xs font-semibold uppercase tracking-widest text-accent-alert">
          AI Engine · Cloud Router + ONNX + Scriptable iOS
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink-primary sm:text-3xl">
          Enrutador Hibrido Cloud y Telemetria en Vivo
        </h1>
        <p className="mt-1 text-sm text-ink-secondary">
          Conmutacion automatica entre Cloudflare Workers AI, NVIDIA NIM, Google AI
          Studio, OpenRouter :free e inferencia local ONNX.
        </p>
      </header>

      {loadError ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-accent-danger/40 bg-accent-danger/10 p-4 text-sm text-accent-danger"
        >
          <span>{loadError}</span>
          <button
            type="button"
            onClick={() => void loadDashboardData()}
            disabled={loading}
            className={`${BUTTON_BASE} ${BUTTON_IDLE}`}
          >
            {loading ? "Cargando..." : "Reintentar"}
          </button>
        </div>
      ) : null}

      <section aria-label="Estado y cuotas por proveedor" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-ink-primary">
            Proveedores de Inferencia y Cuotas Activas
          </h2>
          <span className="text-xs text-ink-secondary tabular-nums">
            5 motores registrados · presupuesto UI 144Hz
          </span>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
          {providers.map((provider) => {
            const badge = formatStateBadge(provider.state);
            return (
              <article
                key={provider.provider}
                className="flex flex-col justify-between rounded-2xl border border-border-subtle bg-surface p-4"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wider text-ink-secondary">
                        {provider.provider}
                      </p>
                      <h3 className="mt-0.5 text-sm font-semibold text-ink-primary">
                        {provider.label}
                      </h3>
                    </div>
                    <span
                      className={`rounded-lg border px-2 py-0.5 text-xs font-semibold uppercase ${badge.classes}`}
                    >
                      {badge.label}
                    </span>
                  </div>

                  <p className="mt-2 truncate font-mono text-xs text-ink-secondary">
                    {provider.defaultModel}
                  </p>
                </div>

                <dl className="mt-4 grid grid-cols-2 gap-2 border-t border-border-subtle pt-3 text-xs">
                  <div>
                    <dt className="text-ink-secondary">Latencia p50 / p95</dt>
                    <dd className="mt-0.5 font-semibold text-ink-primary tabular-nums">
                      {provider.p50LatencyMs} / {provider.p95LatencyMs} ms
                    </dd>
                  </div>
                  <div>
                    <dt className="text-ink-secondary">Exito</dt>
                    <dd className="mt-0.5 font-semibold text-accent-recovery tabular-nums">
                      {provider.successRatePct.toFixed(1)}%
                    </dd>
                  </div>
                  <div>
                    <dt className="text-ink-secondary">Tokens acum.</dt>
                    <dd className="mt-0.5 font-semibold text-ink-primary tabular-nums">
                      {provider.tokensTotal}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-ink-secondary">Cuota / Reqs</dt>
                    <dd className="mt-0.5 font-semibold text-ink-secondary tabular-nums">
                      {provider.quotaUsedPct.toFixed(1)}% ({provider.requestsCount})
                    </dd>
                  </div>
                </dl>
              </article>
            );
          })}
        </div>
      </section>

      <section
        aria-label="Consola interactiva del enrutador cloud"
        className="rounded-2xl border border-border-subtle bg-surface p-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle pb-4">
          <div>
            <h2 className="text-base font-semibold text-ink-primary">
              Consola Interactiva del Enrutador Cloud y Simulador de Failover
            </h2>
            <p className="mt-0.5 text-xs text-ink-secondary">
              Selecciona el perfil de tarea, inyecta caidas simuladas y verifica la
              conmutacion automatica.
            </p>
          </div>
          <span
            className={`rounded-xl border px-3 py-1 text-xs font-semibold tabular-nums ${
              routeResult.fallbackUsed
                ? "border-accent-alert/40 bg-accent-alert/10 text-accent-alert"
                : "border-accent-recovery/40 bg-accent-recovery/10 text-accent-recovery"
            }`}
          >
            {routeResult.fallbackUsed ? "Fallback Activo" : "Ruta Primaria"}
          </span>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="space-y-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-ink-secondary">
                Perfil de Tarea Biométrica
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {TASK_OPTIONS.map((task) => {
                  const active = selectedTask === task.id;
                  return (
                    <button
                      key={task.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => handleSelectTask(task.id)}
                      className={`${BUTTON_BASE} ${
                        active ? BUTTON_ACTIVE : BUTTON_IDLE
                      }`}
                    >
                      {task.label}
                    </button>
                  );
                })}
              </div>
              <p className="mt-1.5 text-xs text-ink-secondary">
                Cadena:{" "}
                <span className="font-mono text-ink-primary">
                  {TASK_OPTIONS.find((t) => t.id === selectedTask)?.primaryHint}
                </span>
              </p>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-ink-secondary">
                Simulador de Caida de Proveedor (Failover en Vivo)
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {FAILOVER_SIM_OPTIONS.map((option) => {
                  const active = simulatedFailures.includes(option.id);
                  return (
                    <button
                      key={option.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => toggleSimulatedFailure(option.id)}
                      className={`${BUTTON_BASE} ${
                        active ? BUTTON_ALERT_ACTIVE : BUTTON_IDLE
                      }`}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label
                htmlFor="ai-router-prompt"
                className="block text-xs font-semibold uppercase tracking-wider text-ink-secondary"
              >
                Prompt Biometrico / Contexto de Inferencia
              </label>
              <textarea
                id="ai-router-prompt"
                rows={3}
                value={promptText}
                onChange={(event) => setPromptText(event.target.value)}
                className="mt-2 w-full rounded-xl border border-border-subtle bg-void p-3 text-sm text-ink-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-strain"
                placeholder="Describe metricas de HRV, ACWR, tonelaje o nutricion..."
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => void handleExecuteRoute()}
                disabled={routing}
                className={`${BUTTON_BASE} ${BUTTON_ACTIVE}`}
              >
                {routing ? "Enrutando..." : "Ejecutar Enrutamiento Cloud"}
              </button>
              {routeStatusMessage ? (
                <p
                  role="status"
                  aria-live="polite"
                  className="text-xs text-ink-secondary tabular-nums"
                >
                  {routeStatusMessage}
                </p>
              ) : null}
            </div>
          </div>

          <div className="flex flex-col justify-between rounded-2xl border border-border-subtle bg-void p-4">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle pb-3">
                <div>
                  <p className="text-xs text-ink-secondary">Proveedor Resuelto</p>
                  <p className="text-sm font-semibold text-ink-primary">
                    {routeResult.provider}{" "}
                    <span className="font-mono text-xs text-ink-secondary">
                      ({routeResult.modelName})
                    </span>
                  </p>
                </div>
                <div className="text-right text-xs tabular-nums">
                  <p className="font-semibold text-accent-recovery">
                    {routeResult.latencyMs} ms · HTTP {routeResult.statusCode}
                  </p>
                  <p className="text-ink-secondary">
                    Tokens: {routeResult.tokensIn} in / {routeResult.tokensOut} out
                  </p>
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-ink-secondary">
                  Respuesta Generada
                </p>
                <p className="mt-1.5 rounded-xl border border-border-subtle bg-surface p-3 text-sm text-ink-primary">
                  {routeResult.outputText}
                </p>
              </div>
            </div>

            <div className="mt-4 border-t border-border-subtle pt-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-ink-secondary">
                Cadena de Intentos ({routeResult.attempts.length})
              </p>
              <ul className="mt-2 space-y-1.5 text-xs tabular-nums">
                {routeResult.attempts.map((attempt, index) => (
                  <li
                    key={`${attempt.provider}-${index}`}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border-subtle bg-surface px-3 py-2"
                  >
                    <div>
                      <span className="font-semibold text-ink-primary">
                        #{index + 1} {attempt.provider}
                      </span>{" "}
                      <span className="font-mono text-ink-secondary">
                        · {attempt.modelName}
                      </span>
                      {attempt.errorReason ? (
                        <span className="ml-2 text-accent-danger">
                          ({attempt.errorReason})
                        </span>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-ink-secondary">
                        {attempt.latencyMs} ms
                      </span>
                      <span
                        className={`font-semibold ${
                          attempt.ok ? "text-accent-recovery" : "text-accent-danger"
                        }`}
                      >
                        HTTP {attempt.statusCode}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section
        aria-label="Bitacora de telemetria ai_telemetry_logs"
        className="rounded-2xl border border-border-subtle bg-surface p-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle pb-4">
          <div>
            <h2 className="text-base font-semibold text-ink-primary">
              Bitacora de Telemetria (`ai_telemetry_logs`)
            </h2>
            <p className="mt-0.5 text-xs text-ink-secondary">
              Trazabilidad inmutable por solicitud con latencia, tokens, estado HTTP y
              marca de fallback.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {TELEMETRY_FILTERS.map((filter) => {
              const active = providerFilter === filter.id;
              return (
                <button
                  key={filter.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setProviderFilter(filter.id)}
                  className={`${BUTTON_BASE} ${
                    active ? BUTTON_ACTIVE : BUTTON_IDLE
                  }`}
                >
                  {filter.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs tabular-nums">
            <thead>
              <tr className="border-b border-border-subtle text-ink-secondary">
                <th className="py-2.5 pr-4 font-semibold">Proveedor</th>
                <th className="py-2.5 pr-4 font-semibold">Modelo</th>
                <th className="py-2.5 pr-4 font-semibold">Tarea</th>
                <th className="py-2.5 pr-4 font-semibold">Latencia</th>
                <th className="py-2.5 pr-4 font-semibold">Tokens (In / Out)</th>
                <th className="py-2.5 pr-4 font-semibold">HTTP</th>
                <th className="py-2.5 font-semibold">Ruta / Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {filteredLogs.map((entry) => (
                <tr key={entry.id} className="text-ink-primary">
                  <td className="py-3 pr-4 font-semibold">{entry.provider}</td>
                  <td className="py-3 pr-4 font-mono text-ink-secondary">
                    {entry.modelName}
                  </td>
                  <td className="py-3 pr-4 text-ink-secondary">
                    {formatTaskKindLabel(entry.taskKind)}
                  </td>
                  <td className="py-3 pr-4 font-semibold">{entry.latencyMs} ms</td>
                  <td className="py-3 pr-4 text-ink-secondary">
                    {entry.tokensIn} / {entry.tokensOut}
                  </td>
                  <td className="py-3 pr-4 font-semibold text-accent-recovery">
                    {entry.statusCode}
                  </td>
                  <td className="py-3">
                    <span
                      className={`inline-block rounded-lg border px-2 py-0.5 font-semibold ${
                        entry.fallbackUsed
                          ? "border-accent-alert/40 bg-accent-alert/10 text-accent-alert"
                          : "border-accent-recovery/40 bg-accent-recovery/10 text-accent-recovery"
                      }`}
                    >
                      {entry.fallbackUsed ? "fallback" : entry.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section
        aria-label="Generador y vista previa del widget iOS Scriptable"
        className="rounded-2xl border border-border-subtle bg-surface p-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle pb-4">
          <div>
            <h2 className="text-base font-semibold text-ink-primary">
              Widget iOS Scriptable (`/api/scriptable`) · AMOLED Pure Black
            </h2>
            <p className="mt-0.5 text-xs text-ink-secondary tabular-nums">
              Tema `{scriptablePayload.theme}` · Cache SWR{" "}
              {scriptablePayload.ttlSeconds} s (15 min) · Paleta{" "}
              {scriptablePayload.palette.background}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void handleRefreshScriptable()}
              disabled={refreshingScriptable}
              className={`${BUTTON_BASE} ${BUTTON_IDLE}`}
            >
              {refreshingScriptable ? "Actualizando..." : "Actualizar Payload"}
            </button>
            <button
              type="button"
              onClick={() => void handleCopyScriptable()}
              className={`${BUTTON_BASE} ${BUTTON_ACTIVE}`}
            >
              Copiar Script iOS
            </button>
          </div>
        </div>

        <p
          aria-live="polite"
          className="mt-2 min-h-5 text-xs text-accent-recovery tabular-nums"
        >
          {scriptableAnnouncement}
        </p>

        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <div className="rounded-xl border border-accent-recovery/40 bg-void p-3">
            <p className="text-xs text-ink-secondary">Readiness ONNX</p>
            <p className="mt-1 text-xl font-semibold text-accent-recovery tabular-nums">
              {scriptablePayload.metrics.readinessScore.toFixed(1)}
            </p>
            <p className="text-xs text-ink-secondary">
              {scriptablePayload.metrics.readinessLabel}
            </p>
          </div>

          <div className="rounded-xl border border-accent-strain/40 bg-void p-3">
            <p className="text-xs text-ink-secondary">Strain Score</p>
            <p className="mt-1 text-xl font-semibold text-accent-strain tabular-nums">
              {scriptablePayload.metrics.strainScore.toFixed(1)}
            </p>
            <p className="text-xs text-ink-secondary tabular-nums">
              Sueno {scriptablePayload.metrics.sleepScore}
            </p>
          </div>

          <div className="rounded-xl border border-border-subtle bg-void p-3">
            <p className="text-xs text-ink-secondary">ACWR</p>
            <p className="mt-1 text-xl font-semibold text-ink-primary tabular-nums">
              {scriptablePayload.metrics.acwr.toFixed(2)}
            </p>
            <p className="text-xs text-ink-secondary">Ratio agudo/cronico</p>
          </div>

          <div className="rounded-xl border border-border-subtle bg-void p-3">
            <p className="text-xs text-ink-secondary">Tonelaje Semanal</p>
            <p className="mt-1 text-xl font-semibold text-ink-primary tabular-nums">
              {scriptablePayload.metrics.weeklyTonnageKg} kg
            </p>
            <p className="text-xs text-ink-secondary tabular-nums">
              Peso {scriptablePayload.metrics.latestWeightKg.toFixed(1)} kg
            </p>
          </div>

          <div className="rounded-xl border border-border-subtle bg-void p-3">
            <p className="text-xs text-ink-secondary">Clima Campamento</p>
            <p className="mt-1 text-xl font-semibold text-ink-primary tabular-nums">
              {scriptablePayload.metrics.weatherTempC.toFixed(1)} C
            </p>
            <p className="text-xs text-ink-secondary">
              {scriptablePayload.metrics.weatherCondition}
            </p>
          </div>

          <div className="rounded-xl border border-border-subtle bg-void p-3">
            <p className="text-xs text-ink-secondary">Cache SWR TTL</p>
            <p className="mt-1 text-xl font-semibold text-accent-alert tabular-nums">
              {scriptablePayload.ttlSeconds} s
            </p>
            <p className="text-xs text-ink-secondary tabular-nums">
              15 min · {scriptablePayload.metrics.routerLatencyMs} ms
            </p>
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-border-subtle bg-void p-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-secondary">
            Explicabilidad SHAP (`shapSummary`)
          </p>
          <p className="mt-1 font-mono text-xs text-ink-primary tabular-nums">
            {scriptablePayload.shapSummary}
          </p>
        </div>

        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-secondary">
            Codigo Fuente Scriptable iOS (`payload.scriptableCode`)
          </p>
          <pre className="mt-2 max-h-72 overflow-x-auto rounded-xl border border-border-subtle bg-void p-4 font-mono text-xs text-ink-primary tabular-nums">
            <code>{scriptablePayload.scriptableCode}</code>
          </pre>
        </div>
      </section>
    </div>
  );
}
