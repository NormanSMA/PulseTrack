import { beforeEach, describe, expect, it } from "vitest";
import { GET as getAiRoute, POST as postAiRoute } from "@/app/api/ai/route/route";
import { GET as getScriptable } from "@/app/api/scriptable/route";
import { VALIDATED_NIM_DEFAULT_MODEL } from "@/lib/ai/cloud-router";
import { resetTelemetryStore } from "@/lib/ai/telemetry-store";
import type {
  AiRouteResult,
  AiTelemetryLogEntry,
  ProviderQuotaStatus,
  ScriptableWidgetPayload,
} from "@/lib/ai/types";

interface AiRouteGetBody {
  ok: boolean;
  logs: AiTelemetryLogEntry[];
  providers: ProviderQuotaStatus[];
  activeModels: Record<string, string>;
}

interface AiRoutePostBody {
  ok: boolean;
  result: AiRouteResult;
  logs: AiTelemetryLogEntry[];
  providers: ProviderQuotaStatus[];
  sqlPreview: string;
}

interface ScriptableGetBody {
  ok: boolean;
  payload: ScriptableWidgetPayload;
}

describe("Integracion real /api/ai/route + /api/scriptable + cloud-router", () => {
  beforeEach(() => {
    resetTelemetryStore();
  });

  it("enruta en modo primario y en failover real actualizando telemetria y widget Scriptable", async () => {
    const initialRes = await getAiRoute(
      new Request("http://localhost/api/ai/route", { headers: { "x-user-id": "actor-int" } }),
    );
    expect(initialRes.status).toBe(200);
    const initialBody = (await initialRes.json()) as AiRouteGetBody;
    expect(initialBody.ok).toBe(true);
    expect(initialBody.activeModels.nim).toBe(VALIDATED_NIM_DEFAULT_MODEL);
    const initialCount = initialBody.logs.length;

    const postFailoverRes = await postAiRoute(
      new Request("http://localhost/api/ai/route", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-user-id": "actor-int",
        },
        body: JSON.stringify({
          taskKind: "tactical_summary",
          prompt: "Analiza mi recuperacion tras caminata de 12 km y sesion de fuerza.",
          simulateFailureProviders: ["workers_ai"],
          nimModelOverride: "nvidia/nemotron-3-super-120b-a12b",
        }),
      }),
    );
    expect(postFailoverRes.status).toBe(200);
    const failoverBody = (await postFailoverRes.json()) as AiRoutePostBody;
    expect(failoverBody.ok).toBe(true);
    expect(failoverBody.result.provider).toBe("nim");
    expect(failoverBody.result.modelName).toBe(VALIDATED_NIM_DEFAULT_MODEL);
    expect(failoverBody.result.fallbackUsed).toBe(true);
    expect(failoverBody.result.attempts).toHaveLength(2);
    expect(failoverBody.result.attempts[0]?.provider).toBe("workers_ai");
    expect(failoverBody.result.attempts[0]?.ok).toBe(false);
    expect(failoverBody.result.attempts[1]?.provider).toBe("nim");
    expect(failoverBody.result.attempts[1]?.ok).toBe(true);
    expect(failoverBody.logs.length).toBe(initialCount + 1);
    expect(failoverBody.sqlPreview).toContain("INSERT INTO ai_telemetry_logs");

    const scriptableRes = await getScriptable(
      new Request("http://localhost/api/scriptable", { headers: { "x-user-id": "actor-int" } }),
    );
    expect(scriptableRes.status).toBe(200);
    expect(scriptableRes.headers.get("cache-control")).toContain("max-age=900");
    expect(scriptableRes.headers.get("x-pulsetrack-cache-ttl")).toBe("900");
    const scriptableBody = (await scriptableRes.json()) as ScriptableGetBody;
    expect(scriptableBody.ok).toBe(true);
    expect(scriptableBody.payload.theme).toBe("amoled-pure-black");
    expect(scriptableBody.payload.palette.background).toBe("#000000");
    expect(scriptableBody.payload.ttlSeconds).toBe(900);
    expect(scriptableBody.payload.metrics.activeProvider).toBe("nim");
    expect(scriptableBody.payload.metrics.activeModel).toBe(VALIDATED_NIM_DEFAULT_MODEL);
    expect(scriptableBody.payload.metrics.fallbackActive).toBe(true);
    expect(scriptableBody.payload.scriptableCode).toContain("ListWidget");
    expect(scriptableBody.payload.scriptableCode).toContain("#000000");
  });

  it("conmuta hasta openrouter/free cuando caen workers_ai, nim y gemini y bloquea apple_health con 403", async () => {
    const deepFailoverRes = await postAiRoute(
      new Request("http://localhost/api/ai/route", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          taskKind: "biometric_reasoning",
          prompt: "Evalua riesgo de sobreentrenamiento con ACWR 1.42 y VFC en descenso.",
          simulateFailureProviders: ["nim", "workers_ai", "gemini"],
        }),
      }),
    );
    expect(deepFailoverRes.status).toBe(200);
    const deepBody = (await deepFailoverRes.json()) as AiRoutePostBody;
    expect(deepBody.result.provider).toBe("openrouter");
    expect(deepBody.result.modelName).toBe("openrouter/free");
    expect(deepBody.result.fallbackUsed).toBe(true);
    expect(deepBody.result.attempts).toHaveLength(4);

    const appleGet = await getAiRoute(new Request("http://localhost/api/ai/route?source=apple_health"));
    expect(appleGet.status).toBe(403);
    const applePost = await postAiRoute(
      new Request("http://localhost/api/ai/route", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          taskKind: "tactical_summary",
          prompt: "Test",
          source: "apple_health",
        }),
      }),
    );
    expect(applePost.status).toBe(403);
    const appleScriptable = await getScriptable(
      new Request("http://localhost/api/scriptable?source=apple_health"),
    );
    expect(appleScriptable.status).toBe(403);
  });
});
