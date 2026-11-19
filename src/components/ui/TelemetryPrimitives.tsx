"use client";

import type { ReactNode } from "react";

export type AccentTone = "recovery" | "strain" | "sleep" | "alert" | "danger" | "neutral";

const TEXT_TONE_CLASS: Record<AccentTone, string> = {
  recovery: "text-accent-recovery",
  strain: "text-accent-strain",
  sleep: "text-accent-sleep",
  alert: "text-accent-alert",
  danger: "text-accent-danger",
  neutral: "text-ink-primary",
};

const BG_TONE_CLASS: Record<AccentTone, string> = {
  recovery: "bg-accent-recovery",
  strain: "bg-accent-strain",
  sleep: "bg-accent-sleep",
  alert: "bg-accent-alert",
  danger: "bg-accent-danger",
  neutral: "bg-ink-primary",
};

const PILL_TONE_CLASS: Record<AccentTone, string> = {
  recovery: "border-accent-recovery/30 bg-accent-recovery/15 text-accent-recovery",
  strain: "border-accent-strain/30 bg-accent-strain/15 text-accent-strain",
  sleep: "border-accent-sleep/30 bg-accent-sleep/15 text-accent-sleep",
  alert: "border-accent-alert/30 bg-accent-alert/15 text-accent-alert",
  danger: "border-accent-danger/30 bg-accent-danger/15 text-accent-danger",
  neutral: "border-border-strong bg-elevated text-ink-secondary",
};

function clampPct(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function polarToCartesian(cx: number, cy: number, radius: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: cx + radius * Math.cos(rad),
    y: cy + radius * Math.sin(rad),
  };
}

function describeArc(cx: number, cy: number, radius: number, startAngle: number, endAngle: number): string {
  const start = polarToCartesian(cx, cy, radius, endAngle);
  const end = polarToCartesian(cx, cy, radius, startAngle);
  const largeArc = endAngle - startAngle <= 180 ? "0" : "1";
  return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${radius} ${radius} 0 ${largeArc} 0 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
}

export function ReadinessArcGauge({
  score,
  label,
  summary,
  tone = "recovery",
  badge,
}: {
  score: number;
  label: string;
  summary: string;
  tone?: AccentTone;
  badge?: string;
}) {
  const pct = clampPct(score);
  const segments = [
    { start: -112, end: -72, threshold: 20 },
    { start: -64, end: -24, threshold: 40 },
    { start: -16, end: 24, threshold: 60 },
    { start: 32, end: 72, threshold: 80 },
    { start: 80, end: 112, threshold: 100 },
  ];
  const indicatorAngle = -112 + (pct / 100) * 224;
  const dot = polarToCartesian(130, 128, 96, indicatorAngle);

  return (
    <div className="flex flex-col items-center rounded-3xl border border-border-subtle bg-surface px-5 pb-6 pt-5 text-center">
      <div className="relative flex w-full max-w-[280px] flex-col items-center">
        <svg
          viewBox="0 0 260 154"
          className="h-auto w-full overflow-visible"
          role="img"
          aria-label={`Readiness ${pct.toFixed(0)} por ciento: ${label}`}
        >
          {segments.map((seg, idx) => {
            const active = pct >= seg.threshold - 19;
            return (
              <path
                key={idx}
                d={describeArc(130, 128, 96, seg.start, seg.end)}
                fill="none"
                stroke="currentColor"
                strokeWidth="16"
                strokeLinecap="round"
                className={active ? TEXT_TONE_CLASS[tone] : "text-border-strong"}
                opacity={active ? 0.92 : 0.45}
              />
            );
          })}
          <circle
            cx={dot.x}
            cy={dot.y}
            r="7"
            fill="currentColor"
            className="text-ink-primary"
          />
        </svg>

        <div className="-mt-16 flex flex-col items-center">
          <div className="flex items-baseline gap-0.5 tabular-nums">
            <span className="text-5xl font-bold tracking-tight text-ink-primary">
              {Math.round(pct)}
            </span>
            <span className="text-lg font-semibold text-ink-secondary">%</span>
          </div>
          <p className={`mt-1 text-sm font-semibold ${TEXT_TONE_CLASS[tone]}`}>{label}</p>
          {badge ? (
            <span className={`mt-2 rounded-full border px-2.5 py-0.5 text-xs font-medium tabular-nums ${PILL_TONE_CLASS[tone]}`}>
              {badge}
            </span>
          ) : null}
        </div>
      </div>

      <p className="mt-4 max-w-md text-xs leading-relaxed text-ink-secondary tabular-nums">
        {summary}
      </p>
    </div>
  );
}

export function MetricSparkTile({
  title,
  value,
  unit,
  sublabel,
  series,
  tone = "neutral",
  tag,
}: {
  title: string;
  value: string;
  unit?: string;
  sublabel?: string;
  series: readonly number[];
  tone?: AccentTone;
  tag?: string;
}) {
  const safeSeries = series.length >= 2 ? series : [0, 0];
  const min = Math.min(...safeSeries);
  const max = Math.max(...safeSeries);
  const span = Math.max(max - min, 1e-6);
  const coords = safeSeries.map((v, i) => {
    const x = 6 + (i / (safeSeries.length - 1)) * 68;
    const y = 30 - ((v - min) / span) * 24;
    return { x, y };
  });
  const polyline = coords.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const last = coords[coords.length - 1] ?? { x: 74, y: 18 };

  return (
    <article className="flex flex-col justify-between rounded-2xl border border-border-subtle bg-surface p-4 pt-motion-gpu motion-reduce:transform-none hover:border-border-strong">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-ink-secondary">{title}</p>
        <svg viewBox="0 0 80 36" className="h-9 w-20 shrink-0" aria-hidden="true">
          <polyline
            points={polyline}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-border-strong"
          />
          {coords.slice(0, -1).map((pt, idx) => (
            <circle
              key={idx}
              cx={pt.x}
              cy={pt.y}
              r="2.2"
              fill="currentColor"
              className="text-ink-secondary/60"
            />
          ))}
          <circle
            cx={last.x}
            cy={last.y}
            r="3.2"
            fill="currentColor"
            className={TEXT_TONE_CLASS[tone]}
          />
        </svg>
      </div>

      <div className="mt-2 flex items-end justify-between gap-2">
        <div>
          <p className="text-2xl font-semibold tracking-tight text-ink-primary tabular-nums">
            {value}
            {unit ? <span className="ml-1 text-xs font-normal text-ink-secondary">{unit}</span> : null}
          </p>
          {sublabel ? (
            <p className="mt-0.5 text-xs text-ink-secondary tabular-nums">{sublabel}</p>
          ) : null}
        </div>
        {tag ? (
          <span className={`rounded-lg border px-2 py-1 text-xs font-semibold tabular-nums ${PILL_TONE_CLASS[tone]}`}>
            {tag}
          </span>
        ) : null}
      </div>
    </article>
  );
}

export function SegmentedLedBar({
  percent,
  segments = 16,
  tone = "recovery",
  label,
}: {
  percent: number;
  segments?: number;
  tone?: AccentTone;
  label?: string;
}) {
  const pct = clampPct(percent);
  const filled = Math.round((pct / 100) * segments);

  return (
    <div
      className="flex items-center gap-1"
      role="progressbar"
      aria-label={label ?? "Indicador segmentado"}
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      {Array.from({ length: segments }, (_, index) => {
        const isActive = index < filled;
        return (
          <span
            key={index}
            className={`h-2.5 flex-1 rounded-sm ${
              isActive ? BG_TONE_CLASS[tone] : "bg-border-strong/50"
            }`}
          />
        );
      })}
    </div>
  );
}

export function ConsistencyPills30d({
  days,
  goalLabel,
}: {
  days: readonly ("done" | "rest" | "today")[];
  goalLabel: string;
}) {
  const completedCount = days.filter((d) => d === "done").length;

  return (
    <section className="rounded-2xl border border-border-subtle bg-surface p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-ink-secondary">
          Ultimos 30 dias
        </p>
        <p className="text-xs font-medium text-ink-secondary tabular-nums">
          {completedCount} sesiones · {goalLabel}
        </p>
      </div>
      <div className="grid grid-cols-10 gap-1.5" role="list" aria-label="Consistencia de entrenamiento 30 dias">
        {days.slice(0, 30).map((status, idx) => {
          const pillClass =
            status === "done"
              ? "bg-ink-primary border-ink-primary"
              : status === "today"
                ? "bg-void border-2 border-accent-strain"
                : "bg-void border border-dashed border-border-strong";
          return (
            <span
              key={idx}
              role="listitem"
              aria-label={`Dia ${idx + 1}: ${status}`}
              className={`h-4 rounded-full ${pillClass}`}
            />
          );
        })}
      </div>
    </section>
  );
}

export function RadialGaugeRing({
  percent,
  value,
  caption,
  tone = "strain",
  footer,
}: {
  percent: number;
  value: string;
  caption: string;
  tone?: AccentTone;
  footer?: ReactNode;
}) {
  const pct = clampPct(percent);
  const start = -130;
  const sweep = 260;
  const activeEnd = start + (pct / 100) * sweep;

  return (
    <div className="flex flex-col items-center rounded-2xl border border-border-subtle bg-surface p-4 text-center">
      <div className="relative h-28 w-28">
        <svg viewBox="0 0 120 120" className="h-full w-full" aria-hidden="true">
          <path
            d={describeArc(60, 60, 46, start, start + sweep)}
            fill="none"
            stroke="currentColor"
            strokeWidth="10"
            strokeLinecap="round"
            className="text-border-strong/60"
          />
          {pct > 0 ? (
            <path
              d={describeArc(60, 60, 46, start, activeEnd)}
              fill="none"
              stroke="currentColor"
              strokeWidth="10"
              strokeLinecap="round"
              className={TEXT_TONE_CLASS[tone]}
            />
          ) : null}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-lg font-bold text-ink-primary tabular-nums">{value}</span>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-secondary">
            {caption}
          </span>
        </div>
      </div>
      {footer ? <div className="mt-2 w-full">{footer}</div> : null}
    </div>
  );
}
