export type MapStyleMode = "mono-2d" | "topo" | "satellite-3d";

export type RouteColorMode = "grade" | "hr";

export interface GpxTrackPoint {
  lat: number;
  lon: number;
  eleM: number;
  timeMs: number | null;
  hrBpm: number | null;
  tempC: number | null;
  cumDistM: number;
  gradePct: number;
}

export interface GpxSegmentFeature {
  type: "Feature";
  geometry: {
    type: "LineString";
    coordinates: [[number, number, number], [number, number, number]];
  };
  properties: {
    index: number;
    gradePct: number;
    hrBpm: number | null;
    colorHex: string;
  };
}

export interface GpxParsedRoute {
  externalId: string;
  title: string;
  activityType: string;
  source: "garmin" | "gpx_upload";
  startedAt: string;
  distanceM: number;
  elevationGainM: number;
  elevationLossM: number;
  durationSec: number;
  rawPaceSecKm: number | null;
  gapPaceSecKm: number | null;
  paHrDecouplingPct: number | null;
  thermalDriftBpm: number | null;
  avgHrBpm: number | null;
  avgTempC: number | null;
  pointsCount: number;
  simplifiedCount: number;
  points: GpxTrackPoint[];
  wktLineStringZ: string;
  segmentsGeoJson: { type: "FeatureCollection"; features: GpxSegmentFeature[] };
  processingMs: number;
}

export interface GpxBenchmarkResult {
  pointCount: number;
  simplifiedCount: number;
  parseMs: number;
  rdpMs: number;
  gapMs: number;
  totalMs: number;
  withinBudget16Ms: boolean;
}
