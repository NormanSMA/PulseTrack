"use client";

import { useMemo, useRef, useState, type KeyboardEvent } from "react";
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
    "bg-ink-primary/25 border-ink-primary/40",
    "bg-ink-primary/45 border-ink-primary/60",
    "bg-ink-primary/70 border-ink-primary/80",
    "bg-ink-primary border-ink-primary",
  ],
  gym: [
    "bg-elevated border-border-subtle",
    "bg-accent-sleep/25 border-accent-sleep/40",
    "bg-accent-sleep/45 border-accent-sleep/60",
    "bg-accent-sleep/75 border-accent-sleep/85",
    "bg-accent-sleep border-accent-sleep",
  ],
  routes: [
    "bg-elevated border-border-subtle",
    "bg-accent-strain/25 border-accent-strain/40",
    "bg-accent-strain/45 border-accent-strain/60",
    "bg-accent-strain/75 border-accent-strain/85",
    "bg-accent-strain border-accent-strain",
  ],
  macros: [
    "bg-elevated border-border-subtle",
    "bg-accent-alert/25 border-accent-alert/40",
    "bg-accent-alert/45 border-accent-alert/60",
    "bg-accent-alert/75 border-accent-alert/85",
    "bg-accent-alert border-accent-alert",
  ],
  recovery: [
    "bg-elevated border-border-subtle",
    "bg-accent-recovery/25 border-accent-recovery/40",
    "bg-accent-recovery/45 border-accent-recovery/60",
    "bg-accent-recovery/75 border-accent-recovery/85",
    "bg-accent-recovery border-accent-recovery",
  ],
};

const ROWS_PER_WEEK = 7;

function resolveDayScore(day: HeatmapDay, filter: HeatmapFilter): number {
  if (filter === "all") {
    return Math.round((day.gym + day.routes + day.macros + day.recovery) / 4);
  }
  return day[filter];
}

export function BiometricHeatmap() {
  const days = useMemo(() => buildMockHeatmapDays(), []);
  const totalDays = days.length;
  const totalWeeks = Math.ceil(totalDays / ROWS_PER_WEEK);

  const [filter, setFilter] = useState<HeatmapFilter>("all");
  const [selectedIndex, setSelectedIndex] = useState<number>(Math.max(0, totalDays - 1));
  const cellRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const selectedDay = days[selectedIndex] ?? null;

  const activeDaysCount = useMemo(
    () => days.filter((day) => resolveDayScore(day, filter) > 0).length,
    [days, filter],
  );

  const rows = useMemo(() => {
    return Array.from({ length: ROWS_PER_WEEK }, (_, rowIdx) =>
      Array.from({ length: totalWeeks }, (__, colIdx) => {
        const dayIndex = colIdx * ROWS_PER_WEEK + rowIdx;
        const day = days[dayIndex];
        return day ? { day, dayIndex } : null;
      }).filter((entry): entry is { day: HeatmapDay; dayIndex: number } => entry !== null),
    );
  }, [days, totalWeeks]);

  const palette = LEVEL_CLASSES[filter];

  function focusAndSelect(nextIndex: number) {
    const clamped = Math.max(0, Math.min(totalDays - 1, nextIndex));
    setSelectedIndex(clamped);
    cellRefs.current[clamped]?.focus();
  }

  function handleCellKeyDown(event: KeyboardEvent<HTMLButtonElement>, currentIndex: number) {
    const row = currentIndex % ROWS_PER_WEEK;
    let targetIndex: number | null = null;

    switch (event.key) {
      case "ArrowRight":
        targetIndex = currentIndex + ROWS_PER_WEEK;
        break;
      case "ArrowLeft":
        targetIndex = currentIndex - ROWS_PER_WEEK;
        break;
      case "ArrowDown":
        targetIndex = currentIndex + 1;
        break;
      case "ArrowUp":
        targetIndex = currentIndex - 1;
        break;
      case "Home":
        targetIndex = row;
        break;
      case "End":
        targetIndex = (totalWeeks - 1) * ROWS_PER_WEEK + row;
        break;
      default:
        return;
    }

    event.preventDefault();
    if (targetIndex >= 0 && targetIndex < totalDays) {
      focusAndSelect(targetIndex);
    }
  }

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
            {activeDaysCount} de {totalDays} días con registro activo
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
                className={`min-h-11 rounded-full border px-3.5 text-xs font-semibold tracking-wide pt-motion-gpu active:scale-95 motion-reduce:transform-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-primary ${
                  active
                    ? option.activeClass
                    : "border-border-strong bg-void text-ink-primary hover:border-ink-primary hover:bg-elevated"
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={selectedIndex <= 0}
          aria-label="Día anterior en heatmap"
          onClick={() => setSelectedIndex((prev) => Math.max(0, prev - 1))}
          className="min-h-11 min-w-11 rounded-xl border border-border-strong bg-void px-3 text-xs font-semibold text-ink-primary pt-motion-gpu hover:border-ink-primary hover:bg-elevated active:scale-95 motion-reduce:transform-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-primary disabled:cursor-not-allowed disabled:opacity-40"
        >
          Anterior
        </button>

        <label htmlFor="heatmap-date-select" className="sr-only">
          Seleccionar fecha del heatmap
        </label>
        <select
          id="heatmap-date-select"
          value={selectedIndex}
          onChange={(event) => setSelectedIndex(Number(event.target.value))}
          className="min-h-11 rounded-xl border border-border-strong bg-void px-3 text-xs font-medium text-ink-primary tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-primary"
        >
          {days.map((day, idx) => (
            <option key={day.date} value={idx}>
              {day.date} · nivel {resolveDayScore(day, filter)}/4
            </option>
          ))}
        </select>

        <button
          type="button"
          disabled={selectedIndex >= totalDays - 1}
          aria-label="Día siguiente en heatmap"
          onClick={() => setSelectedIndex((prev) => Math.min(totalDays - 1, prev + 1))}
          className="min-h-11 min-w-11 rounded-xl border border-border-strong bg-void px-3 text-xs font-semibold text-ink-primary pt-motion-gpu hover:border-ink-primary hover:bg-elevated active:scale-95 motion-reduce:transform-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-primary disabled:cursor-not-allowed disabled:opacity-40"
        >
          Siguiente
        </button>
      </div>

      <div className="mt-4 overflow-x-auto pb-2">
        <div
          className="flex w-max flex-col gap-1"
          role="grid"
          aria-label="Matriz anual de consistencia biométrica"
        >
          {rows.map((rowCells, rowIdx) => (
            <div key={rowIdx} role="row" className="flex gap-1">
              {rowCells.map(({ day, dayIndex }) => {
                const level = resolveDayScore(day, filter);
                const cellColor = palette[level] ?? palette[0];
                const isSelected = selectedIndex === dayIndex;
                return (
                  <div key={day.date} role="gridcell" aria-selected={isSelected}>
                    <button
                      ref={(el) => {
                        cellRefs.current[dayIndex] = el;
                      }}
                      type="button"
                      tabIndex={isSelected ? 0 : -1}
                      onClick={() => setSelectedIndex(dayIndex)}
                      onKeyDown={(event) => handleCellKeyDown(event, dayIndex)}
                      aria-label={`${day.date}: nivel ${level} en ${filter}`}
                      aria-pressed={isSelected}
                      className={`block h-3 w-3 rounded-[3px] border pt-motion-gpu motion-reduce:transition-none motion-reduce:transform-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-primary ${cellColor} ${
                        isSelected
                          ? "scale-125 ring-1 ring-ink-primary"
                          : "hover:scale-110"
                      }`}
                    />
                  </div>
                );
              })}
            </div>
          ))}
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
