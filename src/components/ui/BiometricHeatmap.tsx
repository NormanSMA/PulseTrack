"use client";

import { useMemo, useState } from "react";
import {
  buildMockHeatmapDays,
  type HeatmapDay,
  type HeatmapFilter,
} from "@/lib/mock-data";

const FILTER_OPTIONS: readonly {
  id: HeatmapFilter;
  label: string;
  activeClass: string;
}[] = [
  { id: "all", label: "All", activeClass: "border-ink-primary bg-ink-primary text-void" },
  { id: "gym", label: "Gym", activeClass: "border-accent-sleep bg-accent-sleep text-void" },
  { id: "routes", label: "Routes", activeClass: "border-accent-strain bg-accent-strain text-void" },
  { id: "macros", label: "Macros", activeClass: "border-accent-alert bg-accent-alert text-void" },
  { id: "recovery", label: "Recovery", activeClass: "border-accent-recovery bg-accent-recovery text-void" },
];

const LEVEL_CLASSES: Record<HeatmapFilter, readonly string[]> = {
  all: [
    "bg-elevated border-border-subtle",
    "bg-ink-primary/25 border-ink-primary/30",
    "bg-ink-primary/45 border-ink-primary/50",
    "bg-ink-primary/70 border-ink-primary/80",
    "bg-ink-primary border-ink-primary",
  ],
  gym: [
    "bg-elevated border-border-subtle",
    "bg-accent-sleep/25 border-accent-sleep/30",
    "bg-accent-sleep/45 border-accent-sleep/50",
    "bg-accent-sleep/75 border-accent-sleep/80",
    "bg-accent-sleep border-accent-sleep",
  ],
  routes: [
    "bg-elevated border-border-subtle",
    "bg-accent-strain/25 border-accent-strain/30",
    "bg-accent-strain/45 border-accent-strain/50",
    "bg-accent-strain/75 border-accent-strain/80",
    "bg-accent-strain border-accent-strain",
  ],
  macros: [
    "bg-elevated border-border-subtle",
    "bg-accent-alert/25 border-accent-alert/30",
    "bg-accent-alert/45 border-accent-alert/50",
    "bg-accent-alert/75 border-accent-alert/80",
    "bg-accent-alert border-accent-alert",
  ],
  recovery: [
    "bg-elevated border-border-subtle",
    "bg-accent-recovery/25 border-accent-recovery/30",
    "bg-accent-recovery/45 border-accent-recovery/50",
    "bg-accent-recovery/75 border-accent-recovery/80",
    "bg-accent-recovery border-accent-recovery",
  ],
};

function resolveDayScore(day: HeatmapDay, filter: HeatmapFilter): number {
  if (filter === "all") {
    return Math.round((day.gym + day.routes + day.macros + day.recovery) / 4);
  }
  return day[filter];
}

export function BiometricHeatmap() {
  const days = useMemo(() => buildMockHeatmapDays(), []);
  const [filter, setFilter] = useState<HeatmapFilter>("all");
  const [selectedDay, setSelectedDay] = useState<HeatmapDay | null>(
    days[days.length - 1] ?? null,
  );

  const activeDaysCount = useMemo(
    () => days.filter((day) => resolveDayScore(day, filter) > 0).length,
    [days, filter],
  );

  const palette = LEVEL_CLASSES[filter];

  return (
    <section
      aria-labelledby="heatmap-heading"
      className="rounded-2xl border border-border-subtle bg-surface p-5"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 id="heatmap-heading" className="text-base font-semibold text-ink-primary">
            Biometric Heatmap (52 semanas)
          </h2>
          <p className="mt-1 text-xs text-ink-secondary tabular-nums">
            {activeDaysCount} de {days.length} días con registro activo
          </p>
        </div>

        <div
          className="flex flex-wrap gap-2"
          role="group"
          aria-label="Filtrar heatmap biométrico"
        >
          {FILTER_OPTIONS.map((option) => {
            const active = filter === option.id;
            return (
              <button
                key={option.id}
                type="button"
                aria-pressed={active}
                onClick={() => setFilter(option.id)}
                className={`min-h-11 rounded-full border px-3.5 text-xs font-semibold tracking-wide pt-motion-gpu active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-primary ${
                  active
                    ? option.activeClass
                    : "border-border-strong bg-void text-ink-primary hover:border-ink-primary/60 hover:bg-elevated"
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-5 overflow-x-auto pb-2">
        <div
          className="grid w-max grid-flow-col grid-rows-7 gap-1"
          role="grid"
          aria-label="Matriz anual de consistencia biométrica"
        >
          {days.map((day) => {
            const level = resolveDayScore(day, filter);
            const cellColor = palette[level] ?? palette[0];
            const isSelected = selectedDay?.date === day.date;
            return (
              <button
                key={day.date}
                type="button"
                onClick={() => setSelectedDay(day)}
                aria-label={`${day.date}: nivel ${level} en ${filter}`}
                className={`h-3 w-3 rounded-[3px] border pt-motion-gpu focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-primary ${cellColor} ${
                  isSelected ? "scale-125 ring-1 ring-ink-primary" : "hover:scale-110"
                }`}
              />
            );
          })}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border-subtle pt-3 text-xs text-ink-secondary">
        <div className="tabular-nums">
          {selectedDay ? (
            <span>
              <strong className="font-semibold text-ink-primary">{selectedDay.date}</strong>{" "}
              · Gym {selectedDay.gym}/4 · Routes {selectedDay.routes}/4 · Macros{" "}
              {selectedDay.macros}/4 · Recovery {selectedDay.recovery}/4
            </span>
          ) : (
            <span>Selecciona un día para ver el desglose</span>
          )}
        </div>
        <div className="flex items-center gap-1.5" aria-hidden="true">
          <span>Menos</span>
          {palette.map((cls, idx) => (
            <span key={idx} className={`h-3 w-3 rounded-[3px] border ${cls}`} />
          ))}
          <span>Más</span>
        </div>
      </div>
    </section>
  );
}
