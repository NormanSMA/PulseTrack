import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import {
  buildScriptableWidgetPayload,
  createDeterministicFixtureTransport,
  generateScriptableIosCode,
  getProviderChain,
  isExcludedModel,
  resolveNimModel,
  routeAiRequest,
  VALIDATED_NIM_DEFAULT_MODEL,
} from "./cloud-router";
import type { AiCloudProviderId, AiProviderTransport, AiRouteRequest } from "./types";

const tacticalRequest: AiRouteRequest = {
  taskKind: "tactical_summary",
  prompt: "Sintetiza la carga y la recuperación.",
};

const openrouter = { provider: "openrouter", modelName: "openrouter/free" };
const workersFast = { provider: "workers_ai", modelName: "@cf/meta/llama-3.3-70b-instruct-fp8-fast" };
const gemini = { provider: "gemini", modelName: "gemini-2.5-flash-lite" };
const nim = { provider: "nim", modelName: "nvidia/nemotron-3-ultra-550b-a55b" };

describe("Modelos NIM", () => {
  it.each([
    "nvidia/nemotron-3-super",
    "nvidia/nemotron-3-super-120b-a12b",
    "google/gemma-4-31b-it",
    "gemma-4-31b",
    " NVIDIA/NEMOTRON-3-SUPER-experimental ",
    "vendor/GEMMA-4-31B-preview",
  ])("excluye %s en ambas fuentes de configuración", (model) => {
    expect(isExcludedModel(model)).toBe(true);
    expect(resolveNimModel(model, { NIM_PRIMARY_MODEL: "nvidia/alternativo" })).toBe(nim.modelName);
    expect(resolveNimModel(undefined, { NIM_PRIMARY_MODEL: model })).toBe(nim.modelName);
  });

  it("usa Nemotron Ultra cuando la configuración está vacía", () => {
    expect(VALIDATED_NIM_DEFAULT_MODEL).toBe(nim.modelName);
    expect(isExcludedModel(nim.modelName)).toBe(false);
    expect(resolveNimModel(" ", { NIM_PRIMARY_MODEL: " " })).toBe(nim.modelName);
  });

  it("resuelve el modelo de entorno y prioriza el override", () => {
    const env = { NIM_PRIMARY_MODEL: " nvidia/modelo-entorno " };
    expect(resolveNimModel(" ", env)).toBe("nvidia/modelo-entorno");
    expect(resolveNimModel(" nvidia/modelo-solicitud ", env)).toBe("nvidia/modelo-solicitud");
  });
});

describe("getProviderChain", () => {
  it("ordena los proveedores para el resumen táctico", () => {
    expect(getProviderChain("tactical_summary", { env: {} })).toEqual([workersFast, nim, gemini, openrouter]);
  });

  it("ordena los proveedores para el razonamiento biométrico", () => {
    expect(getProviderChain("biometric_reasoning", { env: {} })).toEqual([
      nim,
      { provider: "workers_ai", modelName: "@cf/qwen/qwen2.5-coder-32b-instruct" },
      gemini,
      openrouter,
    ]);
  });

  it("ordena los proveedores para la visión multimodal", () => {
    expect(getProviderChain("multimodal_vision", { env: {} })).toEqual([gemini, openrouter, workersFast]);
  });

  it("usa los modelos configurados para cada tarea", () => {
    const options = {
      env: {
        NIM_PRIMARY_MODEL: " nim-env ",
        WORKERS_AI_FAST_MODEL: " workers-fast ",
        WORKERS_AI_CODE_MODEL: " workers-code ",
        GEMINI_FAST_MODEL: " gemini-fast ",
        GEMINI_VISION_MODEL: " gemini-vision ",
        OPENROUTER_FALLBACK_MODEL: " openrouter-custom ",
      },
    };
    expect(getProviderChain("tactical_summary", options).map((step) => step.modelName))
      .toEqual(["workers-fast", "nim-env", "gemini-fast", "openrouter-custom"]);
    expect(getProviderChain("biometric_reasoning", { ...options, nimModelOverride: " nim-override " })
      .map((step) => step.modelName)).toEqual(["nim-override", "workers-code", "gemini-fast", "openrouter-custom"]);
    expect(getProviderChain("multimodal_vision", options).map((step) => step.modelName))
      .toEqual(["gemini-vision", "openrouter-custom", "workers-fast"]);
  });
});

describe("createDeterministicFixtureTransport", () => {
  it.each([
    ["tactical_summary", "Readiness"],
    ["biometric_reasoning", "balance energético"],
    ["multimodal_vision", "GAP"],
  ] as const)("genera una síntesis reproducible para %s", async (taskKind, metric) => {
    const transport = createDeterministicFixtureTransport();
    const request = {
      provider: "gemini",
      modelName: "modelo-fixture",
      taskKind,
      prompt: `  ${"a".repeat(41)}  `,
      timeoutMs: 4500,
      signal: new AbortController().signal,
    } as const;
    const response = await transport(request);
    expect(response).toMatchObject({ ok: true, statusCode: 200, tokensIn: 11 });
    expect(response.outputText).toContain(metric);
    expect(response.outputText).toContain("gemini/modelo-fixture");
    expect(response.tokensOut).toBe(Math.ceil(response.outputText.length / 4));
    expect(await transport(request)).toEqual(response);
  });

  it("devuelve timeout cuando la señal ya está abortada", async () => {
    const response = await createDeterministicFixtureTransport()({
      provider: "gemini",
      modelName: gemini.modelName,
      taskKind: tacticalRequest.taskKind,
      prompt: tacticalRequest.prompt,
      timeoutMs: 50,
      signal: AbortSignal.abort(),
    });
    expect(response).toEqual({
      ok: false, statusCode: 504, outputText: "", tokensIn: 0, tokensOut: 0, errorReason: "timeout",
    });
  });
});

describe("routeAiRequest", () => {
  const fixture = createDeterministicFixtureTransport();

  it("registra la telemetría del primer proveedor exitoso", async () => {
    const now = vi.fn().mockReturnValueOnce(100).mockReturnValueOnce(112.6);
    const uuid = vi.fn().mockReturnValueOnce("request-id").mockReturnValueOnce("telemetry-id");
    const createdAt = "2026-11-18T12:00:00.000Z";
    const result = await routeAiRequest(tacticalRequest, { env: {}, now, uuid, nowIso: () => createdAt });

    expect(result).toMatchObject({ ...workersFast, fallbackUsed: false, statusCode: 200, latencyMs: 13 });
    expect(result.attempts).toEqual([
      { ...workersFast, latencyMs: 13, statusCode: 200, ok: true, errorReason: null },
    ]);
    expect(result.telemetry).toEqual({
      ...workersFast,
      id: "telemetry-id",
      requestId: result.requestId,
      taskKind: "tactical_summary",
      latencyMs: 13,
      tokensIn: Math.ceil(tacticalRequest.prompt.length / 4),
      tokensOut: Math.ceil(result.outputText.length / 4),
      status: "ok",
      fallbackUsed: false,
      statusCode: 200,
      createdAt,
    });
    expect(result.requestId).toBe("request-id");
  });

  it.each([
    { failed: ["workers_ai"], expected: nim },
    { failed: ["workers_ai", "nim"], expected: gemini },
    { failed: ["workers_ai", "nim", "gemini"], expected: openrouter },
  ] satisfies Array<{ failed: AiCloudProviderId[]; expected: { provider: string; modelName: string } }>)
    ("conmuta tras simular la caída de $failed", async ({ failed, expected }) => {
      const transport = vi.fn(fixture);
      const result = await routeAiRequest({ ...tacticalRequest, simulateFailureProviders: failed }, { env: {}, transport });

      expect(result).toMatchObject({ ...expected, fallbackUsed: true, telemetry: { status: "fallback" } });
      expect(result.attempts).toHaveLength(failed.length + 1);
      expect(result.attempts.slice(0, -1)).toMatchObject(failed.map((provider) => ({
        provider, ok: false, latencyMs: 1, statusCode: 503, errorReason: "simulated_provider_outage",
      })));
      expect(transport).toHaveBeenCalledTimes(1);
    });

  it.each([500, 429])("conmuta al recibir HTTP %d", async (statusCode) => {
    const transport: AiProviderTransport = async (request) => ({
      ...await fixture(request),
      statusCode: request.provider === "workers_ai" ? statusCode : 200,
    });
    const result = await routeAiRequest(tacticalRequest, { env: {}, transport });

    expect(result).toMatchObject({ ...nim, fallbackUsed: true });
    expect(result.attempts[0]).toMatchObject({ statusCode, ok: false });
  });

  it("conmuta cuando el transporte informa un fallo con HTTP 200", async () => {
    const transport: AiProviderTransport = async (request) => ({
      ...await fixture(request),
      ok: request.provider !== "workers_ai",
      errorReason: "respuesta_inutilizable",
    });
    const result = await routeAiRequest(tacticalRequest, { env: {}, transport });

    expect(result).toMatchObject(nim);
    expect(result.attempts[0]).toMatchObject({ statusCode: 200, ok: false, errorReason: "respuesta_inutilizable" });
  });

  it("conmuta si el transporte lanza un error", async () => {
    const transport: AiProviderTransport = async (request) => {
      if (request.provider === "workers_ai") throw new Error("Conexión interrumpida");
      return fixture(request);
    };
    const result = await routeAiRequest(tacticalRequest, { env: {}, transport });

    expect(result).toMatchObject(nim);
    expect(result.attempts[0]).toMatchObject({ statusCode: 502, ok: false, errorReason: "transport_error" });
  });

  it("aborta el transporte al vencer el timeout real y continúa la cadena", async () => {
    const onAbort = vi.fn();
    const transport: AiProviderTransport = async (request) => {
      if (request.provider !== "workers_ai") return fixture(request);
      request.signal.addEventListener("abort", onAbort, { once: true });
      return new Promise(() => {});
    };
    const result = await routeAiRequest({ ...tacticalRequest, timeoutMs: 50 }, { env: {}, transport });

    expect(onAbort).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ ...nim, fallbackUsed: true, telemetry: { status: "fallback" } });
    expect(result.attempts[0]).toMatchObject({ statusCode: 504, ok: false, errorReason: "timeout" });
  });

  it("normaliza latencia y tokens para la telemetría", async () => {
    const now = vi.fn().mockReturnValueOnce(100).mockReturnValueOnce(95);
    const transport: AiProviderTransport = async (request) => ({
      ...await fixture(request), statusCode: 201, tokensIn: -2, tokensOut: Number.NaN,
    });
    const result = await routeAiRequest(tacticalRequest, { env: {}, now, transport });
    expect(result.telemetry).toMatchObject({ latencyMs: 0, tokensIn: 0, tokensOut: 0, statusCode: 201 });
  });

  it("lanza un error cuando falla toda la cadena", async () => {
    const failed = ["workers_ai", "nim", "gemini", "openrouter"] as const;
    await expect(routeAiRequest({ ...tacticalRequest, simulateFailureProviders: failed }, { env: {} }))
      .rejects.toThrow("Todos los proveedores IA fallaron en la cadena de conmutacion.");
  });

  it.each(["", " \n ", "a".repeat(4001)])("rechaza un prompt fuera de los límites (%#)", async (prompt) => {
    await expect(routeAiRequest({ ...tacticalRequest, prompt }, { env: {} })).rejects.toThrow(RangeError);
  });

  it.each([49, 30001, Number.NaN, Number.POSITIVE_INFINITY])("rechaza el timeout %s", async (timeoutMs) => {
    await expect(routeAiRequest({ ...tacticalRequest, timeoutMs }, { env: {} })).rejects.toThrow(RangeError);
  });

  it("acepta un prompt de 4000 caracteres y un timeout de 30000 ms", async () => {
    const result = await routeAiRequest({ ...tacticalRequest, prompt: "a".repeat(4000), timeoutMs: 30000 }, { env: {} });
    expect(result.tokensIn).toBe(1000);
  });
});

describe("Scriptable iOS", () => {
  it("construye el payload con la paleta AMOLED y TTL de 900 segundos", () => {
    const payload = buildScriptableWidgetPayload();
    expect(payload).toMatchObject({ version: "1.0", theme: "amoled-pure-black", ttlSeconds: 900 });
    expect(payload.palette).toEqual({
      background: "#000000", surface: "#0A0A0A", border: "#1F1F1F",
      textPrimary: "#FFFFFF", textSecondary: "#A3A3A3", accentRecovery: "#10B981",
      accentStrain: "#3B82F6", accentSleep: "#8B5CF6", accentAlert: "#F59E0B",
    });
    expect(payload.metrics.readinessScore).toBeGreaterThan(0);
    expect(payload.metrics.acwr).toBeGreaterThan(0);
    expect(payload.scriptableCode).toBe(generateScriptableIosCode());
  });

  it("aplica overrides de métricas y metadatos", () => {
    const endpointUrl = 'https://example.test/scriptable?name="widget"';
    const generatedAt = "2026-11-18T12:00:00.000Z";
    const shapSummary = "El sueño aporta a la recuperación.";
    const payload = buildScriptableWidgetPayload({
      endpointUrl, generatedAt, shapSummary, readinessScore: 72, weatherTempC: 0, fallbackActive: true,
    });
    expect(payload).toMatchObject({
      generatedAt, shapSummary, metrics: { readinessScore: 72, weatherTempC: 0, fallbackActive: true },
    });
    expect(payload.metrics).not.toHaveProperty("endpointUrl");
    expect(payload.scriptableCode).toContain(`const endpointUrl = ${JSON.stringify(endpointUrl)};`);
  });

  it("conserva los valores por defecto para overrides indefinidos", () => {
    const payload = buildScriptableWidgetPayload({ readinessScore: undefined, activeModel: undefined });
    expect(payload.metrics).toEqual(buildScriptableWidgetPayload().metrics);
  });

  it("genera el widget AMOLED con archivo local y fuente monoespaciada", () => {
    const code = generateScriptableIosCode();
    for (const fragment of [
      "https://pulsetrack.nsma.dev/api/scriptable", "new ListWidget()", "#000000", "FileManager.local()",
      "new Request(endpointUrl)", "regularMonospacedSystemFont", "Readiness", "Strain", "ACWR",
      "Tonelaje semanal", "Clima", "SHAP", "Script.setWidget(widget)",
    ]) {
      expect(code).toContain(fragment);
    }
  });

  it("reutiliza la caché fresca y muestra los datos guardados si falla la actualización", async () => {
    const payload = buildScriptableWidgetPayload({ readinessScore: 73 });
    let saved: string | undefined;
    let now = 10_000;
    const addText = vi.fn((_value: string) => ({}));
    const loadJSON = vi.fn().mockResolvedValueOnce(payload).mockRejectedValueOnce(new Error("Sin conexión"));
    const writeString = vi.fn((_path: string, value: string) => { saved = value; });
    const runtime = {
      Date: class extends Date { static now() { return now; } },
      FileManager: { local: () => ({
        documentsDirectory: () => "/documents",
        joinPath: (...segments: string[]) => segments.join("/"),
        fileExists: () => saved !== undefined,
        readString: () => saved,
        writeString,
      }) },
      ListWidget: class { addText = addText; },
      Color: class { constructor(readonly hex: string) {} },
      Font: { regularMonospacedSystemFont: (size: number) => size },
      Request: class { loadJSON = loadJSON; response = { statusCode: 200 }; },
      Script: { setWidget: vi.fn(), complete: vi.fn() },
    };
    const script = `(async () => {\n${payload.scriptableCode}\n})()`;

    await runInNewContext(script, runtime);
    expect(writeString).toHaveBeenCalledTimes(1);
    now += 899_999;
    await runInNewContext(script, runtime);
    expect(loadJSON).toHaveBeenCalledTimes(1);
    now += 1;
    addText.mockClear();
    await runInNewContext(script, runtime);
    expect(loadJSON).toHaveBeenCalledTimes(2);
    expect(writeString).toHaveBeenCalledTimes(1);
    expect(addText).toHaveBeenCalledWith("Readiness 73%");
    expect(runtime.Script.complete).toHaveBeenCalledTimes(3);
  });
});
