"use client";

import { useLiveIsland } from "@/components/ui/LiveIsland";
import { GYM_PREVIEW } from "@/lib/mock-data";

export default function GymPage() {
  const { setState, resetTimer } = useLiveIsland();

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 border-b border-border-subtle pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-accent-sleep">
            Gym · Hevy + Lift AI + RENPHO
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink-primary sm:text-3xl">
            Fuerza y Composición Corporal
          </h1>
        </div>
        <button
          type="button"
          onClick={() => {
            resetTimer(90);
            setState("gym-timer");
          }}
          className="min-h-11 rounded-full border border-accent-sleep/60 bg-surface px-5 text-xs font-semibold uppercase tracking-wider text-accent-sleep pt-motion-gpu hover:bg-elevated active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-primary"
        >
          Iniciar descanso 01:30
        </button>
      </header>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-3" aria-label="Composición RENPHO">
        <article className="rounded-2xl border border-border-subtle bg-surface p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-secondary">
            Peso corporal (RENPHO -&gt; Garmin)
          </p>
          <p className="mt-3 text-3xl font-semibold text-ink-primary tabular-nums">
            76.4 <span className="text-xs font-normal text-ink-secondary">kg</span>
          </p>
        </article>
        <article className="rounded-2xl border border-border-subtle bg-surface p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-secondary">
            Grasa corporal
          </p>
          <p className="mt-3 text-3xl font-semibold text-ink-primary tabular-nums">
            13.8 <span className="text-xs font-normal text-ink-secondary">%</span>
          </p>
        </article>
        <article className="rounded-2xl border border-border-subtle bg-surface p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-secondary">
            Volumen sesión Hevy
          </p>
          <p className="mt-3 text-3xl font-semibold text-ink-primary tabular-nums">
            8,420 <span className="text-xs font-normal text-ink-secondary">kg</span>
          </p>
        </article>
      </section>

      <section className="rounded-2xl border border-border-subtle bg-surface p-5">
        <h2 className="text-base font-semibold text-ink-primary">Bloque activo · Lift AI</h2>
        <div className="mt-4 divide-y divide-border-subtle">
          {GYM_PREVIEW.map((ex) => (
            <div
              key={ex.id}
              className="flex flex-col gap-2 py-3.5 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <p className="text-sm font-semibold text-ink-primary">{ex.name}</p>
                <p className="text-xs text-ink-secondary">{ex.liftAiCue}</p>
              </div>
              <div className="flex items-center gap-4 text-xs text-ink-secondary tabular-nums">
                <span>{ex.sets} series</span>
                <span className="font-semibold text-ink-primary">
                  {ex.topSetKg} kg x {ex.reps}
                </span>
                <span className="text-accent-strain">RPE {ex.rpe}</span>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
