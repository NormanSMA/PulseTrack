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
}

const LiveIslandContext = createContext<LiveIslandContextValue | null>(null);

const STATE_META: Record<
  LiveIslandState,
  {
    badge: string;
    title: string;
    detail: string;
    dotClass: string;
    borderClass: string;
    textClass: string;
  }
> = {
  idle: {
    badge: "READY",
    title: "PulseTrack 144Hz",
    detail: "Recovery 86%",
    dotClass: "bg-accent-recovery",
    borderClass: "border-border-strong",
    textClass: "text-accent-recovery",
  },
  syncing: {
    badge: "SYNC",
    title: "Garmin + RENPHO",
    detail: "Cache 15m · idb",
    dotClass: "bg-accent-strain pt-pulse-opacity",
    borderClass: "border-accent-strain/50",
    textClass: "text-accent-strain",
  },
  "gym-timer": {
    badge: "REST",
    title: "Descanso activo",
    detail: "Hevy Set #4",
    dotClass: "bg-accent-sleep pt-pulse-opacity",
    borderClass: "border-accent-sleep/50",
    textClass: "text-accent-sleep",
  },
  alert: {
    badge: "ALERT",
    title: "ACWR 1.38 elevado",
    detail: "Reducir carga hoy",
    dotClass: "bg-accent-alert pt-pulse-opacity",
    borderClass: "border-accent-alert/60",
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
  const [state, setState] = useState<LiveIslandState>("idle");
  const [timerSeconds, setTimerSeconds] = useState<number>(90);

  useEffect(() => {
    if (state !== "gym-timer") return;
    const intervalId = window.setInterval(() => {
      setTimerSeconds((prev) => (prev > 0 ? prev - 1 : 90));
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, [state]);

  const resetTimer = useCallback((seconds = 90) => {
    setTimerSeconds(seconds);
  }, []);

  const value = useMemo<LiveIslandContextValue>(
    () => ({ state, setState, timerSeconds, resetTimer }),
    [state, timerSeconds, resetTimer],
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
  const { state, timerSeconds } = useLiveIsland();
  const [visible, setVisible] = useState<boolean>(true);
  const [displayState, setDisplayState] = useState<LiveIslandState>(state);

  useEffect(() => {
    if (state === displayState) return;
    setVisible(false);
    const frameId = window.requestAnimationFrame(() => {
      setDisplayState(state);
      setVisible(true);
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [state, displayState]);

  const meta = STATE_META[displayState];
  const rightValue =
    displayState === "gym-timer" ? formatClock(timerSeconds) : meta.detail;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center pt-[max(0.75rem,env(safe-area-inset-top))]"
      role="status"
      aria-live="polite"
    >
      <div
        className={`pointer-events-auto flex h-11 w-[min(92vw,24rem)] items-center justify-between rounded-full border bg-surface/95 px-4 backdrop-blur-md pt-motion-gpu motion-reduce:transition-none ${meta.borderClass} ${
          visible
            ? "translate-y-0 scale-100 opacity-100"
            : "-translate-y-1 scale-95 opacity-0"
        }`}
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className={`h-2.5 w-2.5 shrink-0 rounded-full pt-motion-gpu ${meta.dotClass}`}
            aria-hidden="true"
          />
          <span
            className={`text-xs font-semibold tracking-wider tabular-nums ${meta.textClass}`}
          >
            {meta.badge}
          </span>
          <span className="truncate text-sm font-medium text-ink-primary">
            {meta.title}
          </span>
        </div>
        <span className="ml-3 shrink-0 font-mono text-xs font-semibold text-ink-secondary tabular-nums">
          {rightValue}
        </span>
      </div>
    </div>
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
            className={`min-h-11 rounded-full border px-4 text-xs font-semibold uppercase tracking-wider pt-motion-gpu active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-primary disabled:cursor-not-allowed disabled:opacity-40 ${
              active
                ? "border-ink-primary bg-ink-primary text-void"
                : "border-border-strong bg-surface text-ink-primary hover:border-ink-primary/60 hover:bg-elevated"
            }`}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
