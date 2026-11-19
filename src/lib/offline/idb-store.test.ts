import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDefaultSnapshot,
  hasIndexedDB,
  readSnapshot,
  resetMemoryStoreForTests,
  writeSnapshotAtomic,
} from "@/lib/offline/idb-store";
import {
  STALE_WINDOW_MS,
  enqueueSubjectiveCheckin,
  flushSyncQueue,
  getRemainingCooldownMs,
  importHevyCsvFile,
  isSyncStale,
  loadSnapshotInstant,
  syncIfStale,
} from "@/lib/offline/sync-queue";

const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
const originalFetch = globalThis.fetch;

function mockNavigatorOnline(online: boolean): void {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    writable: true,
    value: { onLine: online },
  });
}

describe("idb-store and sync-queue (Node/SSR fallback + SWR + offline queue)", () => {
  beforeEach(() => {
    resetMemoryStoreForTests();
    mockNavigatorOnline(true);
    vi.restoreAllMocks();
  });

  afterEach(() => {
    if (originalNavigatorDescriptor) {
      Object.defineProperty(globalThis, "navigator", originalNavigatorDescriptor);
    }
    globalThis.fetch = originalFetch;
  });

  it("falls back safely in Node/SSR where indexedDB is undefined and persists atomic writes", async () => {
    expect(hasIndexedDB()).toBe(false);

    const initial = await loadSnapshotInstant();
    const defaults = createDefaultSnapshot();
    expect(initial.biometrics.recoveryScore).toBe(defaults.biometrics.recoveryScore);
    expect(initial.biometrics.campActiveKcal).toBe(0);

    const updated = await writeSnapshotAtomic({
      biometrics: {
        ...initial.biometrics,
        recoveryScore: 91,
        campTempC: 19.2,
        campPressureHpa: 1015.4,
        campActiveKcal: 0,
      },
      meta: {
        ...initial.meta,
        lastSyncAt: "2026-11-18T12:00:00.000Z",
      },
    });

    expect(updated.biometrics.recoveryScore).toBe(91);
    expect(updated.biometrics.campTempC).toBe(19.2);
    expect(updated.meta.lastSyncAt).toBe("2026-11-18T12:00:00.000Z");

    const reread = await readSnapshot();
    expect(reread.biometrics.recoveryScore).toBe(91);
    expect(reread.meta.lastSyncAt).toBe("2026-11-18T12:00:00.000Z");
  });

  it("detects SWR stale window (> 15 min) and enforces cooldown unless forced", async () => {
    const baseMs = Date.UTC(2026, 10, 18, 12, 0, 0);
    const syncIso = new Date(baseMs).toISOString();

    expect(isSyncStale(null, baseMs)).toBe(true);
    expect(isSyncStale(syncIso, baseMs + 5 * 60 * 1000)).toBe(false);
    expect(getRemainingCooldownMs(syncIso, baseMs + 5 * 60 * 1000)).toBe(10 * 60 * 1000);
    expect(isSyncStale(syncIso, baseMs + STALE_WINDOW_MS)).toBe(true);
    expect(getRemainingCooldownMs(syncIso, baseMs + STALE_WINDOW_MS + 1000)).toBe(0);

    const initial = await readSnapshot();
    await writeSnapshotAtomic({
      meta: { ...initial.meta, lastSyncAt: syncIso },
    });

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/weather")) {
        return new Response(
          JSON.stringify({
            temperatureC: 26.5,
            humidityPct: 62,
            pressureHpa: 1013.1,
            windKmh: 9.4,
            conditionLabel: "Despejado",
            locationName: "Managua",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({
          biometrics: {
            recoveryScore: 88,
            strainScore: 12.6,
            hrvMs: 79,
            campTempC: 18.1,
            campPressureHpa: 1014.8,
            source: "Garmin VFC",
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const skipped = await syncIfStale(false, baseMs + 5 * 60 * 1000);
    expect(skipped.skippedDueToSWR).toBe(true);
    expect(skipped.synced).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();

    const staleTriggered = await syncIfStale(false, baseMs + STALE_WINDOW_MS + 1000);
    expect(staleTriggered.skippedDueToSWR).toBe(false);
    expect(staleTriggered.synced).toBe(true);
    expect(staleTriggered.snapshot.biometrics.recoveryScore).toBe(88);
    expect(staleTriggered.snapshot.weather?.temperatureC).toBe(26.5);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const forced = await syncIfStale(true, baseMs + STALE_WINDOW_MS + 2000);
    expect(forced.synced).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("queues subjective check-in optimistically while offline and flushes on reconnect", async () => {
    mockNavigatorOnline(false);

    const queuedResult = await enqueueSubjectiveCheckin({
      date: "2026-11-18",
      subjEnergy: 4,
      subjSoreness: 2,
      subjMood: 5,
    });

    expect(queuedResult.queued).toBe(true);
    expect(queuedResult.synced).toBe(false);
    expect(queuedResult.snapshot.biometrics.subjEnergy).toBe(4);
    expect(queuedResult.snapshot.biometrics.subjSoreness).toBe(2);
    expect(queuedResult.snapshot.biometrics.subjMood).toBe(5);
    expect(queuedResult.snapshot.pendingQueue).toHaveLength(1);
    expect(queuedResult.snapshot.meta.pendingCount).toBe(1);

    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    mockNavigatorOnline(true);
    const flushResult = await flushSyncQueue();

    expect(flushResult.flushed).toBe(1);
    expect(flushResult.remaining).toBe(0);
    expect(flushResult.failed).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const afterFlush = await readSnapshot();
    expect(afterFlush.pendingQueue).toHaveLength(0);
    expect(afterFlush.meta.pendingCount).toBe(0);
    expect(afterFlush.biometrics.subjEnergy).toBe(4);
  });

  it("rejects out-of-range subjective check-in scores and handles Hevy CSV import offline/online", async () => {
    await expect(
      enqueueSubjectiveCheckin({
        date: "2026-11-18",
        subjEnergy: 6,
        subjSoreness: 2,
        subjMood: 3,
      }),
    ).rejects.toThrow(/1 y 5/);

    mockNavigatorOnline(false);
    const queuedCsv = await importHevyCsvFile("title,start_time\nPush,2026-11-18", "hevy.csv");
    expect(queuedCsv.ok).toBe(true);
    expect(queuedCsv.queued).toBe(true);

    const snapshotWithCsv = await readSnapshot();
    expect(snapshotWithCsv.pendingQueue).toHaveLength(1);
    expect(snapshotWithCsv.pendingQueue[0]?.kind).toBe("hevy_csv");

    mockNavigatorOnline(true);
    globalThis.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          ok: true,
          summary: {
            sessionsCount: 1,
            exercisesCount: 4,
            setsCount: 14,
            duplicatesSkipped: 0,
            rejectedRows: 0,
          },
          sessions: [
            {
              id: "hevy-1",
              date: "2026-11-18",
              title: "Push Day",
              exercisesCount: 4,
              setsCount: 14,
              totalVolumeKg: 6420,
              durationMinutes: 58,
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    const flushResult = await flushSyncQueue();
    expect(flushResult.flushed).toBe(1);
    expect(flushResult.remaining).toBe(0);

    const afterHevyFlush = await readSnapshot();
    expect(afterHevyFlush.hevySessions).toHaveLength(1);
    expect(afterHevyFlush.hevySessions[0]?.title).toBe("Push Day");
  });
});
