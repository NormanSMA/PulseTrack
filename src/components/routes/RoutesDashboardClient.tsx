"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, DragEvent } from "react";
import { UPlotChart } from "@/components/charts/UPlotChart";
import type { RecentDeltaSummary } from "@/lib/charts/uplot-series";
import { GpxMapViewer } from "@/components/maps/GpxMapViewer";
import type {
  MapStyleId,
  SegmentCollection,
  SegmentFeature,
} from "@/components/maps/GpxMapViewer";
import {
  RadialGaugeRing,
  SegmentedLedBar,
  type AccentTone,
} from "@/components/ui/TelemetryPrimitives";

interface RoutePoint {
  lat: number;
  lon: number;
  eleM: number | null;
  timeMs: number | null;
  hrBpm: number | null;
  tempC: number | null;
  cumDistM: number;
  gradePct: number;
}

interface RouteSummary {
  externalId: string;
  title: string;
  activityType: string;
  source: string;
  startedAt: string | null;
  distanceM: number;
  elevationGainM: number;
}

interface RouteDetail extends RouteSummary {
  elevationLossM: number;
  durationSec: number;
  rawPaceSecKm: number | null;
  gapPaceSecKm: number | null;
  paHrDecouplingPct: number | null;
  thermalDriftBpm: number | null;
  avgHrBpm: number | null;
  avgTempC: number | null;
  pointsCount: number;
  simplifiedCount: number;
  points: RoutePoint[];
  wktLineStringZ: string;
  segmentsGeoJson: SegmentCollection;
  processingMs: number;
}

interface RoutesResponse {
  ok: boolean;
  routes: RouteSummary[];
  route: RouteDetail | null;
}

interface UploadResponse {
  ok: boolean;
  route: RouteDetail;
  deduplicated: boolean;
  postgisSqlPreview: string;
}

type ColorMode = "grade" | "pulse";

const ADR_BUDGET_MS = 16;

const STYLE_OPTIONS: { id: MapStyleId; label: string }[] = [
  { id: "mono-2d", label: "2D Mono" },
  { id: "topo", label: "Topografico" },
  { id: "satellite-3d", label: "Satelital 3D" },
];

const COLOR_OPTIONS: { id: ColorMode; label: string }[] = [
  { id: "grade", label: "Pendiente" },
  { id: "pulse", label: "Pulso" },
];

const BUTTON_BASE =
  "min-h-11 min-w-11 rounded-xl border px-4 text-sm font-semibold pt-motion-gpu motion-reduce:transform-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-strain active:scale-95 disabled:cursor-not-allowed disabled:opacity-40";
const BUTTON_IDLE =
  "border-border-subtle bg-surface text-ink-secondary hover:border-border-strong hover:text-ink-primary";
const BUTTON_ACTIVE =
  "border-accent-strain/60 bg-accent-strain/10 text-accent-strain";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isRoutesResponse(value: unknown): value is RoutesResponse {
  return isRecord(value) && value.ok === true && Array.isArray(value.routes);
}

function isUploadResponse(value: unknown): value is UploadResponse {
  return isRecord(value) && value.ok === true && isRecord(value.route);
}

function buildFallbackRoute(): RouteDetail {
  const count = 60;
  const points: RoutePoint[] = [];
  const baseTime = Date.UTC(2026, 0, 1, 12, 0, 0);
  let cum = 0;
  for (let i = 0; i < count; i += 1) {
    const t = i / (count - 1);
    const lat = 19.4326 + 0.02 * t + 0.004 * Math.sin(t * 6);
    const lon = -99.1332 + 0.03 * t + 0.004 * Math.cos(t * 5);
    const eleM = 2240 + 80 * Math.sin(t * Math.PI * 2) + 20 * t;
    if (i > 0) {
      const prev = points[i - 1];
      if (prev) {
        const dLat = (lat - prev.lat) * 111_320;
        const dLon = (lon - prev.lon) * 111_320 * Math.cos(lat * (Math.PI / 180));
        cum += Math.hypot(dLat, dLon);
      }
    }
    const prevEle = points[i - 1]?.eleM ?? eleM;
    const step = i > 0 ? cum - (points[i - 1]?.cumDistM ?? 0) : 1;
    points.push({
      lat,
      lon,
      eleM,
      timeMs: baseTime + i * 40_000,
      hrBpm: Math.round(135 + 25 * t + 10 * Math.sin(t * 9)),
      tempC: 18,
      cumDistM: cum,
      gradePct: step > 0 ? ((eleM - prevEle) / step) * 100 : 0,
    });
  }
  const segmentsGeoJson = buildSegments(points, "grade");
  return {
    externalId: "fallback-demo",
    title: "Ruta demo sin conexion",
    activityType: "run",
    source: "fallback",
    startedAt: new Date(baseTime).toISOString(),
    distanceM: cum,
    elevationGainM: 120,
    elevationLossM: 100,
    durationSec: (count - 1) * 40,
    rawPaceSecKm: 330,
    gapPaceSecKm: 318,
    paHrDecouplingPct: 3.2,
    thermalDriftBpm: 1.4,
    avgHrBpm: 148,
    avgTempC: 18,
    pointsCount: count,
    simplifiedCount: count,
    points,
    wktLineStringZ: "",
    segmentsGeoJson,
    processingMs: 0,
  };
}

function gradeColorHex(gradePct: number): string {
  if (gradePct >= 8) return "#F87171";
  if (gradePct >= 3) return "#FBBF24";
  if (gradePct <= -3) return "#60A5FA";
  return "#4ADE80";
}

function pulseColorHex(hr: number | null): string {
  if (hr === null) return "#B3B3B3";
  if (hr >= 170) return "#F87171";
  if (hr >= 150) return "#FBBF24";
  if (hr >= 130) return "#4ADE80";
  return "#60A5FA";
}

function buildSegments(
  points: RoutePoint[],
  mode: ColorMode,
  maxVertices = 1000,
): SegmentCollection {
  const features: SegmentFeature[] = [];
  if (points.length < 2) {
    return { type: "FeatureCollection", features };
  }
  const targetVertices = Math.max(2, maxVertices);
  const stride =
    points.length > targetVertices
      ? Math.ceil((points.length - 1) / (targetVertices - 1))
      : 1;
  const sampled: RoutePoint[] = [];
  for (let i = 0; i < points.length; i += stride) {
    const point = points[i];
    if (point) sampled.push(point);
  }
  const last = points[points.length - 1];
  if (last && sampled[sampled.length - 1] !== last) {
    sampled.push(last);
  }
  for (let i = 1; i < sampled.length; i += 1) {
    const a = sampled[i - 1];
    const b = sampled[i];
    if (!a || !b) continue;
    features.push({
      type: "Feature",
      properties: {
        colorHex:
          mode === "grade" ? gradeColorHex(b.gradePct) : pulseColorHex(b.hrBpm),
      },
      geometry: {
        type: "LineString",
        coordinates: [
          [a.lon, a.lat],
          [b.lon, b.lat],
        ],
      },
    });
  }
  return { type: "FeatureCollection", features };
}

function formatPace(secPerKm: number | null): string {
  if (secPerKm === null || !Number.isFinite(secPerKm) || secPerKm <= 0) {
    return "--:--/km";
  }
  const total = Math.round(secPerKm);
  const m = Math.floor(total / 60);
  const s = String(total % 60).padStart(2, "0");
  return `${m}:${s}/km`;
}

function formatPaceCompact(secPerKm: number | null): string {
  if (secPerKm === null || !Number.isFinite(secPerKm) || secPerKm <= 0) {
    return "--:--";
  }
  const total = Math.round(secPerKm);
  const m = Math.floor(total / 60);
  const s = String(total % 60).padStart(2, "0");
  return `${m}:${s}`;
}

function formatNumber(value: number | null, decimals: number): string {
  return value === null || !Number.isFinite(value) ? "--" : value.toFixed(decimals);
}

interface HrZoneBucket {
  id: string;
  label: string;
  rangeLabel: string;
  tone: AccentTone;
  count: number;
  percent: number;
}

function computeHrZones(points: readonly RoutePoint[]): {
  zones: HrZoneBucket[];
  totalSamples: number;
} {
  let z12 = 0;
  let z3 = 0;
  let z4 = 0;
  let z5 = 0;

  for (const point of points) {
    if (point.hrBpm === null || !Number.isFinite(point.hrBpm) || point.hrBpm <= 0) {
      continue;
    }
    if (point.hrBpm >= 170) {
      z5 += 1;
    } else if (point.hrBpm >= 155) {
      z4 += 1;
    } else if (point.hrBpm >= 140) {
      z3 += 1;
    } else {
      z12 += 1;
    }
  }

  const totalSamples = z12 + z3 + z4 + z5;
  const pct = (count: number) => (totalSamples > 0 ? (count / totalSamples) * 100 : 0);

  return {
    totalSamples,
    zones: [
      {
        id: "z1-z2",
        label: "Z1-Z2 Aerobico",
        rangeLabel: "< 140 bpm",
        tone: "recovery",
        count: z12,
        percent: pct(z12),
      },
      {
        id: "z3",
        label: "Z3 Tempo",
        rangeLabel: "140-154 bpm",
        tone: "strain",
        count: z3,
        percent: pct(z3),
      },
      {
        id: "z4",
        label: "Z4 Umbral",
        rangeLabel: "155-169 bpm",
        tone: "alert",
        count: z4,
        percent: pct(z4),
      },
      {
        id: "z5",
        label: "Z5 Max",
        rangeLabel: ">= 170 bpm",
        tone: "danger",
        count: z5,
        percent: pct(z5),
      },
    ],
  };
}

function computeGapGaugePercent(gapPaceSecKm: number | null): number {
  if (gapPaceSecKm === null || !Number.isFinite(gapPaceSecKm) || gapPaceSecKm <= 0) {
    return 0;
  }
  return Math.max(12, Math.min(100, Math.round(((600 - gapPaceSecKm) / 420) * 100)));
}

function computePaHrGaugePercent(paHrPct: number | null): number {
  if (paHrPct === null || !Number.isFinite(paHrPct)) return 0;
  return Math.max(0, Math.min(100, (Math.abs(paHrPct) / 10) * 100));
}

function buildElevation(points: RoutePoint[]): {
  data: [number[], number[]];
  yDomain: [number, number];
  summary: RecentDeltaSummary;
} {
  const pairs: [number, number][] = [];
  for (const p of points) {
    if (p.timeMs === null || p.eleM === null) continue;
    if (!Number.isFinite(p.timeMs) || !Number.isFinite(p.eleM)) continue;
    pairs.push([p.timeMs / 1000, p.eleM]);
  }
  pairs.sort((a, b) => a[0] - b[0]);
  const times: number[] = [];
  const eles: number[] = [];
  for (const [t, e] of pairs) {
    if (times.length > 0 && t <= (times[times.length - 1] ?? 0)) continue;
    times.push(t);
    eles.push(e);
  }
  const min = eles.length > 0 ? Math.min(...eles) : 0;
  const max = eles.length > 0 ? Math.max(...eles) : 1;
  const margin = Math.max((max - min) * 0.1, 1);
  const latest = eles.length > 0 ? (eles[eles.length - 1] ?? null) : null;
  const previous = eles.length > 1 ? (eles[eles.length - 2] ?? null) : null;
  const delta = latest !== null && previous !== null ? latest - previous : null;
  return {
    data: [times, eles],
    yDomain: [min - margin, max + margin],
    summary: {
      latest,
      previous,
      delta,
      formattedLatest: latest === null ? "--" : `${latest.toFixed(0)} m`,
      formattedDelta:
        delta === null ? "--" : `${delta >= 0 ? "+" : ""}${delta.toFixed(1)} m`,
      trend:
        delta === null ? "none" : delta > 0 ? "up" : delta < 0 ? "down" : "flat",
    },
  };
}

function Kpi({
  label,
  value,
  hint,
  tone = "text-ink-primary",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: string;
}) {
  return (
    <div className="rounded-2xl border border-border-subtle bg-surface p-4">
      <p className="text-xs text-ink-secondary">{label}</p>
      <p className={`mt-1 text-xl font-semibold tabular-nums ${tone}`}>{value}</p>
      {hint ? (
        <p className="mt-1 text-xs text-ink-secondary tabular-nums">{hint}</p>
      ) : null}
    </div>
  );
}

export function RoutesDashboardClient() {
  const [routes, setRoutes] = useState<RouteSummary[]>([]);
  const [route, setRoute] = useState<RouteDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [styleId, setStyleId] = useState<MapStyleId>("mono-2d");
  const [colorMode, setColorMode] = useState<ColorMode>("grade");
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const [uploadFailed, setUploadFailed] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const requestSeqRef = useRef(0);

  const loadRoutes = useCallback(async (id?: string) => {
    const seq = requestSeqRef.current + 1;
    requestSeqRef.current = seq;
    setLoading(true);
    setLoadError(null);
    try {
      const url = id ? `/api/routes?id=${encodeURIComponent(id)}` : "/api/routes";
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: unknown = await res.json();
      if (!isRoutesResponse(json)) throw new Error("Respuesta invalida");
      if (seq !== requestSeqRef.current) return;
      setRoutes(json.routes);
      setRoute(json.route);
    } catch (error) {
      if (seq !== requestSeqRef.current) return;
      const detail = error instanceof Error ? error.message : "Error desconocido";
      setLoadError(`No se pudo cargar las rutas (${detail}). Se muestra una ruta demo.`);
      const fallback = buildFallbackRoute();
      setRoutes([fallback]);
      setRoute(fallback);
    } finally {
      if (seq === requestSeqRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadRoutes();
  }, [loadRoutes]);

  const uploadFile = useCallback(async (file: File) => {
    setUploading(true);
    setUploadFailed(false);
    setUploadMessage(`Procesando ${file.name}...`);
    try {
      const gpx = await file.text();
      const title = file.name.replace(/\.gpx$/i, "");
      const res = await fetch("/api/routes/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gpx, title }),
      });
      const json: unknown = await res.json().catch(() => null);
      if (!res.ok || !isUploadResponse(json)) {
        const msg = isRecord(json) && typeof json.error === "string" ? json.error : `HTTP ${res.status}`;
        throw new Error(msg);
      }
      setRoute(json.route);
      setRoutes((prev) => [
        json.route,
        ...prev.filter((r) => r.externalId !== json.route.externalId),
      ]);
      setLoadError(null);
      setUploadMessage(
        json.deduplicated
          ? `Ruta ya existente: ${json.route.title}.`
          : `Ruta importada: ${json.route.title}.`,
      );
    } catch (error) {
      setUploadFailed(true);
      setUploadMessage(
        `Fallo la carga: ${error instanceof Error ? error.message : "error desconocido"}.`,
      );
    } finally {
      setUploading(false);
    }
  }, []);

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) void uploadFile(file);
    event.target.value = "";
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) void uploadFile(file);
  };

  const selectRoute = (id: string) => {
    if (route?.externalId === id) return;
    void loadRoutes(id);
  };

  const segments = useMemo<SegmentCollection | null>(() => {
    if (!route) return null;
    if (colorMode === "pulse") {
      return buildSegments(
        route.points,
        "pulse",
        Math.max(60, route.simplifiedCount),
      );
    }
    return route.segmentsGeoJson;
  }, [route, colorMode]);

  const elevation = useMemo(
    () => (route ? buildElevation(route.points) : null),
    [route],
  );

  const hrZones = useMemo(
    () => (route ? computeHrZones(route.points) : null),
    [route],
  );

  const withinBudget = route !== null && route.processingMs < ADR_BUDGET_MS;
  const paHrPct = route?.paHrDecouplingPct ?? null;
  const paHrStable = paHrPct !== null && paHrPct <= 5;
  const paHrTone: AccentTone =
    paHrPct === null ? "neutral" : paHrStable ? "recovery" : "alert";
  const gapDeltaSec =
    route !== null &&
    route.gapPaceSecKm !== null &&
    route.rawPaceSecKm !== null &&
    Number.isFinite(route.gapPaceSecKm) &&
    Number.isFinite(route.rawPaceSecKm)
      ? Math.round(route.gapPaceSecKm - route.rawPaceSecKm)
      : null;

  return (
    <div className="space-y-6">
      <header className="border-b border-border-subtle pb-5">
        <p className="text-xs font-semibold uppercase tracking-widest text-accent-strain">
          Routes - MapLibre 2D/3D + PostGIS
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink-primary sm:text-3xl">
          Rutas GPX y Ritmo GAP
        </h1>
      </header>

      {loadError ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-accent-danger/40 bg-accent-danger/10 p-4 text-sm text-accent-danger"
        >
          <span>{loadError}</span>
          <button
            type="button"
            onClick={() => void loadRoutes()}
            disabled={loading}
            className={`${BUTTON_BASE} ${BUTTON_IDLE}`}
          >
            {loading ? "Cargando..." : "Reintentar"}
          </button>
        </div>
      ) : null}

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed p-4 ${
          dragging
            ? "border-accent-strain bg-accent-strain/10"
            : "border-border-strong bg-surface"
        }`}
      >
        <div>
          <p className="text-sm font-semibold text-ink-primary">Importar archivo GPX</p>
          <p className="text-xs text-ink-secondary">
            Arrastra un archivo .gpx aqui o selecciona uno.
          </p>
          {uploadMessage ? (
            <p
              role={uploadFailed ? "alert" : "status"}
              className={`mt-2 text-xs ${
                uploadFailed ? "text-accent-danger" : "text-accent-recovery"
              }`}
            >
              {uploadMessage}
            </p>
          ) : null}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".gpx,application/gpx+xml"
          onChange={onFileChange}
          className="sr-only"
          aria-label="Seleccionar archivo GPX"
          tabIndex={-1}
        />
        <button
          type="button"
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
          className={`${BUTTON_BASE} ${BUTTON_ACTIVE} hover:bg-accent-strain/20`}
        >
          {uploading ? "Procesando..." : "Seleccionar GPX"}
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[16rem_1fr]">
        <section aria-label="Biblioteca de rutas" className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-secondary">
            Biblioteca
          </h2>
          {routes.length === 0 ? (
            <p className="text-sm text-ink-secondary">
              {loading ? "Cargando rutas..." : "Sin rutas. Importa un GPX."}
            </p>
          ) : (
            <ul className="flex gap-2 overflow-x-auto lg:flex-col lg:overflow-visible">
              {routes.map((r) => {
                const active = route?.externalId === r.externalId;
                return (
                  <li key={r.externalId} className="shrink-0 lg:shrink">
                    <button
                      type="button"
                      aria-pressed={active}
                      onClick={() => selectRoute(r.externalId)}
                      className={`${BUTTON_BASE} w-full min-w-44 text-left ${
                        active ? BUTTON_ACTIVE : BUTTON_IDLE
                      }`}
                    >
                      <span className="block truncate">{r.title}</span>
                      <span className="block text-xs font-normal tabular-nums">
                        {(r.distanceM / 1000).toFixed(2)} km - +
                        {r.elevationGainM.toFixed(0)} m
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section aria-label="Mapa de ruta" className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {STYLE_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                aria-pressed={styleId === opt.id}
                onClick={() => setStyleId(opt.id)}
                className={`${BUTTON_BASE} ${styleId === opt.id ? BUTTON_ACTIVE : BUTTON_IDLE}`}
              >
                {opt.label}
              </button>
            ))}
            <span className="w-2" aria-hidden="true" />
            {COLOR_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                aria-pressed={colorMode === opt.id}
                onClick={() => setColorMode(opt.id)}
                className={`${BUTTON_BASE} ${colorMode === opt.id ? BUTTON_ACTIVE : BUTTON_IDLE}`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <div className="h-80 overflow-hidden rounded-2xl border border-border-subtle bg-void sm:h-96">
            <GpxMapViewer
              segments={segments}
              styleId={styleId}
              routeKey={route?.externalId ?? "none"}
            />
          </div>
        </section>
      </div>

      {route ? (
        <>
          <section
            aria-labelledby="route-advanced-metrics-title"
            className="rounded-2xl border border-border-subtle bg-void p-4 sm:p-5"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border-subtle pb-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-accent-strain">
                  Telemetria fisiologica
                </p>
                <h2
                  id="route-advanced-metrics-title"
                  className="mt-0.5 text-base font-semibold text-ink-primary sm:text-lg"
                >
                  Metricas Avanzadas de Rendimiento
                </h2>
              </div>
              <p className="text-xs text-ink-secondary tabular-nums">
                {route.title} · {(route.distanceM / 1000).toFixed(2)} km
              </p>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-12">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:col-span-5">
                <RadialGaugeRing
                  percent={computeGapGaugePercent(route.gapPaceSecKm)}
                  value={formatPaceCompact(route.gapPaceSecKm)}
                  caption="GAP Minetti"
                  tone="strain"
                  footer={
                    <div className="space-y-1 text-xs tabular-nums">
                      <p className="font-semibold text-ink-primary">
                        Ritmo GAP vs Real
                      </p>
                      <p className="text-ink-secondary">
                        Real {formatPace(route.rawPaceSecKm)}
                      </p>
                      {gapDeltaSec !== null ? (
                        <span className="inline-block rounded-full border border-accent-strain/30 bg-accent-strain/10 px-2 py-0.5 text-xs font-semibold text-accent-strain">
                          {gapDeltaSec <= 0 ? "" : "+"}
                          {gapDeltaSec} s/km vs real
                        </span>
                      ) : null}
                    </div>
                  }
                />

                <RadialGaugeRing
                  percent={computePaHrGaugePercent(paHrPct)}
                  value={paHrPct === null ? "--" : `${paHrPct.toFixed(1)}%`}
                  caption="Pa:Hr"
                  tone={paHrTone}
                  footer={
                    <div className="space-y-1 text-xs tabular-nums">
                      <p className="font-semibold text-ink-primary">
                        Desacoplamiento Pa:Hr
                      </p>
                      <span
                        className={`inline-block rounded-full border px-2 py-0.5 text-xs font-semibold ${
                          paHrPct === null
                            ? "border-border-strong bg-elevated text-ink-secondary"
                            : paHrStable
                              ? "border-accent-recovery/30 bg-accent-recovery/15 text-accent-recovery"
                              : "border-accent-alert/30 bg-accent-alert/15 text-accent-alert"
                        }`}
                      >
                        {paHrPct === null
                          ? "Sin datos"
                          : paHrStable
                            ? "Estable <= 5%"
                            : "Deriva > 5%"}
                      </span>
                      <p className="text-ink-secondary">
                        Deriva termica {formatNumber(route.thermalDriftBpm, 1)} bpm
                      </p>
                    </div>
                  }
                />
              </div>

              <div className="flex flex-col justify-between rounded-2xl border border-border-subtle bg-surface p-4 lg:col-span-7">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold text-ink-primary">
                      Distribucion por Zonas de FC
                    </h3>
                    <p className="text-xs text-ink-secondary tabular-nums">
                      {hrZones && hrZones.totalSamples > 0
                        ? `${hrZones.totalSamples} muestras cardiacas · FC media ${formatNumber(route.avgHrBpm, 0)} bpm`
                        : "Sin muestras de frecuencia cardiaca en este GPX"}
                    </p>
                  </div>
                  <span className="rounded-lg border border-border-subtle bg-void px-2.5 py-1 text-xs font-semibold text-ink-secondary tabular-nums">
                    Umbral Pa:Hr 5.0%
                  </span>
                </div>

                <div className="mt-4 space-y-3">
                  {hrZones?.zones.map((zone) => (
                    <div key={zone.id} className="space-y-1.5">
                      <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs tabular-nums">
                        <div className="flex items-baseline gap-2">
                          <span className="font-semibold text-ink-primary">
                            {zone.label}
                          </span>
                          <span className="text-ink-secondary">
                            {zone.rangeLabel}
                          </span>
                        </div>
                        <span className="font-semibold text-ink-primary">
                          {zone.percent.toFixed(1)}%{" "}
                          <span className="font-normal text-ink-secondary">
                            ({zone.count} pts)
                          </span>
                        </span>
                      </div>
                      <SegmentedLedBar
                        percent={zone.percent}
                        segments={16}
                        tone={zone.tone}
                        label={`${zone.label} ${zone.percent.toFixed(1)} por ciento`}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <section
            aria-label="Indicadores de ruta"
            className="grid grid-cols-2 gap-3 lg:grid-cols-4"
          >
            <Kpi label="Distancia" value={`${(route.distanceM / 1000).toFixed(2)} km`} />
            <Kpi
              label="Desnivel"
              value={`+${route.elevationGainM.toFixed(0)} m`}
              hint={`-${route.elevationLossM.toFixed(0)} m`}
            />
            <Kpi
              label="Ritmo real vs GAP Minetti"
              value={formatPace(route.gapPaceSecKm)}
              hint={`Real ${formatPace(route.rawPaceSecKm)}`}
              tone="text-accent-strain"
            />
            <Kpi
              label="Desacoplamiento Pa:Hr"
              value={`${formatNumber(route.paHrDecouplingPct, 1)} %`}
              hint={`Deriva termica ${formatNumber(route.thermalDriftBpm, 1)} bpm`}
              tone={
                paHrPct === null
                  ? "text-ink-primary"
                  : paHrStable
                    ? "text-accent-recovery"
                    : "text-accent-alert"
              }
            />
            <Kpi
              label="Procesamiento JS"
              value={`${route.processingMs.toFixed(1)} ms`}
              hint={`ADR-003 < ${ADR_BUDGET_MS} ms: ${withinBudget ? "cumple" : "excede"}`}
              tone={withinBudget ? "text-accent-recovery" : "text-accent-danger"}
            />
            <Kpi
              label="Puntos"
              value={`${route.simplifiedCount} / ${route.pointsCount}`}
              hint="Simplificados / originales"
            />
            <Kpi label="FC media" value={`${formatNumber(route.avgHrBpm, 0)} bpm`} />
            <Kpi label="Temperatura" value={`${formatNumber(route.avgTempC, 1)} C`} />
          </section>

          {elevation ? (
            <UPlotChart
              title="Perfil de elevacion"
              subtitle={route.title}
              seriesLabel="Elevacion"
              unit="m"
              decimals={0}
              accent="recovery"
              data={elevation.data}
              yDomain={elevation.yDomain}
              summary={elevation.summary}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}
