"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { UPlotChart, type UPlotChartProps } from "@/components/charts/UPlotChart";
import { computeSafeYDomain, formatRecentDelta } from "@/lib/charts/uplot-series";
import {
  computeNetEnergyBalance,
  EMBEDDING_DIM,
  embedFoodText768,
  getPassiveNocturnalBiometrics,
  PORTION_TEMPLATES,
  searchPortionTemplates,
  type MealSlot,
  type NutritionLogItem,
} from "@/lib/nutrition/nutrition-engine";

type NutritionEntry = Pick<NutritionLogItem, "id" | "loggedAt" | "foodName" | "mealSlot" | "kcal" | "portionMultiplier">;
type Template = Pick<NutritionLogItem, "mealSlot" | "kcal"> & { id: string; name: string };
type Nocturnal = ReturnType<typeof getPassiveNocturnalBiometrics>;

interface NutritionSnapshot {
  logs: NutritionEntry[];
  balance: ReturnType<typeof computeNetEnergyBalance>;
}

interface NutritionData extends NutritionSnapshot {
  templates: readonly Template[];
  nocturnal: Nocturnal;
}

type MealRequest =
  | { templateId: string; mealSlot: MealSlot }
  | { description: string; mealSlot: MealSlot; portionMultiplier: number };

const MEAL_SLOTS = ["desayuno", "almuerzo", "cena", "snack"] as const satisfies readonly MealSlot[];
const PORTIONS = [0.75, 1, 1.25, 1.5] as const;
const NUMBER = new Intl.NumberFormat("es-NI", { maximumFractionDigits: 2 });
const LOG_DATE = new Intl.DateTimeFormat("es-NI", { dateStyle: "short", timeStyle: "short", timeZone: "UTC" });
const FALLBACK: NutritionData = {
  logs: [],
  templates: PORTION_TEMPLATES,
  balance: computeNetEnergyBalance([]),
  nocturnal: getPassiveNocturnalBiometrics(),
};

const CONTROL =
  "min-h-11 min-w-11 rounded-xl border px-3 pt-motion-gpu motion-reduce:transform-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-strong active:scale-95 disabled:cursor-not-allowed disabled:opacity-40";
const BUTTON =
  `${CONTROL} border-border-subtle bg-elevated text-sm font-semibold hover:border-border-strong hover:bg-void`;

const NOCTURNAL_CHARTS = [
  { key: "hrvRmssdSeries", title: "VFC nocturna (RMSSD)", seriesLabel: "RMSSD", unit: "ms", accent: "sleep", decimals: 0 },
  { key: "campTempCSeries", title: "Temperatura pasiva de campamento o habitación", seriesLabel: "Temperatura", unit: "C", accent: "alert", decimals: 1 },
  { key: "campPressureHpaSeries", title: "Presión barométrica pasiva", seriesLabel: "Presión", unit: "hPa", accent: "strain", decimals: 0 },
] as const satisfies readonly {
  key: Exclude<keyof Nocturnal, "timestampsSec">;
  title: string;
  seriesLabel: string;
  unit: string;
  accent: UPlotChartProps["accent"];
  decimals: number;
}[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTemplate(value: unknown): value is Template {
  return isRecord(value) && typeof value.id === "string" && typeof value.name === "string"
    && MEAL_SLOTS.some((slot) => slot === value.mealSlot) && Number.isFinite(value.kcal);
}

function isNutritionEntry(value: unknown): value is NutritionEntry {
  return isRecord(value) && typeof value.id === "string" && typeof value.foodName === "string"
    && MEAL_SLOTS.some((slot) => slot === value.mealSlot) && Number.isFinite(value.kcal)
    && Number.isFinite(value.portionMultiplier) && typeof value.loggedAt === "string"
    && Number.isFinite(Date.parse(value.loggedAt));
}

function isNutritionSnapshot(value: unknown): value is NutritionSnapshot {
  if (!isRecord(value) || value.ok !== true || !isRecord(value.balance)) return false;
  const { balance, logs } = value;
  return Array.isArray(logs) && logs.every(isNutritionEntry)
    && Object.keys(FALLBACK.balance).every((key) => Number.isFinite(balance[key]));
}

function isNocturnal(value: unknown): value is Nocturnal {
  if (!isRecord(value) || !Array.isArray(value.timestampsSec)) return false;
  const count = value.timestampsSec.length;
  return Object.keys(FALLBACK.nocturnal).every((key) => {
    const series = value[key];
    return Array.isArray(series) && series.length === count && series.every(Number.isFinite);
  });
}

function isNutritionData(value: unknown): value is NutritionData {
  return isRecord(value) && Array.isArray(value.templates) && value.templates.every(isTemplate)
    && isNocturnal(value.nocturnal) && isNutritionSnapshot(value);
}

function EnergyBalance({ balance }: Pick<NutritionData, "balance">) {
  const macros = [
    { label: "Proteína", grams: balance.proteinTotalG },
    { label: "Carbohidratos", grams: balance.carbsTotalG },
    { label: "Grasa", grams: balance.fatTotalG },
  ];

  return (
    <section aria-labelledby="energy-title" className="rounded-2xl border border-border-subtle bg-surface p-4 sm:p-6">
      <h2 id="energy-title" className="text-lg font-semibold text-ink-primary">Balance energético neto · ADR-001</h2>
      <dl className="mt-4 grid gap-4 sm:grid-cols-3">
        <div className="self-center">
          <dt className="text-sm text-ink-secondary">Calorías ingeridas (PulseTrack)</dt>
          <dd className="mt-1 text-2xl font-semibold text-ink-primary">{NUMBER.format(balance.kcalIn)} kcal</dd>
        </div>
        <div className="self-center">
          <dt className="text-sm text-ink-secondary">Calorías quemadas reales (Garmin)</dt>
          <dd className="mt-1 text-2xl font-semibold text-ink-primary">{NUMBER.format(balance.garminTotalOutKcal)} kcal</dd>
          <dd className="mt-1 text-xs text-ink-secondary">
            {NUMBER.format(balance.garminBasalKcal)} basal + {NUMBER.format(balance.garminActiveKcal)} activo
          </dd>
        </div>
        <div className="rounded-xl border border-border-subtle bg-void p-4">
          <dt className="text-sm text-ink-secondary">Balance neto</dt>
          <dd className="mt-1 text-3xl font-semibold text-ink-primary">
            {balance.netBalanceKcal > 0 ? "+" : ""}{NUMBER.format(balance.netBalanceKcal)} <span className="text-sm">kcal</span>
          </dd>
        </div>
      </dl>
      <p className="mt-3 text-xs text-ink-secondary">El gasto Garmin usa valores de referencia en esta versión.</p>
      <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-border-subtle pt-4 sm:grid-cols-3">
        {macros.map(({ label, grams }) => (
          <div key={label}>
            <dt className="text-sm text-ink-secondary">{label}</dt>
            <dd className="text-lg font-semibold text-ink-primary">{NUMBER.format(grams)} g</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function MealAnalyzer({ busy, analyzing, onRegister }: {
  busy: boolean;
  analyzing: boolean;
  onRegister: (meal: MealRequest) => Promise<void>;
}) {
  const [description, setDescription] = useState("");
  const [mealSlot, setMealSlot] = useState<MealSlot>("almuerzo");
  const [portionMultiplier, setPortionMultiplier] = useState<number>(1);
  const query = description.trim();
  const preview = useMemo(() => query ? {
    matches: searchPortionTemplates(query),
    embedding: embedFoodText768(query).slice(0, 6),
  } : null, [query]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (query && !busy) void onRegister({ description: query, mealSlot, portionMultiplier });
  }

  return (
    <section aria-labelledby="meal-analysis-title" className="min-w-0 rounded-2xl border border-border-subtle bg-surface p-4 sm:p-5">
      <h2 id="meal-analysis-title" className="text-lg font-semibold text-ink-primary">Analizador de platos por visión IA</h2>
      <p className="mt-1 text-sm text-ink-secondary">Describe el plato para buscar plantillas por similitud de coseno.</p>
      <form onSubmit={submit} className="mt-4 space-y-4">
        <div>
          <label htmlFor="meal-description" className="text-sm font-semibold text-ink-primary">Búsqueda semántica o descripción del plato</label>
          <input
            id="meal-description"
            type="text"
            required
            maxLength={2000}
            value={description}
            onChange={(event) => setDescription(event.currentTarget.value)}
            placeholder="Arroz con pollo y aguacate"
            className={`${CONTROL} mt-2 block w-full border-border-subtle bg-void text-base text-ink-primary placeholder:text-ink-secondary hover:border-border-strong`}
          />
        </div>

        <fieldset className="min-w-0">
          <legend className="mb-2 text-sm font-semibold text-ink-primary">Horario</legend>
          <div className="flex flex-wrap gap-2">
            {MEAL_SLOTS.map((slot) => (
              <button
                key={slot}
                type="button"
                aria-pressed={mealSlot === slot}
                onClick={() => setMealSlot(slot)}
                className={`${BUTTON} capitalize aria-pressed:border-border-strong aria-pressed:bg-void aria-pressed:text-accent-recovery`}
              >
                {slot}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="min-w-0">
          <legend className="mb-2 text-sm font-semibold text-ink-primary">Porción</legend>
          <div className="flex flex-wrap gap-2">
            {PORTIONS.map((portion) => (
              <button
                key={portion}
                type="button"
                aria-pressed={portionMultiplier === portion}
                onClick={() => setPortionMultiplier(portion)}
                className={`${BUTTON} aria-pressed:border-border-strong aria-pressed:bg-void aria-pressed:text-accent-recovery`}
              >
                {portion}x
              </button>
            ))}
          </div>
        </fieldset>

        <button type="submit" disabled={busy || !query} aria-busy={analyzing} className={`${BUTTON} w-full text-accent-recovery`}>
          {analyzing ? "Analizando y registrando…" : "Analizar y Registrar Plato"}
        </button>
      </form>

      {preview && (
        <div className="mt-5 space-y-3 border-t border-border-subtle pt-4">
          <h3 className="text-sm font-semibold text-ink-primary">Plantillas más cercanas · pgvector({EMBEDDING_DIM})</h3>
          <ul className="divide-y divide-border-subtle text-sm">
            {preview.matches.map(({ id, name, similarity }) => (
              <li key={id} className="flex items-baseline justify-between gap-2 py-2">
                <span className="text-ink-primary">{name}</span>
                <span className="shrink-0 font-mono text-accent-recovery">{similarity.toFixed(3)}</span>
              </li>
            ))}
          </ul>
          <div className="rounded-xl border border-border-subtle bg-void p-3">
            <p className="text-xs text-ink-secondary">Embedding L2 · Primeras {preview.embedding.length} dimensiones</p>
            <p className="mt-1 break-words font-mono text-xs text-ink-primary">
              [{preview.embedding.map((value) => value.toFixed(4)).join(", ")}]
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

function NocturnalCharts({ nocturnal }: Pick<NutritionData, "nocturnal">) {
  const charts = useMemo(() => NOCTURNAL_CHARTS.map(({ key, ...chart }): UPlotChartProps => {
    const values = nocturnal[key];
    return {
      ...chart,
      data: [nocturnal.timestampsSec, values],
      yDomain: computeSafeYDomain(values),
      summary: formatRecentDelta(values, chart.unit, chart.decimals),
    };
  }), [nocturnal]);

  return (
    <section aria-labelledby="nocturnal-title" className="space-y-4">
      <div>
        <h2 id="nocturnal-title" className="text-lg font-semibold text-ink-primary">Biometría nocturna y sensor pasivo Forerunner 165</h2>
        <p className="mt-1 text-sm text-ink-secondary">Series de referencia de VFC, temperatura y presión.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
        {charts.map((chart) => (
          <div key={chart.seriesLabel} className="min-w-0 rounded-2xl border border-border-subtle bg-surface p-3 sm:p-4">
            <UPlotChart {...chart} />
          </div>
        ))}
      </div>
    </section>
  );
}

export function NutritionDashboardClient() {
  const [data, setData] = useState(FALLBACK);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [pendingEntry, setPendingEntry] = useState<string | null>(null);
  const [writeError, setWriteError] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const writeInFlight = useRef(false);
  const busy = loading || pendingEntry !== null;

  useEffect(() => {
    const controller = new AbortController();

    async function loadNutrition() {
      try {
        const response = await fetch("/api/nutrition", { cache: "no-store", signal: controller.signal });
        const result: unknown = await response.json();
        if (!response.ok || !isNutritionData(result)) throw new Error("Respuesta de nutrición inválida.");
        if (controller.signal.aborted) return;
        setData(result);
        setLoadError(false);
        setWriteError(false);
      } catch {
        if (!controller.signal.aborted) setLoadError(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void loadNutrition();
    return () => controller.abort();
  }, [loadAttempt]);

  function retryLoad() {
    setLoading(true);
    setLoadAttempt((previous) => previous + 1);
  }

  async function registerMeal(meal: MealRequest) {
    if (loading || writeInFlight.current) return;
    writeInFlight.current = true;
    setPendingEntry("templateId" in meal ? meal.templateId : "analysis");
    setWriteError(false);
    setAnnouncement("Registrando plato…");

    try {
      const response = await fetch("/api/nutrition", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(meal),
      });
      const result: unknown = await response.json();
      if (!response.ok || !isRecord(result) || !isNutritionEntry(result.log) || !isNutritionSnapshot(result)) {
        throw new Error("Registro de nutrición sin confirmar.");
      }
      const { logs, balance, log } = result;
      setData((previous) => ({ ...previous, logs, balance }));
      setAnnouncement(`Registro guardado. ${log.foodName}.`);
    } catch {
      setWriteError(true);
      setAnnouncement("");
    } finally {
      writeInFlight.current = false;
      setPendingEntry(null);
    }
  }

  return (
    <div className="space-y-6 text-ink-primary tabular-nums">
      <header className="border-b border-border-subtle pb-5">
        <h1 className="text-2xl font-semibold tracking-tight text-ink-primary sm:text-3xl">Nutrición</h1>
        <p className="mt-1 text-sm text-ink-secondary">Ingesta, gasto Garmin y biometría nocturna.</p>
      </header>

      {loading && <p role="status" className="text-sm text-ink-secondary">Cargando nutrición…</p>}
      {(loadError || writeError) && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border-strong bg-void p-3">
          <div role="alert" className="text-sm text-accent-alert">
            {loadError && <p>Falló la sincronización. Se muestran los datos disponibles.</p>}
            {writeError && <p>El registro sigue sin confirmación. Actualiza la bitácora antes de repetirlo.</p>}
          </div>
          <button type="button" onClick={retryLoad} disabled={busy} className={BUTTON}>
            {loading ? "Actualizando…" : "Reintentar"}
          </button>
        </div>
      )}

      <EnergyBalance balance={data.balance} />

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <section aria-labelledby="quick-log-title" className="min-w-0 rounded-2xl border border-border-subtle bg-surface p-4 sm:p-5">
          <h2 id="quick-log-title" className="text-lg font-semibold text-ink-primary">Registro rápido de plantillas personales</h2>
          <p className="mt-1 text-sm text-ink-secondary">Elige una plantilla para registrar una porción con su horario.</p>
          <ul className="mt-4 space-y-2">
            {data.templates.map(({ id, name, mealSlot, kcal }) => (
              <li key={id}>
                <button
                  type="button"
                  onClick={() => void registerMeal({ templateId: id, mealSlot })}
                  disabled={busy}
                  aria-busy={pendingEntry === id}
                  className={`${BUTTON} flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2 text-left`}
                >
                  <span>
                    <span className="block">{name}</span>
                    <span className="text-xs font-normal capitalize text-ink-secondary">
                      {pendingEntry === id ? "Registrando…" : mealSlot}
                    </span>
                  </span>
                  <span className="shrink-0 text-accent-recovery">{NUMBER.format(kcal)} kcal</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
        <MealAnalyzer busy={busy} analyzing={pendingEntry === "analysis"} onRegister={registerMeal} />
      </div>

      <section aria-labelledby="nutrition-log-title" className="rounded-2xl border border-border-subtle bg-surface p-4 sm:p-5">
        <h2 id="nutrition-log-title" className="text-lg font-semibold text-ink-primary">Bitácora de ingesta</h2>
        <p role="status" className="mt-1 text-sm text-accent-recovery">{announcement}</p>
        {data.logs.length ? (
          <ul className="mt-2 divide-y divide-border-subtle">
            {data.logs.map(({ id, foodName, mealSlot, kcal, portionMultiplier, loggedAt }) => (
              <li key={id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-3 text-sm">
                <div>
                  <p className="font-semibold text-ink-primary">{foodName}</p>
                  <p className="text-xs text-ink-secondary">
                    <span className="capitalize">{mealSlot}</span> · {portionMultiplier}x ·{" "}
                    <time dateTime={loggedAt}>{LOG_DATE.format(new Date(loggedAt))} UTC</time>
                  </p>
                </div>
                <p className="font-semibold text-ink-primary">{NUMBER.format(kcal)} kcal</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-ink-secondary">Registra una plantilla o describe un plato para iniciar la bitácora.</p>
        )}
      </section>

      <NocturnalCharts nocturnal={data.nocturnal} />
    </div>
  );
}
