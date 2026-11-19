import type {
  AiProviderId,
  AiTelemetryLogEntry,
  ProviderQuotaStatus,
} from "./types";

interface ActorTelemetryState {
  logs: AiTelemetryLogEntry[];
}

interface ProviderSpec {
  provider: AiProviderId;
  label: string;
  defaultModel: string;
  tokenBudget: number;
}

const DEFAULT_ACTOR_KEY = "local-owner";
const ACTOR_KEY_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
export const MAX_ACTORS = 200;
export const MAX_LOGS_PER_ACTOR = 200;

export const AI_TELEMETRY_INSERT_SQL =
  "INSERT INTO ai_telemetry_logs (user_id, request_id, provider, model_name, latency_ms, tokens_in, tokens_out, status, fallback_used, status_code) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (request_id) DO NOTHING";

const PROVIDER_SPECS: readonly ProviderSpec[] = [
  {
    provider: "workers_ai",
    label: "Cloudflare Workers AI",
    defaultModel: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    tokenBudget: 10000,
  },
  {
    provider: "nim",
    label: "NVIDIA NIM",
    defaultModel: "nvidia/nemotron-3-ultra-550b-a55b",
    tokenBudget: 10000,
  },
  {
    provider: "gemini",
    label: "Google AI Studio",
    defaultModel: "gemini-2.5-flash-lite",
    tokenBudget: 10000,
  },
  {
    provider: "openrouter",
    label: "OpenRouter :free",
    defaultModel: "openrouter/free",
    tokenBudget: 10000,
  },
  {
    provider: "onnx_local",
    label: "ONNX Local",
    defaultModel: "pulsetrack-readiness-mlp-v1.onnx",
    tokenBudget: 10000,
  },
];

const SEED_LOGS: readonly AiTelemetryLogEntry[] = [
  {
    id: "00000000-0000-4000-8000-000000000401",
    requestId: "00000000-0000-4000-8000-000000000501",
    provider: "onnx_local",
    modelName: "pulsetrack-readiness-mlp-v1.onnx",
    taskKind: "biometric_reasoning",
    latencyMs: 1,
    tokensIn: 14,
    tokensOut: 6,
    status: "ok",
    fallbackUsed: false,
    statusCode: 200,
    createdAt: "2026-11-18T11:40:00.000Z",
  },
  {
    id: "00000000-0000-4000-8000-000000000402",
    requestId: "00000000-0000-4000-8000-000000000502",
    provider: "openrouter",
    modelName: "openrouter/free",
    taskKind: "tactical_summary",
    latencyMs: 410,
    tokensIn: 310,
    tokensOut: 145,
    status: "fallback",
    fallbackUsed: true,
    statusCode: 200,
    createdAt: "2026-11-18T11:45:00.000Z",
  },
  {
    id: "00000000-0000-4000-8000-000000000403",
    requestId: "00000000-0000-4000-8000-000000000503",
    provider: "gemini",
    modelName: "gemini-2.5-flash-lite",
    taskKind: "multimodal_vision",
    latencyMs: 265,
    tokensIn: 520,
    tokensOut: 180,
    status: "ok",
    fallbackUsed: false,
    statusCode: 200,
    createdAt: "2026-11-18T11:50:00.000Z",
  },
  {
    id: "00000000-0000-4000-8000-000000000404",
    requestId: "00000000-0000-4000-8000-000000000504",
    provider: "workers_ai",
    modelName: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    taskKind: "tactical_summary",
    latencyMs: 142,
    tokensIn: 280,
    tokensOut: 112,
    status: "ok",
    fallbackUsed: false,
    statusCode: 200,
    createdAt: "2026-11-18T11:55:00.000Z",
  },
  {
    id: "00000000-0000-4000-8000-000000000405",
    requestId: "00000000-0000-4000-8000-000000000505",
    provider: "nim",
    modelName: "nvidia/nemotron-3-ultra-550b-a55b",
    taskKind: "biometric_reasoning",
    latencyMs: 318,
    tokensIn: 640,
    tokensOut: 260,
    status: "ok",
    fallbackUsed: false,
    statusCode: 200,
    createdAt: "2026-11-18T12:00:00.000Z",
  },
  {
    id: "00000000-0000-4000-8000-000000000406",
    requestId: "00000000-0000-4000-8000-000000000506",
    provider: "workers_ai",
    modelName: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    taskKind: "tactical_summary",
    latencyMs: 128,
    tokensIn: 295,
    tokensOut: 124,
    status: "ok",
    fallbackUsed: false,
    statusCode: 200,
    createdAt: "2026-11-18T12:05:00.000Z",
  },
];

const actorStates = new Map<string, ActorTelemetryState>();

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  const index = clamp(
    Math.ceil((p / 100) * sorted.length) - 1,
    0,
    sorted.length - 1,
  );
  return Math.round(sorted[index] ?? 0);
}

function ensureActorState(actorKey: string): ActorTelemetryState {
  const existing = actorStates.get(actorKey);
  if (existing) {
    actorStates.delete(actorKey);
    actorStates.set(actorKey, existing);
    return existing;
  }

  const state: ActorTelemetryState = {
    logs: SEED_LOGS.map((entry) => ({ ...entry })),
  };
  actorStates.set(actorKey, state);

  while (actorStates.size > MAX_ACTORS) {
    const oldest = actorStates.keys().next();
    if (oldest.done) {
      break;
    }
    actorStates.delete(oldest.value);
  }

  return state;
}

export function resolveActorKey(request: Request): string {
  const headerUser = request.headers.get("x-user-id")?.trim();
  if (headerUser && ACTOR_KEY_PATTERN.test(headerUser)) {
    return headerUser;
  }
  return DEFAULT_ACTOR_KEY;
}

export function listTelemetryLogs(actorKey: string): AiTelemetryLogEntry[] {
  const state = ensureActorState(actorKey);
  return [...state.logs].reverse();
}

export function appendTelemetryLog(
  actorKey: string,
  entry: AiTelemetryLogEntry,
): AiTelemetryLogEntry {
  const state = ensureActorState(actorKey);
  const existingIndex = state.logs.findIndex(
    (item) => item.requestId === entry.requestId,
  );
  if (existingIndex >= 0) {
    const existing = state.logs[existingIndex];
    if (existing) {
      return existing;
    }
  }

  const stored: AiTelemetryLogEntry = { ...entry };
  state.logs.push(stored);
  while (state.logs.length > MAX_LOGS_PER_ACTOR) {
    state.logs.shift();
  }
  return stored;
}

export function getProviderQuotaStatuses(
  actorKey: string,
): ProviderQuotaStatus[] {
  const state = ensureActorState(actorKey);

  return PROVIDER_SPECS.map((spec) => {
    const entries = state.logs.filter(
      (entry) => entry.provider === spec.provider,
    );
    const requestsCount = entries.length;
    const latencies = entries
      .map((entry) => entry.latencyMs)
      .sort((a, b) => a - b);
    const p50LatencyMs = percentile(latencies, 50);
    const p95LatencyMs = percentile(latencies, 95);
    const okCount = entries.filter(
      (entry) =>
        (entry.status === "ok" || entry.status === "fallback") &&
        entry.statusCode >= 200 &&
        entry.statusCode < 300,
    ).length;
    const successRatePct =
      requestsCount > 0 ? roundTo((okCount / requestsCount) * 100, 1) : 100;
    const tokensTotal = entries.reduce(
      (sum, entry) => sum + entry.tokensIn + entry.tokensOut,
      0,
    );
    const quotaUsedPct = clamp(
      roundTo((tokensTotal / spec.tokenBudget) * 100, 1),
      0,
      100,
    );

    const latestForProvider = entries[entries.length - 1];
    let providerState: "healthy" | "degraded" | "fallback" = "healthy";
    if (
      successRatePct < 80 ||
      latestForProvider?.status === "error" ||
      latestForProvider?.status === "timeout"
    ) {
      providerState = "degraded";
    } else if (
      spec.provider === "openrouter" ||
      latestForProvider?.status === "fallback" ||
      latestForProvider?.fallbackUsed === true
    ) {
      providerState = "fallback";
    }

    return {
      provider: spec.provider,
      label: spec.label,
      defaultModel: spec.defaultModel,
      p50LatencyMs,
      p95LatencyMs,
      successRatePct,
      requestsCount,
      tokensTotal,
      quotaUsedPct,
      state: providerState,
    };
  });
}

export function getLatestTelemetryLog(
  actorKey: string,
): AiTelemetryLogEntry | null {
  const state = ensureActorState(actorKey);
  return state.logs[state.logs.length - 1] ?? null;
}

export function resetTelemetryStore(): void {
  actorStates.clear();
}

export function countTelemetryActors(): number {
  return actorStates.size;
}
