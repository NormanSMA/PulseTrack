import { describe, expect, it } from "vitest";
import {
  buildColoredSegmentsGeoJson,
  calculateAerobicDecoupling,
  calculateGapPaceSecKm,
  generateSyntheticMountainGpx,
  haversineDistanceM,
  minettiEnergyCost,
  parseGpxTrack,
  runGpxBenchmark,
  simplifyRdp,
  toPostgisLineStringZ,
} from "./gpx-engine";
import type { GpxTrackPoint } from "./types";

const garminGpx = `<?xml version="1.0"?>
<gpx xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">
  <metadata><name>Exportación Garmin</name></metadata>
  <trk><name>Cerro &amp; río</name><type>trail_running</type><trkseg>
    <trkpt lat="12" lon="-86"><ele>100</ele><time>2026-03-14T14:00:00Z</time>
      <extensions><gpxtpx:TrackPointExtension>
        <gpxtpx:hr>130</gpxtpx:hr><gpxtpx:atemp>23.5</gpxtpx:atemp>
      </gpxtpx:TrackPointExtension></extensions>
    </trkpt>
    <trkpt lon='-86' lat='12.001'><ele>110</ele><time>2026-03-14T14:01:00Z</time>
      <extensions><hr>150</hr><temp>24.5</temp></extensions>
    </trkpt>
    <trkpt lat="12.002" lon="-86"><ele>100</ele><time>2026-03-14T14:02:00Z</time>
      <extensions><gpxtpx:TrackPointExtension>
        <gpxtpx:hr>153</gpxtpx:hr><gpxtpx:atemp>25.5</gpxtpx:atemp>
      </gpxtpx:TrackPointExtension></extensions>
    </trkpt>
  </trkseg></trk>
</gpx>`;

function trackPoint(overrides: Partial<GpxTrackPoint> = {}): GpxTrackPoint {
  return {
    lat: 0, lon: 0, eleM: 0, timeMs: null, hrBpm: null, tempC: null, cumDistM: 0, gradePct: 0,
    ...overrides,
  };
}

describe("parseGpxTrack", () => {
  it("lee Garmin, calcula métricas y genera geometría 3D", () => {
    const route = parseGpxTrack(garminGpx, { source: "garmin" });

    expect(route).toMatchObject({
      title: "Cerro & río",
      activityType: "trail_running",
      source: "garmin",
      startedAt: "2026-03-14T14:00:00.000Z",
      durationSec: 120,
      avgHrBpm: (130 + 150 + 153) / 3,
      avgTempC: 24.5,
      elevationGainM: 10,
      elevationLossM: 10,
      pointsCount: 3,
      simplifiedCount: 3,
      wktLineStringZ: "LINESTRING Z(-86 12 100, -86 12.001 110, -86 12.002 100)",
    });
    expect(route.distanceM).toBeCloseTo(222.39, 2);
    expect(route.points[0]).toEqual(trackPoint({
      lat: 12, lon: -86, eleM: 100, timeMs: Date.parse(route.startedAt), hrBpm: 130, tempC: 23.5,
    }));
    expect(route.points[1]).toMatchObject({ lon: -86, hrBpm: 150, tempC: 24.5 });
    expect(route.segmentsGeoJson.features[0]).toMatchObject({
      geometry: { type: "LineString", coordinates: [[-86, 12, 100], [-86, 12.001, 110]] },
      properties: { index: 0, colorHex: "#F87171" },
    });
    expect(route.segmentsGeoJson.features[1]?.properties.colorHex).toBe("#60A5FA");
    expect(Number.isFinite(route.processingMs)).toBe(true);
  });

  it("genera un identificador FNV-1a de 64 bits sobre bytes UTF-8", () => {
    let hash = 0xcbf29ce484222325n;
    for (const byte of new TextEncoder().encode(garminGpx)) {
      hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n);
    }
    const route = parseGpxTrack(garminGpx, { title: "Descenso", activityType: "hiking" });

    expect(route.externalId).toBe(`gpx-${hash.toString(16).padStart(16, "0")}`);
    expect(route.externalId).toBe(parseGpxTrack(garminGpx).externalId);
    expect(route).toMatchObject({ title: "Descenso", activityType: "hiking", source: "gpx_upload" });
  });

  it.each([
    ['lat="12"', 'lat="NaN"'],
    ['lat="12"', 'lat="90.1"'],
    ['lon="-86"', 'lon="-180.1"'],
    ['lon="-86"', 'lon="Infinity"'],
    ['lon="-86"', 'lon=""'],
    ["<ele>100</ele>", "<ele>NaN</ele>"],
  ])("rechaza sustituir %s por %s", (original, replacement) => {
    expect(() => parseGpxTrack(garminGpx.replace(original, replacement))).toThrow(RangeError);
  });

  it("rechaza rutas con menos de dos puntos y rutas que superan el límite", () => {
    expect(() => parseGpxTrack('<gpx><trkpt lat="0" lon="0" /></gpx>')).toThrow(RangeError);
    expect(() => parseGpxTrack(garminGpx, { maxPoints: 2 })).toThrow(RangeError);
    expect(parseGpxTrack(garminGpx, { maxPoints: 3 }).pointsCount).toBe(3);
  });

  it("filtra oscilaciones menores de 1.5 metros", () => {
    const elevations = [100, 100.8, 100.3, 101.5, 102.1, 101.2, 100.6, 100, 100.9];
    const xml = elevations.map((eleM, index) =>
      `<trkpt lat="12" lon="${-86 + index / 1000}"><ele>${eleM}</ele></trkpt>`,
    ).join("");
    const route = parseGpxTrack(`<gpx><trk><trkseg>${xml}</trkseg></trk></gpx>`);

    expect(route.elevationGainM).toBeCloseTo(2.1);
    expect(route.elevationLossM).toBeCloseTo(2.1);
    expect(route.rawPaceSecKm).toBeNull();
    expect(route.gapPaceSecKm).toBeNull();
  });
});

describe("geometría 3D", () => {
  it("calcula la distancia de Haversine en metros", () => {
    expect(haversineDistanceM(0, 0, 0, 0)).toBe(0);
    expect(haversineDistanceM(0, 0, 0, 1)).toBeCloseTo(111_194.93, 2);
    expect(haversineDistanceM(0, 179.5, 0, -179.5)).toBeCloseTo(111_194.93, 2);
  });

  it("serializa longitud, latitud y elevación en WKT", () => {
    const first = trackPoint({ lat: 12.5, lon: -86, eleM: 100 });
    expect(toPostgisLineStringZ([first, trackPoint({ lat: 13, lon: -85, eleM: 104.5 })]))
      .toBe("LINESTRING Z(-86 12.5 100, -85 13 104.5)");
    expect(() => toPostgisLineStringZ([first])).toThrow(RangeError);
  });

  it("conserva extremos y picos entre 50 000 puntos sin recursión", () => {
    const points = Array.from({ length: 50_000 }, (_, index) =>
      trackPoint({ lat: index === 25_000 ? 0.005 : 0, lon: index * 0.00001, eleM: index === 10_000 ? 100 : 0 }),
    );
    const simplified = simplifyRdp(points, 5);

    expect(simplified[0]).toBe(points[0]);
    expect(simplified.at(-1)).toBe(points.at(-1));
    expect(simplified).toContain(points[10_000]);
    expect(simplified).toContain(points[25_000]);
    expect(simplified.length).toBeLessThan(20);
  });

  it("simplifica puntos colineales al cruzar el antimeridiano", () => {
    const points = [179.9, -180, -179.9].map((lon) => trackPoint({ lon }));
    expect(simplifyRdp(points, 1)).toEqual([points[0], points[2]]);
  });

  it("colorea por pendiente o por frecuencia cardíaca", () => {
    const points = [
      trackPoint(),
      trackPoint({ gradePct: -4, hrBpm: 140 }),
      trackPoint({ gradePct: 0, hrBpm: 110 }),
      trackPoint({ gradePct: 5, hrBpm: 160 }),
      trackPoint({ gradePct: 11, hrBpm: 180 }),
    ];
    const colors = (mode: "grade" | "hr") => buildColoredSegmentsGeoJson(points, mode).features
      .map((feature) => feature.properties.colorHex);
    expect(colors("grade")).toEqual(["#60A5FA", "#4ADE80", "#FBBF24", "#F87171"]);
    expect(colors("hr")).toEqual(["#4ADE80", "#60A5FA", "#FBBF24", "#F87171"]);
  });
});

describe("GAP Minetti", () => {
  it("calcula el costo plano y acota el grado", () => {
    expect(minettiEnergyCost(0)).toBe(3.6);
    expect(minettiEnergyCost(1)).toBe(minettiEnergyCost(0.45));
    expect(minettiEnergyCost(-1)).toBe(minettiEnergyCost(-0.45));
  });

  it.each([
    [10, 5.968214, -1],
    [0, 3.6, 0],
    [-10, 2.151706, 1],
  ])("aplica el costo Minetti para una pendiente de %s %%", (gradePct, cost, paceChange) => {
    const points = [
      trackPoint({ timeMs: 0 }),
      trackPoint({ timeMs: 300_000, cumDistM: 1000, gradePct }),
    ];
    const pace = calculateGapPaceSecKm(points);

    expect(minettiEnergyCost(gradePct / 100)).toBeCloseTo(cost, 6);
    expect(pace.rawPaceSecKm).toBe(300);
    expect(pace.gapPaceSecKm).toBeCloseTo(300 * 3.6 / cost, 6);
    expect(Math.sign((pace.gapPaceSecKm ?? 0) - 300)).toBe(paceChange);
  });
});

describe("Pa:Hr", () => {
  it("detecta deriva positiva cuando sube la FC a igual velocidad", () => {
    const points = [
      trackPoint({ timeMs: 0, hrBpm: 120, tempC: 18 }),
      trackPoint({ timeMs: 60_000, cumDistM: 200, hrBpm: 120, tempC: 18 }),
      trackPoint({ timeMs: 60_000, cumDistM: 200, hrBpm: 150, tempC: 22 }),
      trackPoint({ timeMs: 120_000, cumDistM: 400, hrBpm: 150, tempC: 22 }),
    ];

    expect(calculateAerobicDecoupling(points)).toEqual({ paHrDecouplingPct: 20, thermalDriftBpm: 30 });
    expect(calculateAerobicDecoupling(points.map((point) => ({ ...point, tempC: 18 }))))
      .toEqual({ paHrDecouplingPct: 20, thermalDriftBpm: 0 });
    expect(calculateAerobicDecoupling(points.map((point) => ({ ...point, tempC: null }))))
      .toEqual({ paHrDecouplingPct: 20, thermalDriftBpm: null });
  });

  it("devuelve valores nulos sin tiempo o frecuencia cardíaca válidos", () => {
    const empty = { paHrDecouplingPct: null, thermalDriftBpm: null };
    expect(calculateAerobicDecoupling([trackPoint({ hrBpm: 100 }), trackPoint({ hrBpm: 120 })]))
      .toEqual(empty);
    expect(calculateAerobicDecoupling([trackPoint({ timeMs: 0 }), trackPoint({ timeMs: 5000, cumDistM: 10 })]))
      .toEqual(empty);
  });

  it("interpola muestras cuando un segmento cruza la mitad temporal", () => {
    const points = [
      trackPoint({ timeMs: 0, hrBpm: 120, tempC: 18 }),
      trackPoint({ timeMs: 100_000, cumDistM: 500, hrBpm: 160, tempC: 22 }),
    ];

    expect(calculateAerobicDecoupling(points)).toEqual({ paHrDecouplingPct: 13.33, thermalDriftBpm: 20 });
  });
});

describe("benchmark ADR-003", () => {
  it("genera rutas sintéticas deterministas con el tamaño solicitado", () => {
    const xml = generateSyntheticMountainGpx(3);
    expect(generateSyntheticMountainGpx(3)).toBe(xml);
    expect(parseGpxTrack(xml).pointsCount).toBe(3);
  });

  it("mide parseo, RDP y GAP sobre 10 000 puntos", () => {
    const result = runGpxBenchmark(10_000);

    expect(result.pointCount).toBe(10_000);
    expect(result.simplifiedCount).toBeGreaterThan(1);
    expect(result.simplifiedCount).toBeLessThan(result.pointCount);
    for (const duration of [result.parseMs, result.rdpMs, result.gapMs, result.totalMs]) {
      expect(Number.isFinite(duration)).toBe(true);
      expect(duration).toBeGreaterThanOrEqual(0);
    }
    expect(result.totalMs).toBeCloseTo(result.parseMs + result.rdpMs + result.gapMs);
    expect(result.withinBudget16Ms).toBe(result.totalMs < 16);
  });
});
