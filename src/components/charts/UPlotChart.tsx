"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import uPlot from "uplot";
import type { RecentDeltaSummary } from "@/lib/charts/uplot-series";
import "./uplot-amoled.css";

export type ChartAccent = "recovery" | "strain" | "sleep" | "alert";

export interface UPlotChartProps {
  title: string;
  subtitle?: string;
  seriesLabel: string;
  unit: string;
  decimals?: number;
  accent: ChartAccent;
  data: uPlot.AlignedData;
  yDomain: [number, number];
  summary: RecentDeltaSummary;
}

const ACCENT_CSS_VAR: Record<ChartAccent, string> = {
  recovery: "--accent-recovery",
  strain: "--accent-strain",
  sleep: "--accent-sleep",
  alert: "--accent-alert",
};

const ACCENT_TEXT_CLASS: Record<ChartAccent, string> = {
  recovery: "text-accent-recovery",
  strain: "text-accent-strain",
  sleep: "text-accent-sleep",
  alert: "text-accent-alert",
};

const ACCENT_BADGE_CLASS: Record<ChartAccent, string> = {
  recovery: "border-accent-recovery/40 bg-accent-recovery/10 text-accent-recovery",
  strain: "border-accent-strain/40 bg-accent-strain/10 text-accent-strain",
  sleep: "border-accent-sleep/40 bg-accent-sleep/10 text-accent-sleep",
  alert: "border-accent-alert/40 bg-accent-alert/10 text-accent-alert",
};

const ACCENT_FALLBACK_RGB: Record<ChartAccent, string> = {
  recovery: "74 222 128",
  strain: "96 165 250",
  sleep: "192 132 252",
  alert: "251 191 36",
};

interface HoverPoint {
  dateLabel: string;
  valueLabel: string;
}

function readCssRgb(
  styles: CSSStyleDeclaration,
  varName: string,
  fallback: string,
): string {
  const raw = styles.getPropertyValue(varName).trim();
  return raw.length > 0 ? raw : fallback;
}

function formatUtcShortDate(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  const day = String(d.getUTCDate()).padStart(2, "0");
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${day}/${month}`;
}

function computeSeriesBounds(
  values: uPlot.AlignedData[1] | undefined,
): { count: number; min: number | null; max: number | null } {
  if (!values) {
    return { count: 0, min: null, max: null };
  }

  let count = 0;
  let min: number | null = null;
  let max: number | null = null;

  for (let i = 0; i < values.length; i += 1) {
    const val = values[i];
    if (typeof val !== "number" || !Number.isFinite(val)) continue;
    count += 1;
    if (min === null || val < min) min = val;
    if (max === null || val > max) max = val;
  }

  return { count, min, max };
}

export function UPlotChart({
  title,
  subtitle,
  seriesLabel,
  unit,
  decimals = 1,
  accent,
  data,
  yDomain,
  summary,
}: UPlotChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [hovered, setHovered] = useState<HoverPoint | null>(null);

  const bounds = useMemo(() => computeSeriesBounds(data[1]), [data]);
  const hasPoints = (data[0]?.length ?? 0) > 0 && bounds.count > 0;
  const domainMin = yDomain[0];
  const domainMax = yDomain[1];

  useEffect(() => {
    setHovered(null);
    const container = containerRef.current;
    if (!container || !hasPoints) {
      return;
    }

    const styles = window.getComputedStyle(document.documentElement);
    const accentRgb = readCssRgb(
      styles,
      ACCENT_CSS_VAR[accent],
      ACCENT_FALLBACK_RGB[accent],
    );
    const borderSubtleRgb = readCssRgb(styles, "--border-subtle", "38 38 38");
    const fgSecondaryRgb = readCssRgb(styles, "--fg-secondary", "179 179 179");
    const voidRgb = readCssRgb(styles, "--bg-void", "0 0 0");

    const strokeColor = `rgb(${accentRgb})`;
    const fillColor = `rgb(${accentRgb} / 0.14)`;
    const gridColor = `rgb(${borderSubtleRgb} / 0.75)`;
    const axisColor = `rgb(${fgSecondaryRgb})`;
    const voidColor = `rgb(${voidRgb})`;

    const initialWidth = Math.max(240, Math.floor(container.clientWidth));
    const initialHeight = Math.max(180, Math.floor(container.clientHeight));

    let lastSize = { width: initialWidth, height: initialHeight };
    let rafId: number | null = null;
    const suffix = unit.trim().length > 0 ? ` ${unit.trim()}` : "";

    const opts: uPlot.Options = {
      width: initialWidth,
      height: initialHeight,
      legend: { show: false },
      padding: [12, 12, 0, 0],
      cursor: {
        x: true,
        y: false,
        drag: { x: false, y: false, setScale: false },
        points: {
          size: 8,
          width: 2,
          stroke: strokeColor,
          fill: voidColor,
        },
      },
      scales: {
        x: { time: true },
        y: {
          auto: false,
          range: () => [domainMin, domainMax],
        },
      },
      series: [
        {},
        {
          label: seriesLabel,
          stroke: strokeColor,
          width: 2,
          fill: fillColor,
          spanGaps: true,
          points: {
            show: true,
            size: 5,
            width: 1.5,
            stroke: strokeColor,
            fill: voidColor,
          },
        },
      ],
      axes: [
        {
          stroke: axisColor,
          font: "11px ui-monospace, SFMono-Regular, Menlo, monospace",
          gap: 6,
          grid: { stroke: gridColor, width: 1 },
          ticks: { stroke: gridColor, width: 1, size: 4 },
          values: (_self, splits) =>
            splits.map((ts) => (Number.isFinite(ts) ? formatUtcShortDate(ts) : "")),
        },
        {
          stroke: axisColor,
          font: "11px ui-monospace, SFMono-Regular, Menlo, monospace",
          size: 52,
          gap: 6,
          grid: { stroke: gridColor, width: 1 },
          ticks: { stroke: gridColor, width: 1, size: 4 },
          values: (_self, splits) =>
            splits.map((val) =>
              Number.isFinite(val) ? val.toFixed(decimals) : "",
            ),
        },
      ],
      hooks: {
        setCursor: [
          (self) => {
            const idx = self.cursor.idx;
            if (idx === null || idx === undefined) {
              setHovered(null);
              return;
            }
            const ts = self.data[0]?.[idx];
            const val = self.data[1]?.[idx];
            if (
              typeof ts !== "number" ||
              !Number.isFinite(ts) ||
              typeof val !== "number" ||
              !Number.isFinite(val)
            ) {
              setHovered(null);
              return;
            }
            setHovered({
              dateLabel: formatUtcShortDate(ts),
              valueLabel: `${val.toFixed(decimals)}${suffix}`,
            });
          },
        ],
      },
    };

    const plot = new uPlot(opts, data, container);

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;

      const nextWidth = Math.floor(entry.contentRect.width);
      const nextHeight = Math.floor(entry.contentRect.height);
      if (nextWidth <= 0 || nextHeight <= 0) return;
      if (nextWidth === lastSize.width && nextHeight === lastSize.height) return;

      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
      }

      rafId = window.requestAnimationFrame(() => {
        rafId = null;
        lastSize = { width: nextWidth, height: nextHeight };
        plot.setSize({ width: nextWidth, height: nextHeight });
      });
    });

    observer.observe(container);

    return () => {
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
      }
      observer.disconnect();
      plot.destroy();
    };
  }, [accent, data, decimals, domainMax, domainMin, hasPoints, seriesLabel, unit]);

  const ariaLabel = useMemo(() => {
    if (!hasPoints) {
      return `Grafica ${title}: sin datos disponibles.`;
    }
    const minLabel =
      bounds.min !== null ? bounds.min.toFixed(decimals) : "--";
    const maxLabel =
      bounds.max !== null ? bounds.max.toFixed(decimals) : "--";
    return `Grafica ${title}: ultimo registro ${summary.formattedLatest}, variacion reciente ${summary.formattedDelta}, minimo ${minLabel} ${unit}, maximo ${maxLabel} ${unit}, ${bounds.count} puntos.`;
  }, [bounds.count, bounds.max, bounds.min, decimals, hasPoints, summary.formattedDelta, summary.formattedLatest, title, unit]);

  const deltaClass =
    summary.trend === "none"
      ? "border-border-subtle bg-elevated text-ink-secondary"
      : ACCENT_BADGE_CLASS[accent];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-ink-primary">{title}</h3>
          {subtitle ? (
            <p className="mt-0.5 text-xs text-ink-secondary">{subtitle}</p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-baseline gap-2.5">
          <span
            className={`text-2xl font-semibold tracking-tight tabular-nums ${ACCENT_TEXT_CLASS[accent]}`}
          >
            {hovered ? hovered.valueLabel : summary.formattedLatest}
          </span>
          <span
            className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold tabular-nums ${deltaClass}`}
          >
            {hovered ? `Fecha ${hovered.dateLabel}` : `Delta ${summary.formattedDelta}`}
          </span>
        </div>
      </div>

      <div
        role="img"
        aria-label={ariaLabel}
        className="rounded-xl border border-border-subtle bg-void p-2"
      >
        {hasPoints ? (
          <div ref={containerRef} className="relative h-56 w-full overflow-hidden sm:h-64" />
        ) : (
          <div className="flex h-56 w-full items-center justify-center text-xs text-ink-secondary sm:h-64">
            Sin registros validos para graficar.
          </div>
        )}
      </div>

      <p className="sr-only">{ariaLabel}</p>
    </div>
  );
}
