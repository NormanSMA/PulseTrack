"use client";

import { useState, type FormEvent } from "react";
import { PasswordInput } from "@/components/ui/PasswordInput";

export default function LoginPage() {
  const [email, setEmail] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setFeedback(null);
    window.setTimeout(() => {
      setLoading(false);
      setFeedback("Vista de autenticación lista para conectar Supabase Auth.");
    }, 350);
  }

  return (
    <div className="mx-auto max-w-md pt-4">
      <section className="rounded-2xl border border-border-strong bg-surface p-6 sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-widest text-ink-secondary">
          PulseTrack Auth
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink-primary">
          Acceso seguro
        </h1>
        <p className="mt-2 text-xs text-ink-secondary">
          Credenciales cifradas en `oauth_vault` con sesión aislada por RLS.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-5">
          <div className="flex flex-col gap-2">
            <label
              htmlFor="login-email"
              className="text-xs font-semibold uppercase tracking-wider text-ink-secondary"
            >
              Correo electrónico
            </label>
            <input
              id="login-email"
              name="email"
              type="email"
              required
              autoComplete="email"
              disabled={loading}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="norman@pulsetrack.local"
              className="min-h-11 w-full rounded-xl border border-border-strong bg-void px-4 text-sm text-ink-primary placeholder:text-ink-secondary/60 pt-motion-gpu hover:border-ink-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-primary disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>

          <PasswordInput
            id="login-password"
            label="Contraseña"
            required
            loading={loading}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />

          <button
            type="submit"
            disabled={loading}
            className="min-h-11 w-full rounded-full bg-ink-primary px-5 text-xs font-semibold uppercase tracking-wider text-void pt-motion-gpu hover:bg-ink-primary/90 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Verificando..." : "Entrar"}
          </button>

          {feedback ? (
            <p role="status" className="text-xs font-medium text-accent-recovery">
              {feedback}
            </p>
          ) : null}
        </form>
      </section>
    </div>
  );
}
