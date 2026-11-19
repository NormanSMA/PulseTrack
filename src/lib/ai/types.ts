export type AiProviderId =
  | "onnx_local"
  | "workers_ai"
  | "nim"
  | "gemini"
  | "openrouter";

export type AiCloudProviderId = Exclude<AiProviderId, "onnx_local">;

export type AiTaskKind =
  | "tactical_summary"
  | "biometric_reasoning"
  | "multimodal_vision";

export type AiTelemetryStatus = "ok" | "fallback" | "error" | "timeout";

export interface AiAttemptRecord {
  provider: AiCloudProviderId;
  modelName: string;
  latencyMs: number;
  statusCode: number;
  ok: boolean;
  errorReason: string | null;
}

export interface AiTelemetryLogEntry {
  id: string;
  requestId: string;
  provider: AiProviderId;
  modelName: string;
  taskKind: AiTaskKind;
  latencyMs: number;
  tokensIn: number;
  tokensOut: number;
  status: AiTelemetryStatus;
  fallbackUsed: boolean;
  statusCode: number;
  createdAt: string;
}

export interface AiRouteRequest {
  taskKind: AiTaskKind;
  prompt: string;
  userId?: string;
  timeoutMs?: number;
  simulateFailureProviders?: readonly AiCloudProviderId[];
  nimModelOverride?: string;
}

export interface AiRouteResult {
  requestId: string;
  taskKind: AiTaskKind;
  provider: AiCloudProviderId;
  modelName: string;
  outputText: string;
  latencyMs: number;
  tokensIn: number;
  tokensOut: number;
  fallbackUsed: boolean;
  statusCode: number;
  attempts: AiAttemptRecord[];
  telemetry: AiTelemetryLogEntry;
}

export interface AiProviderTransportRequest {
  provider: AiCloudProviderId;
  modelName: string;
  taskKind: AiTaskKind;
  prompt: string;
  timeoutMs: number;
  signal: AbortSignal;
}

export interface AiProviderTransportResponse {
  ok: boolean;
  statusCode: number;
  outputText: string;
  tokensIn: number;
  tokensOut: number;
  errorReason?: string;
}

export type AiProviderTransport = (
  request: AiProviderTransportRequest,
) => Promise<AiProviderTransportResponse>;

export interface ProviderQuotaStatus {
  provider: AiProviderId;
  label: string;
  defaultModel: string;
  p50LatencyMs: number;
  p95LatencyMs: number;
  successRatePct: number;
  requestsCount: number;
  tokensTotal: number;
  quotaUsedPct: number;
  state: "healthy" | "degraded" | "fallback";
}

export interface ScriptableWidgetMetrics {
  readinessScore: number;
  readinessLabel: "Optimo" | "Moderado" | "Carga Alta";
  strainScore: number;
  acwr: number;
  sleepScore: number;
  weeklyTonnageKg: number;
  latestWeightKg: number;
  weatherTempC: number;
  weatherCondition: string;
  activeProvider: AiProviderId;
  activeModel: string;
  routerLatencyMs: number;
  fallbackActive: boolean;
}

export interface ScriptableWidgetPayload {
  version: "1.0";
  theme: "amoled-pure-black";
  ttlSeconds: 900;
  generatedAt: string;
  palette: {
    background: "#000000";
    surface: "#0A0A0A";
    border: "#1F1F1F";
    textPrimary: "#FFFFFF";
    textSecondary: "#A3A3A3";
    accentRecovery: "#10B981";
    accentStrain: "#3B82F6";
    accentSleep: "#8B5CF6";
    accentAlert: "#F59E0B";
  };
  metrics: ScriptableWidgetMetrics;
  shapSummary: string;
  scriptableCode: string;
}
