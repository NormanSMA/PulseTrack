import Link from "next/link";
import { HomeDashboardClient } from "@/components/home/HomeDashboardClient";
import { BiometricHeatmap } from "@/components/ui/BiometricHeatmap";
import { LiveIslandControls } from "@/components/ui/LiveIsland";

export default function HomePage() {
  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 border-b border-border-subtle pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-ink-secondary">
            Home · Bevel Telemetry
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink-primary sm:text-3xl">
            Resumen Biométrico Diario
          </h1>
        </div>
        <Link
          href="/login"
          className="inline-flex min-h-11 items-center justify-center rounded-full border border-border-strong bg-surface px-5 text-xs font-semibold uppercase tracking-wider text-ink-primary pt-motion-gpu hover:border-ink-primary hover:bg-elevated active:scale-95 motion-reduce:transform-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-primary"
        >
          Acceso Vault
        </Link>
      </header>

      <HomeDashboardClient />

      <section
        aria-labelledby="live-island-lab"
        className="rounded-2xl border border-border-subtle bg-surface p-5"
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 id="live-island-lab" className="text-base font-semibold text-ink-primary">
              LiveIsland 144Hz (Prueba de estados GPU)
            </h2>
            <p className="mt-1 text-xs text-ink-secondary">
              Alterna entre idle, syncing, gym-timer y alert animando solo transform y opacity.
            </p>
          </div>
          <LiveIslandControls />
        </div>
      </section>

      <BiometricHeatmap />
    </div>
  );
}
