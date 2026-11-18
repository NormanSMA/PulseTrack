import { ROUTES_PREVIEW } from "@/lib/mock-data";

export default function RoutesPage() {
  return (
    <div className="space-y-6">
      <header className="border-b border-border-subtle pb-5">
        <p className="text-xs font-semibold uppercase tracking-widest text-accent-strain">
          Routes · MapLibre 2D/3D + PostGIS
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink-primary sm:text-3xl">
          Rutas GPX y Ritmo GAP
        </h1>
      </header>

      <section
        aria-label="Contenedor de mapa 2D/3D"
        className="flex min-h-64 flex-col justify-between rounded-2xl border border-accent-strain/40 bg-surface p-5"
      >
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-accent-strain">
            Viewport WebGL (LineStringZ EPSG:4326)
          </span>
          <span className="text-xs text-ink-secondary tabular-nums">
            Objetivo &lt; 16 ms (ADR-003 · benchmark en Fase 3)
          </span>
        </div>
        <p className="my-8 text-center text-sm text-ink-secondary">
          Canvas MapLibre GL JS listo para montaje en Fase 3 (sin datos en vivo aún).
        </p>
        <div className="flex flex-wrap gap-4 border-t border-border-subtle pt-3 text-xs text-ink-secondary tabular-nums">
          <span>Índice espacial: GIST</span>
          <span>Métrica primaria: Grade Adjusted Pace (GAP)</span>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2" aria-label="Rutas recientes">
        {ROUTES_PREVIEW.map((route) => (
          <article
            key={route.id}
            className="rounded-2xl border border-border-subtle bg-surface p-5"
          >
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-ink-primary">{route.name}</h2>
              <span className="text-xs text-ink-secondary">{route.source}</span>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-3 text-xs tabular-nums">
              <div>
                <p className="text-ink-secondary">Distancia</p>
                <p className="mt-1 text-lg font-semibold text-ink-primary">
                  {route.distanceKm} km
                </p>
              </div>
              <div>
                <p className="text-ink-secondary">Desnivel</p>
                <p className="mt-1 text-lg font-semibold text-ink-primary">
                  +{route.elevationGainM} m
                </p>
              </div>
              <div>
                <p className="text-ink-secondary">GAP</p>
                <p className="mt-1 text-lg font-semibold text-accent-strain">{route.gapPace}</p>
              </div>
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
