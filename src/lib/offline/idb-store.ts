import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type {
  BodyCompositionView,
  DailyBiometricsView,
  HevySessionSummary,
  OfflinePulseSnapshot,
  SyncMetaView,
  SyncQueueItem,
  WeatherView,
} from "@/lib/offline/types";

export const IDB_NAME = "pulsetrack-offline-v1";
export const IDB_VERSION = 1;

export const STORE_NAMES = [
  "biometrics",
  "bodyComposition",
  "hevySessions",
  "weather",
  "syncQueue",
  "meta",
] as const;

export type OfflineStoreName = (typeof STORE_NAMES)[number];

interface PulseTrackDBSchema extends DBSchema {
  biometrics: {
    key: string;
    value: DailyBiometricsView;
  };
  bodyComposition: {
    key: string;
    value: BodyCompositionView;
  };
  hevySessions: {
    key: string;
    value: HevySessionSummary;
  };
  weather: {
    key: string;
    value: WeatherView;
  };
  syncQueue: {
    key: string;
    value: SyncQueueItem;
  };
  meta: {
    key: string;
    value: SyncMetaView;
  };
}

const DEFAULT_DATE = "2026-11-18";
const DEFAULT_TIMESTAMP = "2026-11-18T06:00:00.000Z";
export const META_KEY = "sync-meta";
export const WEATHER_KEY = "current";

export function getDefaultBiometrics(): DailyBiometricsView {
  return {
    date: DEFAULT_DATE,
    recoveryScore: 86,
    recoveryDelta: "+4% vs 7d",
    hrvMs: 74,
    restingHrBpm: 48,
    strainScore: 14.2,
    acwr: 1.08,
    sleepMinutes: 462,
    sleepScore: 89,
    sleepEfficiencyPct: 92,
    activeKcal: 620,
    restingKcal: 1880,
    caloriesConsumed: 2180,
    caloriesTarget: 2500,
    bodyBattery: 82,
    stressAvg: 24,
    campTempC: 18.4,
    campPressureHpa: 1014.2,
    campActiveKcal: 0,
    subjEnergy: null,
    subjSoreness: null,
    subjMood: null,
    source: "Garmin VFC",
    updatedAt: DEFAULT_TIMESTAMP,
  };
}

export function getDefaultWeather(): WeatherView {
  return {
    id: WEATHER_KEY,
    locationName: "Managua",
    temperatureC: 27.4,
    apparentTempC: 29.1,
    humidityPct: 68,
    pressureHpa: 1012.8,
    windKmh: 11.2,
    conditionLabel: "Parcialmente nublado",
    source: "fixture",
    fetchedAt: DEFAULT_TIMESTAMP,
  };
}

export function getDefaultSyncMeta(): SyncMetaView {
  return {
    id: META_KEY,
    lastSyncAt: null,
    lastWeatherAt: null,
    lastSource: "fixture",
    lastError: null,
    pendingCount: 0,
  };
}

export function createDefaultSnapshot(): OfflinePulseSnapshot {
  return {
    biometrics: getDefaultBiometrics(),
    bodyComposition: null,
    weather: getDefaultWeather(),
    hevySessions: [],
    meta: getDefaultSyncMeta(),
    pendingQueue: [],
  };
}

interface MemoryStoreState {
  biometrics: Map<string, DailyBiometricsView>;
  bodyComposition: Map<string, BodyCompositionView>;
  hevySessions: Map<string, HevySessionSummary>;
  weather: Map<string, WeatherView>;
  syncQueue: Map<string, SyncQueueItem>;
  meta: Map<string, SyncMetaView>;
}

function createInitialMemoryState(): MemoryStoreState {
  const defaults = createDefaultSnapshot();
  const state: MemoryStoreState = {
    biometrics: new Map([[defaults.biometrics.date, defaults.biometrics]]),
    bodyComposition: new Map(),
    hevySessions: new Map(),
    weather: defaults.weather ? new Map([[defaults.weather.id, defaults.weather]]) : new Map(),
    syncQueue: new Map(),
    meta: new Map([[defaults.meta.id, defaults.meta]]),
  };
  return state;
}

let memoryState: MemoryStoreState = createInitialMemoryState();
let dbPromise: Promise<IDBPDatabase<PulseTrackDBSchema> | null> | null = null;

export function hasIndexedDB(): boolean {
  return typeof indexedDB !== "undefined";
}

async function getDB(): Promise<IDBPDatabase<PulseTrackDBSchema> | null> {
  if (!hasIndexedDB()) {
    return null;
  }
  if (!dbPromise) {
    dbPromise = openDB<PulseTrackDBSchema>(IDB_NAME, IDB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("biometrics")) {
          db.createObjectStore("biometrics", { keyPath: "date" });
        }
        if (!db.objectStoreNames.contains("bodyComposition")) {
          db.createObjectStore("bodyComposition", { keyPath: "date" });
        }
        if (!db.objectStoreNames.contains("hevySessions")) {
          db.createObjectStore("hevySessions", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("weather")) {
          db.createObjectStore("weather", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("syncQueue")) {
          db.createObjectStore("syncQueue", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("meta")) {
          db.createObjectStore("meta", { keyPath: "id" });
        }
      },
    }).catch(() => null);
  }
  return dbPromise;
}

function sortByDateDesc<T extends { date: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => b.date.localeCompare(a.date));
}

function sortQueueAsc(items: SyncQueueItem[]): SyncQueueItem[] {
  return [...items].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function readSnapshotFromMemory(): OfflinePulseSnapshot {
  const biometricsList = sortByDateDesc(Array.from(memoryState.biometrics.values()));
  const bodyList = sortByDateDesc(Array.from(memoryState.bodyComposition.values()));
  const hevyList = [...memoryState.hevySessions.values()].sort((a, b) =>
    b.date.localeCompare(a.date),
  );
  const weather = memoryState.weather.get(WEATHER_KEY) ?? getDefaultWeather();
  const pendingQueue = sortQueueAsc(Array.from(memoryState.syncQueue.values()));
  const rawMeta = memoryState.meta.get(META_KEY) ?? getDefaultSyncMeta();
  const meta: SyncMetaView = {
    ...rawMeta,
    pendingCount: pendingQueue.length,
  };

  return {
    biometrics: biometricsList[0] ?? getDefaultBiometrics(),
    bodyComposition: bodyList[0] ?? null,
    weather,
    hevySessions: hevyList,
    meta,
    pendingQueue,
  };
}

export function getSnapshotMemorySync(): OfflinePulseSnapshot {
  return readSnapshotFromMemory();
}

export function resetMemoryStoreForTests(): void {
  memoryState = createInitialMemoryState();
  dbPromise = null;
}

export async function readSnapshot(): Promise<OfflinePulseSnapshot> {
  const db = await getDB();
  if (!db) {
    return readSnapshotFromMemory();
  }

  try {
    const tx = db.transaction(
      ["biometrics", "bodyComposition", "hevySessions", "weather", "syncQueue", "meta"],
      "readonly",
    );

    const [biometricsRows, bodyRows, hevyRows, weatherRows, queueRows, metaRows] =
      await Promise.all([
        tx.objectStore("biometrics").getAll(),
        tx.objectStore("bodyComposition").getAll(),
        tx.objectStore("hevySessions").getAll(),
        tx.objectStore("weather").getAll(),
        tx.objectStore("syncQueue").getAll(),
        tx.objectStore("meta").getAll(),
      ]);

    await tx.done;

    const sortedBiometrics = sortByDateDesc(biometricsRows);
    const sortedBody = sortByDateDesc(bodyRows);
    const sortedHevy = [...hevyRows].sort((a, b) => b.date.localeCompare(a.date));
    const sortedQueue = sortQueueAsc(queueRows);
    const currentWeather =
      weatherRows.find((w) => w.id === WEATHER_KEY) ?? weatherRows[0] ?? getDefaultWeather();
    const currentMeta = metaRows.find((m) => m.id === META_KEY) ?? getDefaultSyncMeta();

    const snapshot: OfflinePulseSnapshot = {
      biometrics: sortedBiometrics[0] ?? getDefaultBiometrics(),
      bodyComposition: sortedBody[0] ?? null,
      weather: currentWeather,
      hevySessions: sortedHevy,
      meta: {
        ...currentMeta,
        pendingCount: sortedQueue.length,
      },
      pendingQueue: sortedQueue,
    };

    memoryState.biometrics.set(snapshot.biometrics.date, snapshot.biometrics);
    if (snapshot.bodyComposition) {
      memoryState.bodyComposition.set(snapshot.bodyComposition.date, snapshot.bodyComposition);
    }
    if (snapshot.weather) {
      memoryState.weather.set(snapshot.weather.id, snapshot.weather);
    }
    for (const session of snapshot.hevySessions) {
      memoryState.hevySessions.set(session.id, session);
    }
    memoryState.syncQueue = new Map(snapshot.pendingQueue.map((item) => [item.id, item]));
    memoryState.meta.set(META_KEY, snapshot.meta);

    return snapshot;
  } catch {
    return readSnapshotFromMemory();
  }
}

export async function writeSnapshotAtomic(
  patch: Partial<{
    biometrics: DailyBiometricsView;
    bodyComposition: BodyCompositionView | null;
    weather: WeatherView | null;
    hevySessions: readonly HevySessionSummary[];
    meta: SyncMetaView;
  }>,
): Promise<OfflinePulseSnapshot> {
  if (patch.biometrics) {
    memoryState.biometrics.set(patch.biometrics.date, patch.biometrics);
  }
  if (patch.bodyComposition) {
    memoryState.bodyComposition.set(patch.bodyComposition.date, patch.bodyComposition);
  }
  if (patch.weather) {
    memoryState.weather.set(patch.weather.id, patch.weather);
  }
  if (patch.hevySessions) {
    for (const session of patch.hevySessions) {
      memoryState.hevySessions.set(session.id, session);
    }
  }
  if (patch.meta) {
    memoryState.meta.set(patch.meta.id, patch.meta);
  }

  const db = await getDB();
  if (db) {
    try {
      const tx = db.transaction(
        ["biometrics", "bodyComposition", "hevySessions", "weather", "meta"],
        "readwrite",
      );
      const writes: Promise<unknown>[] = [];
      if (patch.biometrics) {
        writes.push(tx.objectStore("biometrics").put(patch.biometrics));
      }
      if (patch.bodyComposition) {
        writes.push(tx.objectStore("bodyComposition").put(patch.bodyComposition));
      }
      if (patch.weather) {
        writes.push(tx.objectStore("weather").put(patch.weather));
      }
      if (patch.hevySessions) {
        const store = tx.objectStore("hevySessions");
        for (const session of patch.hevySessions) {
          writes.push(store.put(session));
        }
      }
      if (patch.meta) {
        writes.push(tx.objectStore("meta").put(patch.meta));
      }
      await Promise.all(writes);
      await tx.done;
    } catch {
      // Fallback already persisted in memoryState
    }
  }

  return readSnapshotFromMemory();
}

export async function upsertBiometrics(entry: DailyBiometricsView): Promise<void> {
  await writeSnapshotAtomic({ biometrics: entry });
}

export async function upsertBodyComposition(entry: BodyCompositionView): Promise<void> {
  await writeSnapshotAtomic({ bodyComposition: entry });
}

export async function upsertWeather(entry: WeatherView): Promise<void> {
  await writeSnapshotAtomic({ weather: entry });
}

export async function upsertHevySessions(entries: readonly HevySessionSummary[]): Promise<void> {
  await writeSnapshotAtomic({ hevySessions: entries });
}

export async function upsertSyncMeta(meta: SyncMetaView): Promise<void> {
  await writeSnapshotAtomic({ meta });
}

export async function listQueueItems(): Promise<SyncQueueItem[]> {
  const db = await getDB();
  if (db) {
    try {
      const rows = await db.getAll("syncQueue");
      const sorted = sortQueueAsc(rows);
      memoryState.syncQueue = new Map(sorted.map((item) => [item.id, item]));
      return sorted;
    } catch {
      // Fall back to memory
    }
  }
  return sortQueueAsc(Array.from(memoryState.syncQueue.values()));
}

export async function enqueueItem(item: SyncQueueItem): Promise<void> {
  memoryState.syncQueue.set(item.id, item);
  const currentMeta = memoryState.meta.get(META_KEY) ?? getDefaultSyncMeta();
  const nextMeta: SyncMetaView = {
    ...currentMeta,
    pendingCount: memoryState.syncQueue.size,
  };
  memoryState.meta.set(META_KEY, nextMeta);

  const db = await getDB();
  if (db) {
    try {
      const tx = db.transaction(["syncQueue", "meta"], "readwrite");
      await Promise.all([
        tx.objectStore("syncQueue").put(item),
        tx.objectStore("meta").put(nextMeta),
      ]);
      await tx.done;
    } catch {
      // Memory fallback already updated
    }
  }
}

export async function updateQueueItem(item: SyncQueueItem): Promise<void> {
  await enqueueItem(item);
}

export async function removeQueueItem(id: string): Promise<void> {
  memoryState.syncQueue.delete(id);
  const currentMeta = memoryState.meta.get(META_KEY) ?? getDefaultSyncMeta();
  const nextMeta: SyncMetaView = {
    ...currentMeta,
    pendingCount: memoryState.syncQueue.size,
  };
  memoryState.meta.set(META_KEY, nextMeta);

  const db = await getDB();
  if (db) {
    try {
      const tx = db.transaction(["syncQueue", "meta"], "readwrite");
      await Promise.all([
        tx.objectStore("syncQueue").delete(id),
        tx.objectStore("meta").put(nextMeta),
      ]);
      await tx.done;
    } catch {
      // Memory fallback already updated
    }
  }
}
