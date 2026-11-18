import { NUTRITION_MACROS } from "@/lib/mock-data";

export default function NutritionPage() {
  return (
    <div className="space-y-6">
      <header className="border-b border-border-subtle pb-5">
        <p className="text-xs font-semibold uppercase tracking-widest text-accent-recovery">
          Nutrition · Autoridad única PulseTrack
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink-primary sm:text-3xl">
          Ingesta, Macros y Portion Templates
        </h1>
      </header>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {NUTRITION_MACROS.map((macro) => {
          const pct = Math.min(100, Math.round((macro.current / macro.target) * 100));
          return (
            <article
              key={macro.id}
              className="rounded-2xl border border-border-subtle bg-surface p-5"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-secondary">
                  {macro.label}
                </h2>
                <span className="text-xs font-semibold text-accent-recovery tabular-nums">
                  {pct}%
                </span>
              </div>
              <p className="mt-3 text-2xl font-semibold text-ink-primary tabular-nums">
                {macro.current}{" "}
                <span className="text-xs font-normal text-ink-secondary">
                  / {macro.target} {macro.unit}
                </span>
              </p>
              <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-elevated">
                <div
                  className="h-full origin-left bg-ink-primary pt-motion-gpu"
                  style={{ transform: `scaleX(${pct / 100})` }}
                />
              </div>
            </article>
          );
        })}
      </section>

      <section className="rounded-2xl border border-border-subtle bg-surface p-5">
        <h2 className="text-base font-semibold text-ink-primary">
          Plantillas rápidas y búsqueda vectorial (pgvector 768)
        </h2>
        <p className="mt-2 text-xs text-ink-secondary">
          Cada registro guarda `portion_templates` en JSONB e índice HNSW coseno para sugerencias instantáneas sin duplicar gasto de Garmin.
        </p>
      </section>
    </div>
  );
}
