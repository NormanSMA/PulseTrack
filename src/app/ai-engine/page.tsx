import { AI_TELEMETRY_PREVIEW } from "@/lib/mock-data";

export default function AiEnginePage() {
  return (
    <div className="space-y-6">
      <header className="border-b border-border-subtle pb-5">
        <p className="text-xs font-semibold uppercase tracking-widest text-accent-alert">
          AI Engine · Cloud + ONNX + Scriptable
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink-primary sm:text-3xl">
          Enrutador Híbrido y Telemetría
        </h1>
      </header>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <article className="rounded-2xl border border-accent-recovery/40 bg-surface p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-secondary">
            Readiness ONNX
          </p>
          <p className="mt-3 text-3xl font-semibold text-accent-recovery tabular-nums">
            86.4 <span className="text-xs font-normal text-ink-secondary">/ 100</span>
          </p>
        </article>
        <article className="rounded-2xl border border-accent-strain/40 bg-surface p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-secondary">
            ACWR (Carga Aguda / Crónica)
          </p>
          <p className="mt-3 text-3xl font-semibold text-ink-primary tabular-nums">1.080</p>
        </article>
        <article className="rounded-2xl border border-border-subtle bg-surface p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-secondary">
            Widget Scriptable
          </p>
          <p className="mt-3 text-sm font-medium text-ink-primary tabular-nums">
            JSON AMOLED listo · cache 15 min
          </p>
        </article>
      </section>

      <section className="rounded-2xl border border-border-subtle bg-surface p-5">
        <h2 className="text-base font-semibold text-ink-primary">
          Telemetría de proveedores (`ai_telemetry_logs`)
        </h2>
        <div className="mt-4 divide-y divide-border-subtle">
          {AI_TELEMETRY_PREVIEW.map((entry) => (
            <div
              key={entry.id}
              className="flex flex-wrap items-center justify-between gap-2 py-3 text-xs tabular-nums"
            >
              <div>
                <span className="font-semibold text-ink-primary">{entry.provider}</span>{" "}
                <span className="text-ink-secondary">· {entry.model}</span>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-ink-secondary">{entry.latencyMs} ms</span>
                <span className="font-semibold text-accent-recovery">{entry.status}</span>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
