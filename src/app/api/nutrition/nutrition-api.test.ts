import { beforeEach, describe, expect, it } from "vitest";
import { GET as predictGet, POST as predictPost } from "@/app/api/ai/predict/route";
import { ONNX_MODEL_METADATA } from "@/lib/ai/onnx-readiness";
import { PORTION_TEMPLATES, resetNutritionStore } from "@/lib/nutrition/nutrition-engine";
import { GET as nutritionGet, POST as nutritionPost } from "./route";

const nutritionUrl = "http://localhost/api/nutrition";
const predictUrl = "http://localhost/api/ai/predict";

function get(url: string, actor = "user_a"): Request {
  return new Request(url, { headers: { "x-user-id": actor } });
}

function post(url: string, body: unknown, actor = "user_a"): Request {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-user-id": actor },
    body: JSON.stringify(body),
  });
}

function postRaw(url: string, body: string): Request {
  return new Request(url, { method: "POST", body });
}

beforeEach(resetNutritionStore);

describe("/api/nutrition", () => {
  it("devuelve plantillas, balance, series nocturnas y SQL parametrizado", async () => {
    const response = await nutritionGet(get(nutritionUrl));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      ok: true, logs: [], templates: PORTION_TEMPLATES, matches: [],
      balance: { kcalIn: 0, garminTotalOutKcal: 2420 },
      nocturnal: { campTempCSeries: [21.4, 22.1, 24.2, 27.4, 25.2, 22.8, 22.3] },
      sqlPreview: expect.stringContaining("embedding <=> $1::vector(768)"),
    });
  });

  it("busca por coseno con q", async () => {
    const response = await nutritionGet(get(`${nutritionUrl}?q=pollo+con+arroz`));
    expect(await response.json()).toMatchObject({
      matches: [expect.objectContaining({ id: "arroz-pollo-aguacate" }), expect.anything(), expect.anything(), expect.anything()],
    });
  });

  it("crea y guarda el registro de un clic por actor", async () => {
    const template = PORTION_TEMPLATES[0];
    const response = await nutritionPost(post(nutritionUrl, { templateId: template.id, portionMultiplier: 2 }));
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      ok: true,
      log: { templateId: template.id, kcal: 2 * template.kcal, mealSlot: "desayuno" },
      balance: { kcalIn: 2 * template.kcal },
      sqlPreview: expect.stringContaining("INSERT INTO nutrition_logs"),
    });
    expect(await nutritionGet(get(nutritionUrl)).json()).toMatchObject({
      logs: [expect.objectContaining({ foodName: template.name })],
    });
    expect(await nutritionGet(get(nutritionUrl, "user_b")).json()).toMatchObject({ logs: [] });
  });

  it("crea el registro desde la descripcion de comida", async () => {
    const response = await nutritionPost(post(nutritionUrl, {
      description: "Camote con salmon", mealSlot: "almuerzo", portionMultiplier: 0.5, source: "pulsetrack",
    }));
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      log: {
        templateId: "salmon-camote", mealSlot: "almuerzo", kcal: 237.5, source: "pulsetrack",
        vectorSqlLiteral: expect.stringMatching(/^\[.*\]$/),
      },
      logs: [expect.objectContaining({ templateId: "salmon-camote" })],
    });
  });

  it.each([
    {}, { templateId: "desconocida" }, { description: "  " }, { description: 4 },
    { description: "arroz", mealSlot: "brunch" }, { description: "arroz", portionMultiplier: 0.2 },
    { description: "arroz", portionMultiplier: 4.1 }, { description: "arroz", portionMultiplier: "2" },
  ])("rechaza un registro invalido %j", async (body) => {
    const response = await nutritionPost(post(nutritionUrl, body));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ ok: false });
  });

  it("rechaza POST con JSON roto", async () => {
    expect((await nutritionPost(postRaw(nutritionUrl, "{"))).status).toBe(400);
  });

  it("rechaza Apple Health de GET y POST antes de otras validaciones", async () => {
    const query = `${nutritionUrl}?source=pulsetrack&source=Apple-Health`;
    const responses = [
      await nutritionGet(get(query)),
      await nutritionPost(postRaw(query, "{")),
      await nutritionPost(post(nutritionUrl, { source: "apple_health" })),
    ];
    for (const response of responses) {
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ ok: false, error: expect.stringContaining("ADR-001") });
    }
    expect(await nutritionGet(get(nutritionUrl)).json()).toMatchObject({ logs: [] });
  });
});

describe("/api/ai/predict", () => {
  it("devuelve la simulacion saludable y SQL sin cache", async () => {
    const response = await predictGet(get(predictUrl));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      ok: true, model: ONNX_MODEL_METADATA,
      simulation: { readinessScore: 80, readinessLabel: "Optimo", anomaly: { isAnomaly: false } },
      sqlPreview: expect.stringContaining("ON CONFLICT (user_id, target_date, model_version)"),
    });
  });

  it("mezcla sliders parciales y devuelve la explicacion SHAP", async () => {
    const response = await predictPost(post(predictUrl, {
      sliders: { sleepTempC: 27.4 }, source: "pulsetrack",
    }));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      model: ONNX_MODEL_METADATA,
      simulation: {
        readinessLabel: "Moderado",
        anomaly: { isAnomaly: true },
        shap: { naturalLanguageSummary: expect.stringContaining("temperatura nocturna alta de 27.4 C") },
      },
    });
  });

  it("acepta un objeto de sliders vacio", async () => {
    const response = await predictPost(post(predictUrl, { sliders: {} }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ simulation: { readinessScore: 80 } });
  });

  it.each([
    {}, [], { sliders: [] }, { sliders: { sleepHours: "8" } }, { sliders: { sleepHours: -1 } },
    { sliders: { plannedTrailKm: 101 } }, { sliders: { hydrationLiters: null } },
    { sliders: { ignored: 2 } }, { sliders: {}, source: 5 },
  ])("rechaza sliders invalidos %j", async (body) => {
    expect((await predictPost(post(predictUrl, body))).status).toBe(400);
  });

  it("rechaza valores no finitos aun cuando el JSON es valido", async () => {
    const response = await predictPost(postRaw(predictUrl, '{"sliders":{"sleepHours":1e999}}'));
    expect(response.status).toBe(400);
  });

  it("rechaza Apple Health en GET, POST, alias y parametros repetidos", async () => {
    const query = `${predictUrl}?source=garmin&source=apple_health`;
    const responses = [
      await predictGet(get(query)),
      await predictPost(postRaw(query, "{")),
      await predictPost(post(predictUrl, { sliders: [], source: " healthkit " })),
    ];
    for (const response of responses) {
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ ok: false, error: expect.stringContaining("ADR-001") });
    }
  });
});
