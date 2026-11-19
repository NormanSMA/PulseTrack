export type RouteSource = "gpx_upload" | "garmin";
export type RouteColorMode = "grade" | "pulse";

export interface RoutePoint {
  lon: number;
  lat: number;
  eleM: number;
  timeMs: number;
  hrBpm: number | null;
  tempC: number | null;
  cumDistM: number;
  gradePct: number;
}

export interface SegmentFeature {
  type: "Feature";
  properties: Record<string, unknown>;
  geometry: {
    type: "LineString";
    coordinates: ReadonlyArray<ReadonlyArray<number>>;
  };
}

export interface SegmentsGeoJson {
  type: "FeatureCollection";
  features: ReadonlyArray<SegmentFeature>;
}

export interface StoredRoute {
  externalId: string;
  title: string;
  activityType: string;
  source: string;
  startedAt: string;
  distanceM: number;
  elevationGainM: number;
  elevationLossM: number;
  durationSec: number;
  rawPaceSecKm: number;
  gapPaceSecKm: number;
  paHrDecouplingPct: number | null;
  thermalDriftBpm: number | null;
  avgHrBpm: number | null;
  avgTempC: number | null;
  pointsCount: number;
  simplifiedCount: number;
  points: ReadonlyArray<RoutePoint>;
  wktLineStringZ: string;
  segmentsGeoJson: SegmentsGeoJson;
  processingMs: number;
}

export interface RouteSummaryItem {
  externalId: string;
  title: string;
  activityType: string;
  source: string;
  startedAt: string;
  distanceM: number;
  elevationGainM: number;
  durationSec: number;
  gapPaceSecKm: number;
  paHrDecouplingPct: number | null;
  pointsCount: number;
}

export interface InsertRouteResult {
  route: StoredRoute;
  deduplicated: boolean;
}

interface ActorState {
  routes: Map<string, StoredRoute>;
}

interface SeedSpec {
  externalId: string;
  title: string;
  activityType: string;
  startedAt: string;
  targetDistanceM: number;
  targetGainM: number;
  pointsCount: number;
  baseEleM: number;
  baseSpeedMs: number;
  baseHrBpm: number;
  hrGradeFactor: number;
  hrDriftBpm: number;
  startTempC: number;
  endTempC: number;
  path: (t: number, scale: number) => { eastM: number; northM: number };
  origin: { lat: number; lon: number };
  profile: (t: number) => number;
}

const DEFAULT_ACTOR_KEY = "local-owner";
const ACTOR_KEY_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
export const MAX_ACTORS = 200;
export const MAX_ROUTES_PER_ACTOR = 200;

const EARTH_RADIUS_M = 6371008.8;
const SEGMENT_STRIDE = 5;
const THERMAL_BPM_PER_C = 1.5;
const MINETTI_FLAT_COST = 3.6;

const actorStates = new Map<string, ActorState>();
let seedRoutesCache: StoredRoute[] | null = null;

export function resolveActorKey(request: Request): string {
  // Almacenamiento temporal aislado por cabecera hasta enlazar Supabase Auth/RLS en despliegue.
  const headerUser = request.headers.get("x-user-id")?.trim();
  if (headerUser && ACTOR_KEY_PATTERN.test(headerUser)) {
    return headerUser;
  }
  return DEFAULT_ACTOR_KEY;
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

function minettiCost(gradeFraction: number): number {
  const g = clamp(gradeFraction, -0.45, 0.45);
  return (
    155.4 * g ** 5 -
    30.4 * g ** 4 -
    43.3 * g ** 3 +
    46.3 * g ** 2 +
    19.5 * g +
    MINETTI_FLAT_COST
  );
}

function minettiRatio(gradePct: number): number {
  return clamp(minettiCost(gradePct / 100) / MINETTI_FLAT_COST, 0.5, 3);
}

function gradeColorHex(gradePct: number): string {
  if (gradePct < -6) return "#22D3EE";
  if (gradePct < -2) return "#34D399";
  if (gradePct < 2) return "#A3E635";
  if (gradePct < 6) return "#FACC15";
  if (gradePct < 10) return "#FB923C";
  return "#EF4444";
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function offsetToLatLon(
  origin: { lat: number; lon: number },
  eastM: number,
  northM: number,
): { lat: number; lon: number } {
  const lat = origin.lat + (northM / EARTH_RADIUS_M) * (180 / Math.PI);
  const lon =
    origin.lon +
    (eastM / (EARTH_RADIUS_M * Math.cos((origin.lat * Math.PI) / 180))) * (180 / Math.PI);
  return { lat, lon };
}

function buildCoordinates(spec: SeedSpec, scale: number): Array<{ lat: number; lon: number }> {
  const coords: Array<{ lat: number; lon: number }> = [];
  for (let i = 0; i < spec.pointsCount; i += 1) {
    const t = i / (spec.pointsCount - 1);
    const offset = spec.path(t, scale);
    coords.push(offsetToLatLon(spec.origin, offset.eastM, offset.northM));
  }
  return coords;
}

interface LatLon {
  lat: number;
  lon: number;
}

const ORIGIN_FALLBACK: LatLon = { lat: 0, lon: 0 };

function at(values: readonly number[], index: number): number {
  return values[index] ?? 0;
}

function coordAt(coords: ReadonlyArray<LatLon>, index: number): LatLon {
  return coords[index] ?? ORIGIN_FALLBACK;
}

function segmentLengthM(coords: ReadonlyArray<LatLon>, index: number): number {
  const prev = coordAt(coords, index - 1);
  const cur = coordAt(coords, index);
  return haversineM(prev.lat, prev.lon, cur.lat, cur.lon);
}

function pathLengthM(coords: ReadonlyArray<LatLon>): number {
  let total = 0;
  for (let i = 1; i < coords.length; i += 1) {
    total += segmentLengthM(coords, i);
  }
  return total;
}

function buildSeedRoute(spec: SeedSpec): StoredRoute {
  let scale = 1;
  let coords = buildCoordinates(spec, scale);
  for (let pass = 0; pass < 3; pass += 1) {
    scale *= spec.targetDistanceM / pathLengthM(coords);
    coords = buildCoordinates(spec, scale);
  }
  const count = coords.length;

  const rawProfile: number[] = [];
  for (let i = 0; i < count; i += 1) {
    rawProfile.push(spec.profile(i / (count - 1)));
  }
  let rawGain = 0;
  for (let i = 1; i < count; i += 1) {
    rawGain += Math.max(0, at(rawProfile, i) - at(rawProfile, i - 1));
  }
  const eleScale = spec.targetGainM / rawGain;
  const eleM = rawProfile.map((value) => roundTo(spec.baseEleM + value * eleScale, 1));

  const cumDistM: number[] = [0];
  for (let i = 1; i < count; i += 1) {
    cumDistM.push(at(cumDistM, i - 1) + segmentLengthM(coords, i));
  }

  const gradePct: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const lo = Math.max(0, i - 1);
    const hi = Math.min(count - 1, i + 1);
    const run = at(cumDistM, hi) - at(cumDistM, lo);
    gradePct.push(run > 0 ? clamp(((at(eleM, hi) - at(eleM, lo)) / run) * 100, -30, 30) : 0);
  }

  const startMs = Date.parse(spec.startedAt);
  const timeMs: number[] = [startMs];
  const ratios: number[] = [minettiRatio(at(gradePct, 0))];
  const stepSec: number[] = [0];
  for (let i = 1; i < count; i += 1) {
    const t = i / (count - 1);
    const ratio = minettiRatio(at(gradePct, i));
    const speed = (spec.baseSpeedMs * (1 - 0.04 * t)) / ratio ** 0.7;
    const dt = (at(cumDistM, i) - at(cumDistM, i - 1)) / speed;
    ratios.push(ratio);
    stepSec.push(dt);
    timeMs.push(Math.round(at(timeMs, i - 1) + dt * 1000));
  }

  const hrBpm: number[] = [];
  const tempC: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const t = i / (count - 1);
    const jitter = 0.8 * Math.sin(i * 0.9);
    hrBpm.push(
      Math.round(
        clamp(
          spec.baseHrBpm + spec.hrGradeFactor * at(gradePct, i) + spec.hrDriftBpm * t + jitter,
          90,
          188,
        ),
      ),
    );
    tempC.push(roundTo(spec.startTempC + (spec.endTempC - spec.startTempC) * t, 1));
  }

  const points: RoutePoint[] = coords.map((coord, i) => ({
    lon: roundTo(coord.lon, 6),
    lat: roundTo(coord.lat, 6),
    eleM: at(eleM, i),
    timeMs: at(timeMs, i),
    hrBpm: at(hrBpm, i),
    tempC: at(tempC, i),
    cumDistM: roundTo(at(cumDistM, i), 1),
    gradePct: roundTo(at(gradePct, i), 2),
  }));

  const distanceM = roundTo(at(cumDistM, count - 1), 1);
  let elevationGainM = 0;
  let elevationLossM = 0;
  for (let i = 1; i < count; i += 1) {
    const delta = at(eleM, i) - at(eleM, i - 1);
    if (delta > 0) elevationGainM += delta;
    else elevationLossM -= delta;
  }

  const durationSec = (at(timeMs, count - 1) - startMs) / 1000;
  let flatEquivalentSec = 0;
  for (let i = 1; i < count; i += 1) {
    flatEquivalentSec += at(stepSec, i) / at(ratios, i);
  }
  const distanceKm = distanceM / 1000;

  const half = Math.floor(count / 2);
  const efficiency = (from: number, to: number): number => {
    let dist = 0;
    let flatSec = 0;
    for (let i = from + 1; i < to; i += 1) {
      dist += at(cumDistM, i) - at(cumDistM, i - 1);
      flatSec += at(stepSec, i) / at(ratios, i);
    }
    return dist / flatSec / mean(hrBpm.slice(from, to));
  };
  const efFirst = efficiency(0, half);
  const efSecond = efficiency(half, count);
  const paHrDecouplingPct = roundTo(((efFirst - efSecond) / efFirst) * 100, 2);

  const tempFirst = mean(tempC.slice(0, half));
  const tempSecond = mean(tempC.slice(half));

  const vertexIndexes: number[] = [];
  for (let i = 0; i < count; i += SEGMENT_STRIDE) {
    vertexIndexes.push(i);
  }
  if (vertexIndexes[vertexIndexes.length - 1] !== count - 1) {
    vertexIndexes.push(count - 1);
  }
  const features: SegmentFeature[] = [];
  for (let v = 1; v < vertexIndexes.length; v += 1) {
    const fromIndex = at(vertexIndexes, v - 1);
    const toIndex = at(vertexIndexes, v);
    const a = points[fromIndex];
    const b = points[toIndex];
    if (a === undefined || b === undefined) continue;
    const run = b.cumDistM - a.cumDistM;
    const segGrade = run > 0 ? roundTo(((b.eleM - a.eleM) / run) * 100, 2) : 0;
    features.push({
      type: "Feature",
      properties: {
        index: v - 1,
        gradePct: segGrade,
        hrBpm: Math.round(mean(hrBpm.slice(fromIndex, toIndex + 1))),
        colorHex: gradeColorHex(segGrade),
      },
      geometry: {
        type: "LineString",
        coordinates: [
          [a.lon, a.lat, a.eleM],
          [b.lon, b.lat, b.eleM],
        ],
      },
    });
  }

  const wktLineStringZ = `LINESTRING Z(${points
    .map((p) => `${p.lon} ${p.lat} ${p.eleM}`)
    .join(", ")})`;

  return {
    externalId: spec.externalId,
    title: spec.title,
    activityType: spec.activityType,
    source: "gpx_upload",
    startedAt: new Date(startMs).toISOString(),
    distanceM,
    elevationGainM: roundTo(elevationGainM, 1),
    elevationLossM: roundTo(elevationLossM, 1),
    durationSec: roundTo(durationSec, 0),
    rawPaceSecKm: roundTo(durationSec / distanceKm, 1),
    gapPaceSecKm: roundTo(flatEquivalentSec / distanceKm, 1),
    paHrDecouplingPct,
    thermalDriftBpm: roundTo((tempSecond - tempFirst) * THERMAL_BPM_PER_C, 1),
    avgHrBpm: roundTo(mean(hrBpm), 1),
    avgTempC: roundTo(mean(tempC), 1),
    pointsCount: count,
    simplifiedCount: vertexIndexes.length,
    points,
    wktLineStringZ,
    segmentsGeoJson: { type: "FeatureCollection", features },
    processingMs: 1,
  };
}

const MASAYA_SPEC: SeedSpec = {
  externalId: "seed:circuito-volcan-masaya",
  title: "Circuito Volcan Masaya",
  activityType: "running",
  startedAt: "2026-11-08T12:30:00.000Z",
  targetDistanceM: 12480,
  targetGainM: 412,
  pointsCount: 300,
  baseEleM: 330,
  baseSpeedMs: 2.95,
  baseHrBpm: 146,
  hrGradeFactor: 1.6,
  hrDriftBpm: 14,
  startTempC: 26.4,
  endTempC: 31.2,
  origin: { lat: 11.984, lon: -86.161 },
  path: (t, scale) => {
    const theta = 2 * Math.PI * t;
    const radius = 1986 * scale * (1 + 0.18 * Math.sin(3 * theta) + 0.08 * Math.cos(5 * theta));
    return { eastM: radius * Math.cos(theta) - 1986 * scale, northM: radius * Math.sin(theta) };
  },
  profile: (t) =>
    0.5 * (1 - Math.cos(4 * Math.PI * t)) +
    0.25 * Math.sin(Math.PI * t) +
    0.02 * Math.sin(2 * Math.PI * 11 * t),
};

const MOMBACHO_SPEC: SeedSpec = {
  externalId: "seed:ascenso-volcan-mombacho",
  title: "Ascenso Volcan Mombacho",
  activityType: "hiking",
  startedAt: "2026-11-14T13:10:00.000Z",
  targetDistanceM: 8600,
  targetGainM: 520,
  pointsCount: 300,
  baseEleM: 640,
  baseSpeedMs: 1.45,
  baseHrBpm: 128,
  hrGradeFactor: 2.2,
  hrDriftBpm: 10,
  startTempC: 27.8,
  endTempC: 21.9,
  origin: { lat: 11.8145, lon: -85.984 },
  path: (t, scale) => ({
    eastM: scale * (2900 * t + 260 * Math.sin(10 * Math.PI * t)),
    northM: scale * (2300 * t + 180 * Math.sin(6 * Math.PI * t)),
  }),
  profile: (t) => t + 0.03 * Math.sin(2 * Math.PI * 9 * t),
};

function getSeedRoutes(): StoredRoute[] {
  if (seedRoutesCache === null) {
    seedRoutesCache = [buildSeedRoute(MASAYA_SPEC), buildSeedRoute(MOMBACHO_SPEC)];
  }
  return seedRoutesCache;
}

function summarize(route: StoredRoute): RouteSummaryItem {
  return {
    externalId: route.externalId,
    title: route.title,
    activityType: route.activityType,
    source: route.source,
    startedAt: route.startedAt,
    distanceM: route.distanceM,
    elevationGainM: route.elevationGainM,
    durationSec: route.durationSec,
    gapPaceSecKm: route.gapPaceSecKm,
    paHrDecouplingPct: route.paHrDecouplingPct,
    pointsCount: route.pointsCount,
  };
}

function ensureActorState(actorKey: string): ActorState {
  const existing = actorStates.get(actorKey);
  if (existing) {
    actorStates.delete(actorKey);
    actorStates.set(actorKey, existing);
    return existing;
  }
  const state: ActorState = { routes: new Map() };
  for (const seed of getSeedRoutes()) {
    state.routes.set(seed.externalId, seed);
  }
  actorStates.set(actorKey, state);
  while (actorStates.size > MAX_ACTORS) {
    const oldest = actorStates.keys().next();
    if (oldest.done) break;
    actorStates.delete(oldest.value);
  }
  return state;
}

function touchRoute(state: ActorState, route: StoredRoute): void {
  state.routes.delete(route.externalId);
  state.routes.set(route.externalId, route);
}

export function listRouteSummaries(actorKey: string): RouteSummaryItem[] {
  const state = ensureActorState(actorKey);
  return Array.from(state.routes.values())
    .map(summarize)
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
}

export function getRoute(actorKey: string, externalId: string): StoredRoute | null {
  const state = ensureActorState(actorKey);
  const route = state.routes.get(externalId);
  if (!route) {
    return null;
  }
  touchRoute(state, route);
  return route;
}

export function getLatestRoute(actorKey: string): StoredRoute | null {
  const state = ensureActorState(actorKey);
  let latest: StoredRoute | null = null;
  for (const route of state.routes.values()) {
    if (latest === null || Date.parse(route.startedAt) > Date.parse(latest.startedAt)) {
      latest = route;
    }
  }
  return latest;
}

export function insertRoute(actorKey: string, route: StoredRoute): InsertRouteResult {
  const state = ensureActorState(actorKey);
  const existing = state.routes.get(route.externalId);
  if (existing) {
    touchRoute(state, existing);
    return { route: existing, deduplicated: true };
  }
  state.routes.set(route.externalId, route);
  while (state.routes.size > MAX_ROUTES_PER_ACTOR) {
    const oldest = state.routes.keys().next();
    if (oldest.done) break;
    state.routes.delete(oldest.value);
  }
  return { route, deduplicated: false };
}

export function resetRoutesStore(): void {
  actorStates.clear();
}

export function countRoutesActors(): number {
  return actorStates.size;
}
