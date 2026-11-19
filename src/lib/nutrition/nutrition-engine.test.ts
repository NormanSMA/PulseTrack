import { beforeEach, describe, expect, it } from "vitest";
import {
  analyzeMealVision,
  appendNutritionLog,
  computeNetEnergyBalance,
  cosineSimilarity768,
  EMBEDDING_DIM,
  embedFoodText768,
  getPassiveNocturnalBiometrics,
  listNutritionLogs,
  MAX_ACTORS,
  MAX_LOGS_PER_ACTOR,
  PORTION_TEMPLATES,
  resetNutritionStore,
  searchPortionTemplates,
  toPgVectorLiteral,
} from "./nutrition-engine";

beforeEach(resetNutritionStore);

describe("Nutricion pgvector", () => {
  it("genera 768 componentes deterministas", () => {
    const vector = embedFoodText768("Pollo con arroz");
    expect(vector).toHaveLength(EMBEDDING_DIM);
    expect(vector).toEqual(embedFoodText768("Pollo con arroz"));
    expect(vector).not.toEqual(embedFoodText768("Agua isotonica"));
  });

  it.each(["avena proteica", "hidratación de montaña", "xyzzy", ""])(
    "normaliza el vector de %j a norma L2 unitaria",
    (query) => {
      const squaredNorm = embedFoodText768(query).reduce((sum, value) => sum + value ** 2, 0);
      expect(Math.sqrt(squaredNorm)).toBeCloseTo(1, 12);
    },
  );

  it("acerca arroz con pollo y separa hidratacion", () => {
    const query = embedFoodText768("pollo con arroz");
    const rice = cosineSimilarity768(query, embedFoodText768("Arroz con pollo y aguacate"));
    const water = cosineSimilarity768(query, embedFoodText768("Hidratacion isotonica"));
    expect(rice).toBeGreaterThan(0.65);
    expect(rice).toBeGreaterThan(water);
  });

  it("unifica sinonimos, tildes y cambios de orden", () => {
    const spanish = embedFoodText768("arroz con pollo y aguacate");
    expect(embedFoodText768("rice chicken avocado")).toEqual(spanish);
    expect(cosineSimilarity768(spanish, embedFoodText768("chicken rice avocado"))).toBeGreaterThan(0.95);
    expect(embedFoodText768("salmón")).toEqual(embedFoodText768("salmon"));
  });

  it("ordena las seis plantillas y respeta el limite", () => {
    expect(PORTION_TEMPLATES).toHaveLength(6);
    const ranked = searchPortionTemplates("camote con salmon", 3);
    expect(ranked).toHaveLength(3);
    expect(ranked[0]?.id).toBe("salmon-camote");
    expect(ranked.map(({ similarity }) => similarity)).toEqual(
      ranked.map(({ similarity }) => similarity).sort((a, b) => b - a),
    );
    expect(searchPortionTemplates("arroz", 0)).toEqual([]);
  });

  it("serializa un literal pgvector con 768 numeros finitos", () => {
    const vector = embedFoodText768("pollo con arroz");
    const literal = toPgVectorLiteral(vector);
    const values = literal.slice(1, -1).split(",").map(Number);
    expect(literal).toMatch(/^\[.+\]$/);
    expect(values).toHaveLength(768);
    expect(values.every(Number.isFinite)).toBe(true);
    expect(cosineSimilarity768(values, vector)).toBeCloseTo(1, 10);
    expect(() => toPgVectorLiteral([0])).toThrow(RangeError);
  });

  it("estima una porcion desde la descripcion y escala los macros", () => {
    const log = analyzeMealVision({ description: "pollo con arroz", mealSlot: "cena", portionMultiplier: 1.5 });
    expect(log).toMatchObject({
      templateId: "arroz-pollo-aguacate", mealSlot: "cena", portionMultiplier: 1.5,
      kcal: 847.5, proteinG: 63, carbsG: 84, fatG: 28.5, source: "pulsetrack",
    });
    expect(log.embeddingPreview).toEqual(embedFoodText768("pollo con arroz").slice(0, 6));
    expect(log.vectorSqlLiteral).toBe(toPgVectorLiteral(embedFoodText768("pollo con arroz")));
  });

  it("acota el multiplicador del motor y usa el horario de la plantilla", () => {
    expect(analyzeMealVision({ description: "avena", portionMultiplier: 0 }).portionMultiplier).toBe(0.25);
    const log = analyzeMealVision({ description: "batido whey banano", portionMultiplier: 5 });
    expect(log).toMatchObject({ mealSlot: "snack", portionMultiplier: 4, proteinG: 100 });
  });

  it("suma macros y resta el gasto basal y activo", () => {
    const logs = ["Arroz con pollo y aguacate", "Batido whey con banano"]
      .map((description) => analyzeMealVision({ description }));
    expect(computeNetEnergyBalance(logs, 1800, 700)).toEqual({
      kcalIn: 849, garminBasalKcal: 1800, garminActiveKcal: 700, garminTotalOutKcal: 2500,
      netBalanceKcal: -1651, proteinTotalG: 67, carbsTotalG: 93, fatTotalG: 23,
    });
    expect(computeNetEnergyBalance([]).netBalanceKcal).toBe(-2420);
  });

  it("devuelve siete muestras nocturnas en segundos", () => {
    const series = getPassiveNocturnalBiometrics();
    expect(series).toEqual(getPassiveNocturnalBiometrics());
    expect(Object.values(series).every((values) => values.length === 7)).toBe(true);
    expect(series.timestampsSec[6]! - series.timestampsSec[0]!).toBe(6 * 86400);
    expect(Math.min(...series.campTempCSeries)).toBe(21.4);
    expect(Math.max(...series.campTempCSeries)).toBe(27.4);
    expect(Math.min(...series.campPressureHpaSeries)).toBe(912);
    expect(Math.max(...series.campPressureHpaSeries)).toBe(918);
  });

  it("conserva los ultimos 200 registros por actor", () => {
    const log = analyzeMealVision({ description: "avena" });
    for (let i = 0; i <= MAX_LOGS_PER_ACTOR; i += 1) {
      appendNutritionLog("user_a", { ...log, id: String(i) });
    }
    const logs = listNutritionLogs("user_a");
    expect(logs).toHaveLength(200);
    expect(logs[0]?.id).toBe(String(MAX_LOGS_PER_ACTOR));
    expect(logs.at(-1)?.id).toBe("1");
    expect(listNutritionLogs("user_b")).toEqual([]);
  });

  it("expulsa al actor menos reciente al superar 200 actores", () => {
    const log = analyzeMealVision({ description: "avena" });
    for (let i = 0; i < MAX_ACTORS; i += 1) appendNutritionLog(`actor-${i}`, log);
    expect(listNutritionLogs("actor-0")).toEqual([log]);
    appendNutritionLog("actor-final", log);
    expect(listNutritionLogs("actor-1")).toEqual([]);
    expect(listNutritionLogs("actor-0")).toEqual([log]);
    expect(listNutritionLogs("actor-final")).toEqual([log]);
    resetNutritionStore();
    expect(listNutritionLogs("actor-final")).toEqual([]);
  });
});
