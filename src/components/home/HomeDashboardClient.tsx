"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useLiveIsland } from "@/components/ui/LiveIsland";
import {
  MetricSparkTile,
  RadialGaugeRing,
  ReadinessArcGauge,
  SegmentedLedBar,
  type AccentTone,
} from "@/components/ui/TelemetryPrimitives";
import { DEFAULT_WHAT_IF_SLIDERS, simulateWhatIf } from "@/lib/ai/onnx-readiness";
import { buildMockHeatmapDays } from "@/lib/mock-data";
import { createDefaultSnapshot } from "@/lib/offline/idb-store";
import {
  enqueueSubjectiveCheckin,
  fetchWeatherWithFallback,
  flushSyncQueue,
  getRemainingCooldownMs,
  importHevyCsvFile,
  isNavigatorOnline,
  isSyncStale,
  loadSnapshotInstant,
  syncIfStale,
} from "@/lib/offline/sync-queue";
import type { BiometricAccent, OfflinePulseSnapshot } from "@/lib/offline/types";

const ACCENT_BORDER: Record<BiometricAccent, string> = {
  recovery: "border-accent-recovery/40",
  strain: "border-accent-strain/40",
  sleep: "border-accent-sleep/40",
  alert: "border-accent-alert/40",
};

const ACCENT_TEXT: Record<BiometricAccent, string> = {
  recovery: "text-accent-recovery",
  strain: "text-accent-strain",
  sleep: "text-accent-sleep",
  alert: "text-accent-alert",
};

const ACCENT_BADGE: Record<BiometricAccent, string> = {
  recovery: "border-accent-recovery/40 bg-accent-recovery/10 text-accent-recovery",
  strain: "border-accent-strain/40 bg-accent-strain/10 text-accent-strain",
  sleep: "border-accent-sleep/40 bg-accent-sleep/10 text-accent-sleep",
  alert: "border-accent-alert/40 bg-accent-alert/10 text-accent-alert",
};

const SCALE_VALUES = [1, 2, 3, 4, 5] as const;

interface CheckinDimension {
  key: "energy" | "soreness" | "mood";
  label: string;
  lowHint: string;
  highHint: string;
}

const CHECKIN_DIMENSIONS: readonly CheckinDimension[] = [
  { key: "energy", label: "Energia", lowHint: "Baja", highHint: "Optima" },
  { key: "soreness", label: "Dolor muscular", lowHint: "Nulo", highHint: "Alto" },
  { key: "mood", label: "Animo", lowHint: "Bajo", highHint: "Alto" },
];

function formatMinutesToClock(totalMinutes: number): string {
  const safe = Math.max(0, Math.round(totalMinutes));
  const hours = Math.floor(safe / 60);
  const mins = safe % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

function formatCooldownClock(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function formatSignedKcal(value: number): string {
  const rounded = Math.round(value);
  if (rounded > 0) {
    return `+${rounded}`;
  }
  return String(rounded);
}

function buildSevenDaySeries(
  current: number,
  deltas: readonly [number, number, number, number, number, number],
  minVal = 0,
  decimals = 1,
): number[] {
  const factor = 10 ** decimals;
  const round = (val: number) => Math.round(Math.max(minVal, val) * factor) / factor;
  return [...deltas.map((delta) => round(current + delta)), round(current)];
}

export function HomeDashboardClient() {
  const { setState: setIslandState } = useLiveIsland();
  const csvInputId = useId();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [snapshot, setSnapshot] = useState<OfflinePulseSnapshot>(() => createDefaultSnapshot());
  const [online, setOnline] = useState<boolean>(true);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [cooldownMs, setCooldownMs] = useState<number>(0);

  const [energy, setEnergy] = useState<number | null>(null);
  const [soreness, setSoreness] = useState<number | null>(null);
  const [mood, setMood] = useState<number | null>(null);
  const [checkinBusy, setCheckinBusy] = useState<boolean>(false);
  const [checkinNotice, setCheckinNotice] = useState<string | null>(null);

  const [hevyBusy, setHevyBusy] = useState<boolean>(false);
  const [hevyFeedback, setHevyFeedback] = useState<{
    tone: "ok" | "queued" | "error";
    text: string;
  } | null>(null);

  const syncSubjectiveDraftFromSnapshot = useCallback((snap: OfflinePulseSnapshot) => {
    setEnergy(snap.biometrics.subjEnergy);
    setSoreness(snap.biometrics.subjSoreness);
    setMood(snap.biometrics.subjMood);
  }, []);

  useEffect(() => {
    let active = true;
    setOnline(isNavigatorOnline());

    async function hydrateAndMaybeSync() {
      const instant = await loadSnapshotInstant();
      if (!active) return;
      setSnapshot(instant);
      syncSubjectiveDraftFromSnapshot(instant);
      setCooldownMs(getRemainingCooldownMs(instant.meta.lastSyncAt));

      if (isSyncStale(instant.meta.lastSyncAt) && isNavigatorOnline()) {
        setIsSyncing(true);
        setIslandState("syncing");
        const result = await syncIfStale(false);
        if (!active) return;
        let nextSnapshot = result.snapshot;
        if (result.error) {
          const fallbackWeather = await fetchWeatherWithFallback();
          if (!active) return;
          if (fallbackWeather) {
            nextSnapshot = { ...nextSnapshot, weather: fallbackWeather };
          }
        }
        setSnapshot(nextSnapshot);
        syncSubjectiveDraftFromSnapshot(nextSnapshot);
        setCooldownMs(getRemainingCooldownMs(nextSnapshot.meta.lastSyncAt));
        setIslandState(result.error ? "alert" : "idle");
        setIsSyncing(false);
      } else if (isNavigatorOnline() && instant.weather?.source === "fixture") {
        const liveWeather = await fetchWeatherWithFallback();
        if (!active) return;
        if (liveWeather) {
          setSnapshot((prev) => ({ ...prev, weather: liveWeather }));
        }
      }
    }

    void hydrateAndMaybeSync();

    function handleOnline() {
      setOnline(true);
      void (async () => {
        setIslandState("syncing");
        await flushSyncQueue();
        const result = await syncIfStale(false);
        if (!active) return;
        setSnapshot(result.snapshot);
        syncSubjectiveDraftFromSnapshot(result.snapshot);
        setCooldownMs(getRemainingCooldownMs(result.snapshot.meta.lastSyncAt));
        setIslandState(result.error ? "alert" : "idle");
      })();
    }

    function handleOffline() {
      setOnline(false);
    }

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      active = false;
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [setIslandState, syncSubjectiveDraftFromSnapshot]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setCooldownMs(getRemainingCooldownMs(snapshot.meta.lastSyncAt));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [snapshot.meta.lastSyncAt]);

  const handleManualSync = useCallback(async () => {
    if (isSyncing || cooldownMs > 0) return;
    setIsSyncing(true);
    setIslandState("syncing");
    const result = await syncIfStale(false);
    setSnapshot(result.snapshot);
    syncSubjectiveDraftFromSnapshot(result.snapshot);
    setCooldownMs(getRemainingCooldownMs(result.snapshot.meta.lastSyncAt));
    setIslandState(result.error ? "alert" : "idle");
    setIsSyncing(false);
  }, [cooldownMs, isSyncing, setIslandState, syncSubjectiveDraftFromSnapshot]);

  const submitCheckin = useCallback(
    async (nextEnergy: number, nextSoreness: number, nextMood: number) => {
      setCheckinBusy(true);
      setCheckinNotice(null);
      try {
        const res = await enqueueSubjectiveCheckin({
          date: snapshot.biometrics.date,
          subjEnergy: nextEnergy,
          subjSoreness: nextSoreness,
          subjMood: nextMood,
        });
        setSnapshot(res.snapshot);
        if (res.error) {
          setCheckinNotice(res.error);
          setIslandState("alert");
        } else if (res.queued) {
          setCheckinNotice("Guardado offline en cola local.");
        } else {
          setCheckinNotice("Check-in guardado.");
        }
      } catch (err) {
        setCheckinNotice(err instanceof Error ? err.message : "Error al guardar check-in.");
      } finally {
        setCheckinBusy(false);
      }
    },
    [setIslandState, snapshot.biometrics.date],
  );

  const handleScaleTap = useCallback(
    (dimension: CheckinDimension["key"], value: number) => {
      const nextEnergy = dimension === "energy" ? value : energy;
      const nextSoreness = dimension === "soreness" ? value : soreness;
      const nextMood = dimension === "mood" ? value : mood;

      if (dimension === "energy") setEnergy(value);
      if (dimension === "soreness") setSoreness(value);
      if (dimension === "mood") setMood(value);

      if (nextEnergy !== null && nextSoreness !== null && nextMood !== null) {
        void submitCheckin(nextEnergy, nextSoreness, nextMood);
      }
    },
    [energy, mood, soreness, submitCheckin],
  );

  const handleCsvChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      setHevyBusy(true);
      setHevyFeedback(null);
      setIslandState("syncing");

      try {
        const csvText = await file.text();
        const res = await importHevyCsvFile(csvText, file.name);
        const refreshed = await loadSnapshotInstant();
        setSnapshot(refreshed);

        if (!res.ok) {
          setHevyFeedback({ tone: "error", text: res.message });
          setIslandState("alert");
        } else if (res.queued) {
          setHevyFeedback({ tone: "queued", text: res.message });
          setIslandState("idle");
        } else {
          setHevyFeedback({ tone: "ok", text: res.message });
          setIslandState("idle");
        }
      } catch (err) {
        setHevyFeedback({
          tone: "error",
          text: err instanceof Error ? err.message : "No se pudo leer el archivo CSV.",
        });
        setIslandState("alert");
      } finally {
        setHevyBusy(false);
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      }
    },
    [setIslandState],
  );

  const { biometrics, weather, meta, hevySessions } = snapshot;
  const totalBurnKcal = biometrics.restingKcal + biometrics.activeKcal;
  const netBalanceKcal = biometrics.caloriesConsumed - totalBurnKcal;

  const kpis: readonly {
    id: string;
    label: string;
    value: string;
    unit: string;
    delta: string;
    badge: string;
    accent: BiometricAccent;
  }[] = [
    {
      id: "recovery",
      label: "Recovery",
      value: String(biometrics.recoveryScore),
      unit: "%",
      delta: `${biometrics.recoveryDelta} · VFC ${biometrics.hrvMs} ms`,
      badge: "Garmin",
      accent: "recovery",
    },
    {
      id: "strain",
      label: "Strain",
      value: biometrics.strainScore.toFixed(1),
      unit: "idx",
      delta: `ACWR ${biometrics.acwr.toFixed(2)}`,
      badge: "Garmin + Hevy",
      accent: "strain",
    },
    {
      id: "sleep",
      label: "Sleep",
      value: formatMinutesToClock(biometrics.sleepMinutes),
      unit: "h",
      delta: `${biometrics.sleepEfficiencyPct}% ef.`,
      badge: "Garmin",
      accent: "sleep",
    },
    {
      id: "balance",
      label: "Balance",
      value: formatSignedKcal(netBalanceKcal),
      unit: "kcal",
      delta: `${biometrics.caloriesConsumed} / ${totalBurnKcal}`,
      badge: "PulseTrack / Garmin",
      accent: "alert",
    },
  ];

  const pendingCheckinCount = snapshot.pendingQueue.filter(
    (item) => item.kind === "subjective_checkin",
  ).length;
  const pendingHevyCount = snapshot.pendingQueue.filter((item) => item.kind === "hevy_csv").length;
  const latestHevy = hevySessions[0] ?? null;
  const syncDisabled = isSyncing || cooldownMs > 0 || !online;
  const hasTodayCheckin = energy !== null && soreness !== null && mood !== null;

  const readinessSimulation = useMemo(() => {
    const sleepHours = Number(Math.max(0, Math.min(12, biometrics.sleepMinutes / 60)).toFixed(2));
    return simulateWhatIf({
      sleepHours,
      sleepTempC: biometrics.campTempC ?? DEFAULT_WHAT_IF_SLIDERS.sleepTempC,
      hrvRmssdMs: biometrics.hrvMs,
      plannedGymTonnageKg: latestHevy?.totalVolumeKg ?? DEFAULT_WHAT_IF_SLIDERS.plannedGymTonnageKg,
      plannedTrailKm: DEFAULT_WHAT_IF_SLIDERS.plannedTrailKm,
      hydrationLiters: DEFAULT_WHAT_IF_SLIDERS.hydrationLiters,
    });
  }, [biometrics.campTempC, biometrics.hrvMs, biometrics.sleepMinutes, latestHevy?.totalVolumeKg]);

  const readinessTone: AccentTone = readinessSimulation.anomaly.isAnomaly
    ? "alert"
    : readinessSimulation.readinessLabel === "Optimo"
      ? "recovery"
      : readinessSimulation.readinessLabel === "Moderado"
        ? "alert"
        : "danger";

  const bentoMetrics = useMemo(() => {
    const sleepHours = Number((biometrics.sleepMinutes / 60).toFixed(1));
    const stressVal = biometrics.stressAvg ?? 24;
    const weightVal = snapshot.bodyComposition?.weightKg ?? 76.4;

    return [
      {
        id: "sleep-tile",
        title: "Sueno",
        value: formatMinutesToClock(biometrics.sleepMinutes),
        unit: "h",
        sublabel: `${biometrics.sleepEfficiencyPct}% eficiencia · Score ${biometrics.sleepScore}`,
        series: buildSevenDaySeries(sleepHours, [-0.5, -0.2, 0.3, -0.4, 0.1, 0.2], 0, 1),
        tone: "sleep" as AccentTone,
        tag: `${biometrics.sleepScore} pts`,
      },
      {
        id: "hrv-tile",
        title: "VFC Nocturna",
        value: String(Math.round(biometrics.hrvMs)),
        unit: "ms",
        sublabel: `${biometrics.recoveryDelta} · Garmin`,
        series: buildSevenDaySeries(biometrics.hrvMs, [-6, -3, 2, -4, 1, 3], 10, 0),
        tone: "recovery" as AccentTone,
        tag: "RMSSD",
      },
      {
        id: "rhr-tile",
        title: "FC Reposo",
        value: String(Math.round(biometrics.restingHrBpm)),
        unit: "lpm",
        sublabel: "Minima nocturna Garmin",
        series: buildSevenDaySeries(biometrics.restingHrBpm, [2, 1, 0, 2, 1, 0], 35, 0),
        tone: "strain" as AccentTone,
        tag: "RHR",
      },
      {
        id: "stress-tile",
        title: "Estres",
        value: biometrics.stressAvg !== null ? String(Math.round(biometrics.stressAvg)) : "--",
        unit: "/100",
        sublabel: `Body Battery ${biometrics.bodyBattery ?? "--"}%`,
        series: buildSevenDaySeries(stressVal, [4, 2, -3, 5, 1, -2], 0, 0),
        tone: (stressVal > 50 ? "alert" : "recovery") as AccentTone,
        tag: stressVal > 50 ? "Elevado" : "Bajo",
      },
      {
        id: "acwr-tile",
        title: "Carga ACWR",
        value: biometrics.acwr.toFixed(2),
        unit: "ratio",
        sublabel: `Strain ${biometrics.strainScore.toFixed(1)} idx`,
        series: buildSevenDaySeries(biometrics.acwr, [-0.08, -0.04, 0.02, -0.03, 0.01, 0.02], 0.4, 2),
        tone: (biometrics.acwr > 1.3 ? "alert" : "recovery") as AccentTone,
        tag: biometrics.acwr > 1.3 ? "Precaucion" : "Optimo",
      },
      {
        id: "renpho-tile",
        title: "Peso RENPHO",
        value: weightVal.toFixed(1),
        unit: "kg",
        sublabel: snapshot.bodyComposition
          ? `Bascula ${snapshot.bodyComposition.date}`
          : "Bascula RENPHO",
        series: buildSevenDaySeries(weightVal, [0.5, 0.4, 0.3, 0.2, 0.1, 0.1], 30, 1),
        tone: "strain" as AccentTone,
        tag: snapshot.bodyComposition?.syncedToGarmin === false ? "Pendiente" : "RENPHO",
      },
    ] as const;
  }, [
    biometrics.acwr,
    biometrics.bodyBattery,
    biometrics.hrvMs,
    biometrics.recoveryDelta,
    biometrics.restingHrBpm,
    biometrics.sleepEfficiencyPct,
    biometrics.sleepMinutes,
    biometrics.sleepScore,
    biometrics.strainScore,
    biometrics.stressAvg,
    snapshot.bodyComposition,
  ]);

  const streakSummary = useMemo(() => {
    const days = buildMockHeatmapDays();
    let streak = 0;
    for (let i = days.length - 1; i >= 0; i -= 1) {
      const day = days[i]!;
      const avg = Math.round((day.gym + day.routes + day.macros + day.recovery) / 4);
      if (avg > 0) {
        streak += 1;
      } else {
        break;
      }
    }
    const baseCheckins = days.filter((day) => day.recovery > 0).length;
    return {
      activeStreakDays: hasTodayCheckin ? Math.max(1, streak + 1) : streak,
      checkinsCount: hasTodayCheckin ? baseCheckins + 1 : baseCheckins,
    };
  }, [hasTodayCheckin]);

  return (
    <div className="space-y-6">
      <section aria-label="Readiness ONNX y metricas clave" className="space-y-4">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <ReadinessArcGauge
              score={readinessSimulation.readinessScore}
              label={readinessSimulation.readinessLabel}
              summary={readinessSimulation.shap.naturalLanguageSummary}
              tone={readinessTone}
              badge={`ONNX ${readinessSimulation.modelVersion} · ${biometrics.recoveryDelta}`}
            />

            {readinessSimulation.anomaly.isAnomaly ? (
              <div
                role="alert"
                className="mt-3 rounded-2xl border border-accent-alert/60 bg-accent-alert/10 px-4 py-3 text-xs text-accent-alert tabular-nums"
              >
                <p className="font-semibold uppercase tracking-wider">Alerta preventiva ONNX</p>
                <p className="mt-1">
                  {readinessSimulation.anomaly.liveIslandAlert ??
                    "Desviacion del perfil homeostatico detectada."}{" "}
                  (MSE {readinessSimulation.anomaly.anomalyMse.toFixed(3)} / p95{" "}
                  {readinessSimulation.anomaly.p95Threshold.toFixed(3)})
                </p>
              </div>
            ) : null}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:col-span-7">
            {kpis.map((kpi) => (
              <article
                key={kpi.id}
                className={`rounded-2xl border bg-surface p-5 ${ACCENT_BORDER[kpi.accent]}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-ink-secondary">
                    {kpi.label}
                  </span>
                  <span
                    className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold tracking-wide ${ACCENT_BADGE[kpi.accent]}`}
                  >
                    {kpi.badge}
                  </span>
                </div>

                <div className="mt-4 flex items-baseline gap-1.5">
                  <span className="text-3xl font-semibold tracking-tight text-ink-primary tabular-nums">
                    {kpi.value}
                  </span>
                  <span className="text-xs font-medium text-ink-secondary">{kpi.unit}</span>
                </div>

                <p className={`mt-3 text-xs font-medium tabular-nums ${ACCENT_TEXT[kpi.accent]}`}>
                  {kpi.delta}
                </p>
              </article>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Bento biometrico 7 dias">
          {bentoMetrics.map((metric) => (
            <MetricSparkTile
              key={metric.id}
              title={metric.title}
              value={metric.value}
              unit={metric.unit}
              sublabel={metric.sublabel}
              series={metric.series}
              tone={metric.tone}
              tag={metric.tag}
            />
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border-subtle bg-surface px-4 py-3 text-xs">
          <div className="flex flex-wrap items-center gap-3 text-ink-secondary">
            <span className="font-semibold uppercase tracking-wider text-ink-primary">
              Campana ambiental nocturna
            </span>
            <span className="tabular-nums">
              Temp:{" "}
              <strong className="font-semibold text-ink-primary">
                {biometrics.campTempC !== null ? `${biometrics.campTempC.toFixed(1)} °C` : "--"}
              </strong>
            </span>
            <span className="tabular-nums">
              Presion:{" "}
              <strong className="font-semibold text-ink-primary">
                {biometrics.campPressureHpa !== null
                  ? `${biometrics.campPressureHpa.toFixed(1)} hPa`
                  : "--"}
              </strong>
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-accent-recovery/40 bg-accent-recovery/10 px-2.5 py-1 text-[11px] font-semibold text-accent-recovery tabular-nums">
              {biometrics.campActiveKcal} kcal activas falsas · pasivo
            </span>
            <span className="text-[11px] text-ink-secondary tabular-nums">
              {online ? "Red activa" : "Sin red · cache idb"}
              {meta.pendingCount > 0 ? ` · ${meta.pendingCount} en cola` : ""}
            </span>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <section
          aria-labelledby="checkin-heading"
          className="rounded-2xl border border-border-subtle bg-surface p-5 lg:col-span-7"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 id="checkin-heading" className="text-base font-semibold text-ink-primary">
                Check-in subjetivo matutino
              </h2>
              <p className="mt-1 text-xs text-ink-secondary">
                Tres toques (escala 1 a 5) para Energia, Dolor muscular y Animo.
              </p>
            </div>

            <div className="flex items-center gap-2">
              {pendingCheckinCount > 0 || !online ? (
                <span className="rounded-full border border-accent-alert/50 bg-accent-alert/10 px-3 py-1 text-[11px] font-semibold text-accent-alert tabular-nums">
                  {pendingCheckinCount > 0
                    ? `Pendiente offline (${pendingCheckinCount})`
                    : "Modo offline"}
                </span>
              ) : (
                <span className="rounded-full border border-border-subtle bg-elevated px-3 py-1 text-[11px] font-medium text-ink-secondary tabular-nums">
                  {biometrics.date}
                </span>
              )}
            </div>
          </div>

          <div className="mt-4 space-y-4">
            {CHECKIN_DIMENSIONS.map((dim) => {
              const currentValue =
                dim.key === "energy" ? energy : dim.key === "soreness" ? soreness : mood;

              return (
                <div
                  key={dim.key}
                  className="flex flex-col gap-2 rounded-xl border border-border-subtle bg-void p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink-primary">{dim.label}</p>
                    <p className="text-[11px] text-ink-secondary">
                      1 {dim.lowHint} · 5 {dim.highHint}
                    </p>
                  </div>

                  <div
                    role="group"
                    aria-label={`Seleccionar ${dim.label}`}
                    className="flex flex-wrap items-center gap-1.5"
                  >
                    {SCALE_VALUES.map((val) => {
                      const selected = currentValue === val;
                      return (
                        <button
                          key={val}
                          type="button"
                          disabled={checkinBusy}
                          aria-pressed={selected}
                          aria-label={`${dim.label} ${val} de 5`}
                          onClick={() => handleScaleTap(dim.key, val)}
                          className={`flex min-h-11 min-w-11 items-center justify-center rounded-xl border text-sm font-semibold tabular-nums pt-motion-gpu active:scale-95 motion-reduce:transform-none motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-primary disabled:cursor-not-allowed disabled:opacity-40 ${
                            selected
                              ? "border-accent-recovery bg-accent-recovery text-void"
                              : "border-border-strong bg-surface text-ink-primary hover:border-ink-primary hover:bg-elevated"
                          }`}
                        >
                          {val}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs">
            <span role="status" aria-live="polite" className="text-ink-secondary tabular-nums">
              {checkinBusy
                ? "Guardando check-in..."
                : checkinNotice ??
                  (energy !== null && soreness !== null && mood !== null
                    ? `Registro actual: ${energy}/${soreness}/${mood}`
                    : "Selecciona un valor en las 3 filas.")}
            </span>

            {energy !== null && soreness !== null && mood !== null ? (
              <button
                type="button"
                disabled={checkinBusy}
                onClick={() => void submitCheckin(energy, soreness, mood)}
                className="min-h-11 min-w-11 rounded-xl border border-border-strong bg-elevated px-4 text-xs font-semibold text-ink-primary pt-motion-gpu hover:border-ink-primary hover:bg-surface active:scale-95 motion-reduce:transform-none motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-primary disabled:cursor-not-allowed disabled:opacity-40"
              >
                {checkinBusy ? "Enviando..." : "Reenviar"}
              </button>
            ) : null}
          </div>
        </section>

        <div className="flex flex-col gap-4 lg:col-span-5">
          <section
            aria-labelledby="weather-sync-heading"
            className="rounded-2xl border border-border-subtle bg-surface p-5"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="weather-sync-heading" className="text-base font-semibold text-ink-primary">
                  Clima local y SWR
                </h2>
                <p className="mt-0.5 text-xs text-ink-secondary">
                  {weather ? `${weather.locationName} · ${weather.conditionLabel}` : "Sin datos"}
                </p>
              </div>
              <span className="rounded-full border border-border-subtle bg-elevated px-2.5 py-1 text-[11px] font-medium text-ink-secondary">
                {weather?.source ?? "fixture"}
              </span>
            </div>

            {weather ? (
              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-12 sm:items-center">
                <div className="sm:col-span-5">
                  <RadialGaugeRing
                    percent={Math.max(0, Math.min(100, (weather.temperatureC / 45) * 100))}
                    value={`${weather.temperatureC.toFixed(1)} °C`}
                    caption="Temp"
                    tone={weather.temperatureC >= 30 ? "alert" : "strain"}
                    footer={
                      <p className="text-[11px] text-ink-secondary tabular-nums">
                        {weather.apparentTempC !== null
                          ? `Sensacion ${weather.apparentTempC.toFixed(1)} °C`
                          : `${weather.pressureHpa.toFixed(0)} hPa`}
                      </p>
                    }
                  />
                </div>

                <div className="space-y-4 rounded-2xl border border-border-subtle bg-void p-4 sm:col-span-7">
                  <div>
                    <div className="mb-1.5 flex items-center justify-between text-xs">
                      <span className="font-medium text-ink-secondary">Humedad</span>
                      <span className="font-semibold text-ink-primary tabular-nums">
                        {Math.round(weather.humidityPct)}%
                      </span>
                    </div>
                    <SegmentedLedBar
                      percent={weather.humidityPct}
                      segments={12}
                      tone={weather.humidityPct > 80 ? "alert" : "sleep"}
                      label={`Humedad ${Math.round(weather.humidityPct)} por ciento`}
                    />
                  </div>

                  <div>
                    <div className="mb-1.5 flex items-center justify-between text-xs">
                      <span className="font-medium text-ink-secondary">Viento</span>
                      <span className="font-semibold text-ink-primary tabular-nums">
                        {weather.windKmh.toFixed(1)} km/h
                      </span>
                    </div>
                    <SegmentedLedBar
                      percent={Math.min(100, (weather.windKmh / 60) * 100)}
                      segments={12}
                      tone={weather.windKmh > 35 ? "alert" : "recovery"}
                      label={`Viento ${weather.windKmh.toFixed(1)} kilometros por hora`}
                    />
                  </div>

                  <div className="flex items-center justify-between border-t border-border-subtle pt-2.5 text-[11px] text-ink-secondary tabular-nums">
                    <span>Presion</span>
                    <span className="font-semibold text-ink-primary">
                      {weather.pressureHpa.toFixed(1)} hPa
                    </span>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs text-ink-secondary tabular-nums">
                {cooldownMs > 0 ? (
                  <span>Enfriamiento SWR: {formatCooldownClock(cooldownMs)}</span>
                ) : (
                  <span>Ventana SWR 15m disponible</span>
                )}
              </div>

              <button
                type="button"
                disabled={syncDisabled}
                aria-busy={isSyncing}
                onClick={() => void handleManualSync()}
                className="min-h-11 min-w-11 rounded-full border border-border-strong bg-elevated px-4 text-xs font-semibold uppercase tracking-wider text-ink-primary pt-motion-gpu hover:border-ink-primary hover:bg-void active:scale-95 motion-reduce:transform-none motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-primary disabled:cursor-not-allowed disabled:opacity-40"
              >
                {isSyncing
                  ? "Sincronizando..."
                  : cooldownMs > 0
                    ? `Sync ${formatCooldownClock(cooldownMs)}`
                    : "Sincronizar"}
              </button>
            </div>
          </section>

          <section
            aria-labelledby="hevy-import-heading"
            className="rounded-2xl border border-border-subtle bg-surface p-5"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="hevy-import-heading" className="text-base font-semibold text-ink-primary">
                  Importacion rapida Hevy CSV
                </h2>
                <p className="mt-0.5 text-xs text-ink-secondary">
                  Procesa sesiones y series directo en /api/ingest/hevy.
                </p>
              </div>
              {pendingHevyCount > 0 ? (
                <span className="rounded-full border border-accent-alert/50 bg-accent-alert/10 px-2.5 py-1 text-[11px] font-semibold text-accent-alert tabular-nums">
                  {pendingHevyCount} en cola
                </span>
              ) : null}
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <label
                htmlFor={csvInputId}
                className={`inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-xl border border-border-strong bg-void px-4 text-xs font-semibold uppercase tracking-wider text-ink-primary pt-motion-gpu hover:border-ink-primary hover:bg-elevated active:scale-95 motion-reduce:transform-none motion-reduce:transition-none focus-within:ring-2 focus-within:ring-ink-primary ${
                  hevyBusy ? "pointer-events-none opacity-40" : ""
                }`}
              >
                {hevyBusy ? "Importando CSV..." : "Seleccionar CSV Hevy"}
                <input
                  ref={fileInputRef}
                  id={csvInputId}
                  type="file"
                  accept=".csv,text/csv"
                  disabled={hevyBusy}
                  onChange={(e) => void handleCsvChange(e)}
                  className="sr-only"
                />
              </label>

              {latestHevy ? (
                <span className="text-xs text-ink-secondary tabular-nums">
                  Ultima: {latestHevy.title} ({latestHevy.setsCount} series)
                </span>
              ) : (
                <span className="text-xs text-ink-secondary tabular-nums">
                  Formato estandar Hevy
                </span>
              )}
            </div>

            {hevyFeedback ? (
              <p
                role="status"
                aria-live="polite"
                className={`mt-3 text-xs font-medium tabular-nums ${
                  hevyFeedback.tone === "error"
                    ? "text-accent-danger"
                    : hevyFeedback.tone === "queued"
                      ? "text-accent-alert"
                      : "text-accent-recovery"
                }`}
              >
                {hevyFeedback.text}
              </p>
            ) : null}
          </section>
        </div>
      </div>

      <section aria-label="Rachas de consistencia" className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <article className="flex items-center justify-between rounded-2xl border border-border-subtle bg-surface px-5 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-secondary">
              Racha activa
            </p>
            <p className="mt-1 text-xs text-ink-secondary">
              Dias consecutivos con registro biometrico
            </p>
          </div>
          <p className="text-3xl font-bold tracking-tight text-accent-recovery tabular-nums">
            {streakSummary.activeStreakDays}d
          </p>
        </article>

        <article className="flex items-center justify-between rounded-2xl border border-border-subtle bg-surface px-5 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-secondary">
              Check-ins
            </p>
            <p className="mt-1 text-xs text-ink-secondary tabular-nums">
              {hasTodayCheckin ? "Check-in de hoy completado" : "Pendiente check-in de hoy"}
            </p>
          </div>
          <p className="text-3xl font-bold tracking-tight text-ink-primary tabular-nums">
            {streakSummary.checkinsCount}
          </p>
        </article>
      </section>
    </div>
  );
}
