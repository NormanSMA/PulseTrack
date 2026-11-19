export const EMBEDDING_DIM = 768;
export const MAX_ACTORS = 200;
export const MAX_LOGS_PER_ACTOR = 200;

export type MealSlot = "desayuno" | "almuerzo" | "cena" | "snack";

interface Macros {
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

interface PortionTemplate extends Macros {
  id: string;
  name: string;
  mealSlot: MealSlot;
}

export interface NutritionLogItem extends Macros {
  id: string;
  loggedAt: string;
  description: string;
  foodName: string;
  templateId: string;
  mealSlot: MealSlot;
  portionMultiplier: number;
  source: "pulsetrack";
  similarity: number;
  embeddingPreview: number[];
  vectorSqlLiteral: string;
}

export const PORTION_TEMPLATES = [
  { id: "avena-proteica", name: "Avena proteica post-gym", mealSlot: "desayuno", kcal: 415, proteinG: 31, carbsG: 48, fatG: 11 },
  { id: "arroz-pollo-aguacate", name: "Arroz con pollo y aguacate", mealSlot: "almuerzo", kcal: 565, proteinG: 42, carbsG: 56, fatG: 19 },
  { id: "batido-whey-banano", name: "Batido whey con banano", mealSlot: "snack", kcal: 284, proteinG: 25, carbsG: 37, fatG: 4 },
  { id: "gallo-pinto", name: "Gallo pinto con huevos y queso", mealSlot: "desayuno", kcal: 505, proteinG: 24, carbsG: 55, fatG: 21 },
  { id: "salmon-camote", name: "Salmon con camote al horno", mealSlot: "cena", kcal: 475, proteinG: 34, carbsG: 35, fatG: 22 },
  { id: "hidratacion-isotonica", name: "Hidratacion isotonica de montana", mealSlot: "snack", kcal: 90, proteinG: 0, carbsG: 22, fatG: 0 },
] as const satisfies readonly [PortionTemplate, ...PortionTemplate[]];

const CONCEPTS = [
  "proteina proteica whey pollo pavo res salmon pescado atun huevo queso lacteo frijol",
  "carbohidrato avena arroz cereal pan tortilla pinto banano platano camote papa",
  "grasa aceite mantequilla nuez aguacate salmon huevo queso",
  "hidratacion agua isotonico electrolito bebida suero sodio",
  "fruta banano platano aguacate manzana fresa naranja",
  "grano arroz avena cereal trigo quinoa pinto pan tortilla",
  "lacteo leche queso yogur whey",
  "carne pollo pavo res cerdo",
  "pescado salmon atun trucha",
  "recuperacion gym whey batido proteina proteica",
  "senderismo montana trail electrolito isotonico",
  "legumbre frijol pinto lenteja garbanzo",
  "tuberculo camote papa yuca",
].map((concept) => new Set(concept.split(" ")));

const ALIASES = new Map([
  ["chicken", "pollo"], ["rice", "arroz"], ["oats", "avena"], ["avocado", "aguacate"],
  ["banana", "banano"], ["water", "agua"], ["batata", "camote"],
  ["isotonica", "isotonico"], ["huevos", "huevo"], ["frijoles", "frijol"],
  ["electrolitos", "electrolito"], ["proteinas", "proteina"], ["carbohidratos", "carbohidrato"],
  ["grasas", "grasa"], ["carnes", "carne"], ["lacteos", "lacteo"],
]);
const STOP_WORDS = new Set(["a", "al", "con", "de", "del", "el", "en", "la", "los", "para", "por", "un", "una", "y"]);

function tokensFor(text: string): string[] {
  return text.normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\bsuero\s+lacteo\b/g, "whey")
    .match(/[a-z0-9]+/g)
    ?.filter((token) => !STOP_WORDS.has(token))
    .map((token) => ALIASES.get(token) ?? token) ?? [];
}

function hashIndex(token: string): number {
  let hash = 2166136261;
  for (let i = 0; i < token.length; i += 1) {
    hash = Math.imul(hash ^ token.charCodeAt(i), 16777619);
  }
  return 24 + (hash >>> 0) % (EMBEDDING_DIM - 25);
}

export function embedFoodText768(text: string): number[] {
  const vector = new Float64Array(EMBEDDING_DIM);
  const tokens = tokensFor(text);
  const unique = new Set(tokens);
  for (const [index, concept] of CONCEPTS.entries()) {
    for (const word of unique) {
      if (concept.has(word)) vector[index] = vector[index]! + 2;
    }
  }
  for (const word of unique) {
    const index = hashIndex(word);
    vector[index] = vector[index]! + 3;
    const padded = `^${word}$`;
    for (let i = 0; i + 3 <= padded.length; i += 1) {
      const trigram = hashIndex(padded.slice(i, i + 3));
      vector[trigram] = vector[trigram]! + 0.25;
    }
  }
  const bigrams = new Set(tokens.slice(1).map((token, i) => [tokens[i]!, token].sort().join(" ")));
  for (const bigram of bigrams) {
    const index = hashIndex(bigram);
    vector[index] = vector[index]! + 1.4;
  }
  if (unique.size === 0) vector[EMBEDDING_DIM - 1] = 1;
  const norm = Math.sqrt(vector.reduce((sum, item) => sum + item * item, 0));
  return Array.from(vector, (item) => item / norm);
}

function assertVector(vec: readonly number[]): void {
  if (vec.length !== EMBEDDING_DIM || vec.some((value) => !Number.isFinite(value))) {
    throw new RangeError("El vector requiere 768 componentes finitos.");
  }
}

export function cosineSimilarity768(a: readonly number[], b: readonly number[]): number {
  assertVector(a);
  assertVector(b);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < EMBEDDING_DIM; i += 1) {
    dot += a[i]! * b[i]!;
    normA += a[i]! ** 2;
    normB += b[i]! ** 2;
  }
  if (normA === 0 || normB === 0) return 0;
  return Math.max(-1, Math.min(1, dot / Math.sqrt(normA * normB)));
}

export function toPgVectorLiteral(vec: readonly number[]): string {
  assertVector(vec);
  return `[${vec.map((value) => Number(value.toFixed(8))).join(",")}]`;
}

const TEMPLATE_EMBEDDINGS = PORTION_TEMPLATES.map((template) => ({
  template,
  embedding: embedFoodText768(template.name),
}));

function rankedTemplates(embedding: readonly number[]) {
  return TEMPLATE_EMBEDDINGS
    .map(({ template, embedding: candidate }) => ({
      ...template, similarity: cosineSimilarity768(embedding, candidate),
    }))
    .sort((a, b) => b.similarity - a.similarity);
}

export function searchPortionTemplates(query: string, limit = 4) {
  return rankedTemplates(embedFoodText768(query)).slice(0, Math.max(0, limit));
}

export function analyzeMealVision(input: {
  description: string;
  mealSlot?: MealSlot;
  portionMultiplier?: number;
}): NutritionLogItem {
  const description = input.description.trim();
  const embedding = embedFoodText768(description);
  const template = rankedTemplates(embedding)[0]!;
  const multiplier = input.portionMultiplier ?? 1;
  const portionMultiplier = Number.isFinite(multiplier) ? Math.min(4, Math.max(0.25, multiplier)) : 1;
  const scale = (amount: number) => Math.round(amount * portionMultiplier * 100) / 100;
  return {
    id: crypto.randomUUID(),
    loggedAt: new Date().toISOString(),
    description,
    foodName: template.name,
    templateId: template.id,
    mealSlot: input.mealSlot ?? template.mealSlot,
    portionMultiplier,
    source: "pulsetrack",
    similarity: template.similarity,
    kcal: scale(template.kcal),
    proteinG: scale(template.proteinG),
    carbsG: scale(template.carbsG),
    fatG: scale(template.fatG),
    embeddingPreview: embedding.slice(0, 6),
    vectorSqlLiteral: toPgVectorLiteral(embedding),
  };
}

export function computeNetEnergyBalance(
  logs: readonly NutritionLogItem[],
  garminBasalKcal = 1780,
  garminActiveKcal = 640,
) {
  const totals = logs.reduce((result, log) => ({
    kcalIn: result.kcalIn + Math.round(log.kcal * 100),
    proteinTotalG: result.proteinTotalG + Math.round(log.proteinG * 100),
    carbsTotalG: result.carbsTotalG + Math.round(log.carbsG * 100),
    fatTotalG: result.fatTotalG + Math.round(log.fatG * 100),
  }), { kcalIn: 0, proteinTotalG: 0, carbsTotalG: 0, fatTotalG: 0 });
  const garminTotalOutKcal = garminBasalKcal + garminActiveKcal;
  const kcalIn = totals.kcalIn / 100;
  return {
    kcalIn, garminBasalKcal, garminActiveKcal, garminTotalOutKcal,
    netBalanceKcal: kcalIn - garminTotalOutKcal,
    proteinTotalG: totals.proteinTotalG / 100,
    carbsTotalG: totals.carbsTotalG / 100,
    fatTotalG: totals.fatTotalG / 100,
  };
}

export function getPassiveNocturnalBiometrics() {
  const firstDaySec = Date.UTC(2026, 10, 12) / 1000;
  return {
    timestampsSec: Array.from({ length: 7 }, (_, i) => firstDaySec + i * 86400),
    sleepScoreSeries: [86, 91, 83, 67, 79, 88, 92],
    hrvRmssdSeries: [63, 70, 61, 42, 55, 66, 72],
    campTempCSeries: [21.4, 22.1, 24.2, 27.4, 25.2, 22.8, 22.3],
    campPressureHpaSeries: [918, 917, 915, 912, 913, 916, 918],
  };
}

const MAX_TOTAL_LOG_BYTES = 8 * 1024 * 1024;
const nutritionByActor = new Map<string, NutritionLogItem[]>();
let storedLogBytes = 0;

function estimateLogBytes(log: NutritionLogItem): number {
  return 256 + log.foodName.length * 2 + log.vectorSqlLiteral.length;
}

export function listNutritionLogs(actor: string): NutritionLogItem[] {
  const logs = nutritionByActor.get(actor);
  if (!logs) return [];
  nutritionByActor.delete(actor);
  nutritionByActor.set(actor, logs);
  return [...logs];
}

export function appendNutritionLog(actor: string, log: NutritionLogItem): void {
  const logs = nutritionByActor.get(actor) ?? [];
  nutritionByActor.delete(actor);
  logs.unshift(log);
  storedLogBytes += estimateLogBytes(log);
  if (logs.length > MAX_LOGS_PER_ACTOR) {
    const removed = logs.pop();
    if (removed) storedLogBytes = Math.max(0, storedLogBytes - estimateLogBytes(removed));
  }
  nutritionByActor.set(actor, logs);
  while (nutritionByActor.size > MAX_ACTORS || storedLogBytes > MAX_TOTAL_LOG_BYTES) {
    const oldest = nutritionByActor.entries().next();
    if (oldest.done) break;
    const [oldestActor, oldestLogs] = oldest.value;
    if (oldestActor === actor && oldestLogs.length <= 1) break;
    const dropped = oldestLogs.pop();
    if (dropped) storedLogBytes = Math.max(0, storedLogBytes - estimateLogBytes(dropped));
    if (oldestLogs.length === 0) {
      nutritionByActor.delete(oldestActor);
    }
  }
}

export function resetNutritionStore(): void {
  nutritionByActor.clear();
  storedLogBytes = 0;
}
