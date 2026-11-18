"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type LiveIslandState = "idle" | "syncing" | "gym-timer" | "alert";

interface LiveIslandContextValue {
  state: LiveIslandState;
  setState: (next: LiveIslandState) => void;
  timerSeconds: number;
  resetTimer: (seconds?: number) => void;
  announcement: string;
}

const LiveIslandContext = createContext<LiveIslandContextValue | null>(null);

const STATE_META: Record<
  LiveIslandState,
  {
    badge: string;
    title: string;
    detail: string;
    announcement: string;
    dotClass: string;
    borderClass: string;
    textClass: string;
  }
> = {
  idle: {
    badge: "READY",
    title: "PulseTrack 144Hz",
    detail: "Recovery 86%",
    announcement: "LiveIsland en reposo: Recovery 86 por ciento.",
    dotClass: "bg-accent-recovery",
    borderClass: "border-border-strong",
    textClass: "text-accent-recovery",
  },
  syncing: {
    badge: "SYNC",
    title: "Garmin + RENPHO",
    detail: "Cache 15m · idb",
    announcement: "Sincronización inalámbrica con Garmin y RENPHO iniciada.",
    dotClass: "bg-accent-strain pt-pulse-opacity",
    borderClass: "border-accent-strain/70",
    textClass: "text-accent-strain",
  },
  "gym-timer": {
    badge: "REST",
    title: "Descanso activo",
    detail: "Hevy Set #4",
    announcement: "Temporizador de descanso iniciado.",
    dotClass: "bg-accent-sleep pt-pulse-opacity",
    borderClass: "border-accent-sleep/70",
    textClass: "text-accent-sleep",
  },
  alert: {
    badge: "ALERT",
    title: "ACWR 1.38 elevado",
    detail: "Reducir carga hoy",
    announcement: "Alerta de carga: ACWR 1.38 elevado.",
    dotClass: "bg-accent-alert pt-pulse-opacity",
    borderClass: "border-accent-alert/80",
    textClass: "text-accent-alert",
  },
};

function formatClock(totalSeconds: number): string {
  const safe = Math.max(0, totalSeconds);
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

export function LiveIslandProvider({ children }: { children: ReactNode }) {
  const [state, setStateRaw] = useState<LiveIslandState>("idle");
  const [timerSeconds, setTimerSeconds] = useState<number>(90);
  const [announcement, setAnnouncement] = useState<string>(STATE_META.idle.announcement);

  const setState = useCallback((next: LiveIslandState) => {
    setStateRaw(next);
    setAnnouncement(STATE_META[next].announcement);
  }, []);

  useEffect(() => {
    if (state !== "gym-timer") return;
    const intervalId = window.setInterval(() => {
      setTimerSeconds((prev) => {
        if (prev <= 0) return 0;
        if (prev === 1) {
          setAnnouncement("Descanso completado.");
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, [state]);

  const resetTimer = useCallback((seconds = 90) => {
    setTimerSeconds(seconds);
  }, []);

  const value = useMemo<LiveIslandContextValue>(
    () => ({ state, setState, timerSeconds, resetTimer, announcement }),
    [state, setState, timerSeconds, resetTimer, announcement],
  );

  return (
    <LiveIslandContext.Provider value={value}>
      {children}
    </LiveIslandContext.Provider>
  );
}

export function useLiveIsland(): LiveIslandContextValue {
  const ctx = useContext(LiveIslandContext);
  if (!ctx) {
    throw new Error("useLiveIsland must be used inside LiveIslandProvider");
  }
  return ctx;
}

export function LiveIsland() {
  const { state, setState, timerSeconds, announcement } = useLiveIsland();
  const [visible, setVisible] = useState<boolean>(true);
  const [displayState, setDisplayState] = useState<LiveIslandState>(state);
  const [isTransitioning, setIsTransitioning] = useState<boolean>(false);

  useEffect(() => {
    if (state === displayState) return;
    setIsTransitioning(true);
    setVisible(false);
    const frameId = window.requestAnimationFrame(() => {
      setDisplayState(state);
      setVisible(true);
    });
    const endTimer = window.setTimeout(() => {
      setIsTransitioning(false);
    }, 200);
    return () => {
      window.cancelAnimationFrame(frameId);
      window.clearTimeout(endTimer);
    };
  }, [state, displayState]);

  const meta = STATE_META[displayState];
  const rightValue =
    displayState === "gym-timer" ? formatClock(timerSeconds) : meta.detail;

  return (
    <>
      <div className="sr-only" role="status" aria-live="polite">
        {announcement}
      </div>

      <div className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div
          className={`pointer-events-auto flex min-h-11 w-[min(92vw,25rem)] items-center justify-between gap-2 rounded-full border bg-surface px-4 pt-motion-gpu motion-reduce:transition-none motion-reduce:transform-none ${
            isTransitioning ? "will-change-[transform,opacity]" : ""
          } ${meta.borderClass} ${
            visible
              ? "[transform:translate3d(0,0,0)_scale(1)] opacity-100"
              : "[transform:translate3d(0,-4px,0)_scale(0.96)] opacity-0"
          }`}
        >
          <div className="flex min-w-0 items-center gap-2.5">
            <span
              className={`h-2.5 w-2.5 shrink-0 rounded-full ${meta.dotClass}`}
              aria-hidden="true"
            />
            <span
              className={`text-xs font-semibold tracking-wider tabular-nums ${meta.textClass}`}
            >
              {meta.badge}
            </span>
            <span className="truncate text-sm font-medium text-ink-primary tabular-nums">
              {meta.title}
            </span>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <span className="font-mono text-xs font-semibold text-ink-secondary tabular-nums">
              {rightValue}
            </span>
            {displayState === "gym-timer" ? (
              <button
                type="button"
                aria-label="Detener temporizador"
                onClick={() => setState("idle")}
                className="flex min-h-11 min-w-11 items-center justify-center rounded-full px-2 text-xs font-semibold text-accent-alert pt-motion-gpu hover:text-ink-primary active:scale-95 motion-reduce:transform-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-primary"
              >
                Stop
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </>
  );
}

const TEST_STATES: readonly { id: LiveIslandState; label: string }[] = [
  { id: "idle", label: "Idle" },
  { id: "syncing", label: "Syncing" },
  { id: "gym-timer", label: "Gym Timer" },
  { id: "alert", label: "Alert" },
];

export function LiveIslandControls() {
  const { state, setState, resetTimer } = useLiveIsland();

  return (
    <div
      className="flex flex-wrap items-center gap-2"
      role="group"
      aria-label="Controles de estado para LiveIsland"
    >
      {TEST_STATES.map((item) => {
        const active = state === item.id;
        return (
          <button
            key={item.id}
            type="button"
            aria-pressed={active}
            onClick={() => {
              if (item.id === "gym-timer") {
                resetTimer(90);
              }
              setState(item.id);
            }}
            className={`min-h-11 rounded-full border px-4 text-xs font-semibold uppercase tracking-wider pt-motion-gpu active:scale-95 motion-reduce:transform-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-primary disabled:cursor-not-allowed disabled:opacity-40 ${
              active
                ? "border-ink-primary bg-ink-primary text-void"
                : "border-border-strong bg-surface text-ink-primary hover:border-ink-primary hover:bg-elevated"
            }`}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
