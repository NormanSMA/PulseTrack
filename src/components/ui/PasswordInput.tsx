"use client";

import { useState, type ChangeEvent } from "react";
import { EyeIcon, EyeOffIcon } from "@/components/ui/Icons";

interface PasswordInputProps {
  id: string;
  name?: string;
  label: string;
  value: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  autoComplete?: string;
  disabled?: boolean;
  loading?: boolean;
  required?: boolean;
  error?: string;
}

export function PasswordInput({
  id,
  name,
  label,
  value,
  onChange,
  placeholder = "••••••••••••",
  autoComplete = "current-password",
  disabled = false,
  loading = false,
  required = false,
  error,
}: PasswordInputProps) {
  const [visible, setVisible] = useState<boolean>(false);
  const isDisabled = disabled || loading;

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-xs font-semibold uppercase tracking-wider text-ink-secondary">
        {label}
      </label>

      <div className="relative flex items-center">
        <input
          id={id}
          name={name ?? id}
          type={visible ? "text" : "password"}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          autoComplete={autoComplete}
          disabled={isDisabled}
          required={required}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
          className={`min-h-11 w-full rounded-xl border bg-void px-4 pr-12 text-sm text-ink-primary placeholder:text-ink-secondary/60 pt-motion-gpu focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-primary disabled:cursor-not-allowed disabled:opacity-50 ${
            error
              ? "border-accent-danger"
              : "border-border-strong hover:border-ink-primary/60"
          }`}
        />

        <button
          type="button"
          disabled={isDisabled}
          aria-label={visible ? "Ocultar contraseña" : "Mostrar contraseña"}
          aria-pressed={visible}
          onClick={() => setVisible((prev) => !prev)}
          className="absolute right-0 flex min-h-11 min-w-11 items-center justify-center rounded-xl text-ink-secondary pt-motion-gpu hover:text-ink-primary active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-primary disabled:cursor-not-allowed disabled:opacity-40"
        >
          {visible ? <EyeOffIcon className="h-5 w-5" /> : <EyeIcon className="h-5 w-5" />}
        </button>
      </div>

      {error ? (
        <p id={`${id}-error`} className="text-xs font-medium text-accent-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
