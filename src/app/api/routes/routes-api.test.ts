import { beforeEach, describe, expect, it, vi } from "vitest";

interface MockPoint {
  lon: number;
  lat: number;
  eleM: number;
  timeMs: number;
  hrBpm: number | null;
  tempC: number | null;
  cumDistM: number;
  gradePct: number;
}

vi.mock("@/lib/geo/gpx-engine", () => {
  const hash = (text: string): string => {
    let h = 5381;
    for (let i = 0; i < text.length; i += 1) {
      h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
    }
    return h.toString(16);
  };
  const buildColoredSegmentsGeoJson = (points: readonly MockPoint[], mode: string) => ({
    type: "FeatureCollection",
    features: points.slice(1).map((point, index) => {
      const prev = points[index]!;
      return {
        type: "Feature",
        properties: { colorHex: "#4ADE80", mode },
        geometry: {
          type: "LineString",
          coordinates: [
            [prev.lon, prev.lat, prev.eleM],
            [point.lon, point.lat, point.eleM],
          ],
        },
      };
    }),
  });
  const toPostgisLineStringZ = (points: readonly MockPoint[]): string =>
    `LINESTRING Z(${points.map((p) => `${p.lon} ${p.lat} ${p.eleM}`).join(", ")})`;
  const parseGpxTrack = (
    xml: string,
    options?: {
      title?: string;
      activityType?: string;
      source?: string;
      colorMode?: string;
    },
  ) => {
    const matches = Array.from(
      xml.matchAll(/<trkpt lat="(-?[\d.]+)" lon="(-?[\d.]+)">\s*<ele>(-?[\d.]+)<\/ele>/g),
    );
    if (!xml.includes("<gpx") || matches.length < 2) {
      throw new Error("sin puntos de track");
    }
    const points: MockPoint[] = matches.map((m, i) => ({
      lat: Number(m[1]),
      lon: Number(m[2]),
      eleM: Number(m[3]),
      timeMs: 1_700_000_000_000 + i * 10_000,
      hrBpm: null,
      tempC: null,
      cumDistM: i * 100,
      gradePct: 0,
    }));
    return {
      externalId: `gpx:${hash(xml)}`,
      title: options?.title ?? "Ruta parseada",
      activityType: options?.activityType ?? "running",
      source: options?.source ?? "gpx_upload",
      startedAt: "2026-11-15T12:00:00.000Z",
      distanceM: (points.length - 1) * 100,
      elevationGainM: 10,
      elevationLossM: 0,
      durationSec: (points.length - 1) * 10,
      rawPaceSecKm: 100,
      gapPaceSecKm: 98,
      paHrDecouplingPct: null,
      thermalDriftBpm: null,
      avgHrBpm: null,
      avgTempC: null,
      pointsCount: points.length,
      simplifiedCount: points.length,
      points,
      wktLineStringZ: toPostgisLineStringZ(points),
      segmentsGeoJson: options?.colorMode
        ? buildColoredSegmentsGeoJson(points, options.colorMode)
        : { type: "FeatureCollection", features: [] },
      processingMs: 0.4,
    };
  };
  return { parseGpxTrack, buildColoredSegmentsGeoJson, toPostgisLineStringZ };
});

import { GET } from "@/app/api/routes/route";
import { POST } from "@/app/api/routes/upload/route";
import {
  MAX_ACTORS,
  MAX_ROUTES_PER_ACTOR,
  countRoutesActors,
  insertRoute,
  listRouteSummaries,
  resetRoutesStore,
  resolveActorKey,
  type StoredRoute,
} from "@/lib/geo/routes-store";

const BASE = "http://localhost";

const GPX_A = `<?xml version="1.0"?><gpx version="1.1" creator="test">
<trk><trkseg>
<trkpt lat="11.984" lon="-86.161"><ele>420</ele></trkpt>
<trkpt lat="11.987" lon="-86.158"><ele>510</ele></trkpt>
<trkpt lat="11.990" lon="-86.154"><ele>615</ele></trkpt>
</trkseg></trk></gpx>`;

const GPX_B = GPX_A.replace("615", "640");

const MASAYA_ID = "seed:circuito-volcan-masaya";
const MOMBACHO_ID = "seed:ascenso-volcan-mombacho";

interface RouteJson {
  externalId: string;
  title: string;
  distanceM: number;
  elevationGainM: number;
  durationSec: number;
  paHrDecouplingPct: number | null;
  pointsCount: number;
  points: Array<MockPoint>;
  wktLineStringZ: string;
  segmentsGeoJson: {
    type: string;
    features: Array<{
      properties: { colorHex?: string; mode?: string };
      geometry: { coordinates: number[][] };
    }>;
  };
}

interface ListResponse {
  ok: boolean;
  routes: Array<{ externalId: string; startedAt: string }>;
  route: RouteJson | null;
  error?: string;
}

interface UploadResponse {
  ok: boolean;
  route?: RouteJson;
  deduplicated?: boolean;
  postgisSqlPreview?: string;
  error?: string;
}

function getRequest(query = "", headers: Record<string, string> = {}): Request {
  return new Request(`${BASE}/api/routes${query}`, { headers });
}

function jsonPost(body: unknown, headers: Record<string, string> = {}, query = ""): Request {
  return new Request(`${BASE}/api/routes/upload${query}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function formPost(form: FormData, headers: Record<string, string> = {}): Request {
  return new Request(`${BASE}/api/routes/upload`, { method: "POST", headers, body: form });
}

function buildStoredRoute(externalId: string, startedAt: string): StoredRoute {
  return {
    externalId,
    title: externalId,
    activityType: "running",
    source: "gpx_upload",
    startedAt,
    distanceM: 1000,
    elevationGainM: 10,
    elevationLossM: 10,
    durationSec: 300,
    rawPaceSecKm: 300,
    gapPaceSecKm: 295,
    paHrDecouplingPct: null,
    thermalDriftBpm: null,
    avgHrBpm: null,
    avgTempC: null,
    pointsCount: 0,
    simplifiedCount: 0,
    points: [],
    wktLineStringZ: "LINESTRING Z EMPTY",
    segmentsGeoJson: { type: "FeatureCollection", features: [] },
    processingMs: 0,
  };
}

beforeEach(() => {
  resetRoutesStore();
});

describe("GET /api/routes", () => {
  it("devuelve la semilla determinista de 2 rutas con la mas reciente en route", async () => {
    const response = await GET(getRequest());
    expect(response.status).toBe(200);
    const body = (await response.json()) as ListResponse;
    expect(body.ok).toBe(true);
    expect(body.routes.map((r) => r.externalId)).toEqual([MOMBACHO_ID, MASAYA_ID]);
    expect(body.route?.externalId).toBe(MOMBACHO_ID);
  });

  it("modela Circuito Volcan Masaya con 12.48 km y +412 m", async () => {
    const response = await GET(getRequest(`?id=${MASAYA_ID}`));
    const body = (await response.json()) as ListResponse;
    const route = body.route;
    expect(route).not.toBeNull();
    if (!route) return;
    expect(route.title).toBe("Circuito Volcan Masaya");
    expect(Math.abs(route.distanceM - 12480)).toBeLessThan(15);
    expect(Math.abs(route.elevationGainM - 412)).toBeLessThan(2);
    expect(route.pointsCount).toBe(route.points.length);
    expect(route.wktLineStringZ.startsWith("LINESTRING Z(")).toBe(true);
    const first = route.points[0];
    const last = route.points[route.points.length - 1];
    expect(first).toBeDefined();
    expect(last).toBeDefined();
    if (!first || !last) return;
    expect(first.lat).toBeGreaterThan(11.9);
    expect(first.lat).toBeLessThan(12.1);
    expect(first.lon).toBeGreaterThan(-86.3);
    expect(first.lon).toBeLessThan(-86.0);
    expect(typeof first.hrBpm).toBe("number");
    expect(typeof first.tempC).toBe("number");
    expect(last.cumDistM).toBeCloseTo(route.distanceM, 0);
    expect(route.paHrDecouplingPct).not.toBeNull();
    expect(Math.abs(route.paHrDecouplingPct ?? 1000)).toBeLessThan(100);
    expect(route.segmentsGeoJson.features.length).toBeGreaterThan(10);
    expect(route.segmentsGeoJson.features[0]?.properties.colorHex).toMatch(/^#[0-9A-F]{6}$/);
    const times = route.points.map((p) => p.timeMs);
    for (let i = 1; i < times.length; i += 1) {
      expect(times[i]).toBeGreaterThan(times[i - 1] ?? 0);
    }
  });

  it("modela Ascenso Volcan Mombacho con 8.60 km y +520 m", async () => {
    const response = await GET(getRequest(`?id=${MOMBACHO_ID}`));
    const body = (await response.json()) as ListResponse;
    const route = body.route;
    expect(route).not.toBeNull();
    if (!route) return;
    expect(route.title).toBe("Ascenso Volcan Mombacho");
    expect(Math.abs(route.distanceM - 8600)).toBeLessThan(15);
    expect(Math.abs(route.elevationGainM - 520)).toBeLessThan(2);
  });

  it("devuelve la misma semilla en llamadas repetidas", async () => {
    const first = (await (await GET(getRequest(`?id=${MASAYA_ID}`))).json()) as ListResponse;
    resetRoutesStore();
    const second = (await (await GET(getRequest(`?id=${MASAYA_ID}`))).json()) as ListResponse;
    expect(second.route).toEqual(first.route);
  });

  it("retorna 404 si el id no existe", async () => {
    const response = await GET(getRequest("?id=ruta-inexistente"));
    expect(response.status).toBe(404);
    const body = (await response.json()) as ListResponse;
    expect(body.ok).toBe(false);
  });

  it("rechaza source=apple_health con 403", async () => {
    const response = await GET(getRequest("?source=apple_health"));
    expect(response.status).toBe(403);
    const body = (await response.json()) as ListResponse;
    expect(body.ok).toBe(false);
  });

  it("aisla rutas por actor x-user-id", async () => {
    const upload = await POST(jsonPost({ gpx: GPX_A }, { "x-user-id": "actor-a" }));
    expect(upload.status).toBe(201);
    const actorA = (await (
      await GET(getRequest("", { "x-user-id": "actor-a" }))
    ).json()) as ListResponse;
    const actorB = (await (
      await GET(getRequest("", { "x-user-id": "actor-b" }))
    ).json()) as ListResponse;
    expect(actorA.routes).toHaveLength(3);
    expect(actorB.routes).toHaveLength(2);
  });

  it("resuelve actor invalido a local-owner", () => {
    const request = new Request(BASE, { headers: { "x-user-id": "bad id!" } });
    expect(resolveActorKey(request)).toBe("local-owner");
  });
});

describe("POST /api/routes/upload", () => {
  it("acepta JSON, responde 201 y genera SQL PostGIS parametrizado", async () => {
    const response = await POST(
      jsonPost({ gpx: GPX_A, title: "Mi ruta", activityType: "cycling", colorMode: "pulse" }),
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as UploadResponse;
    expect(body.ok).toBe(true);
    expect(body.deduplicated).toBe(false);
    expect(body.route?.title).toBe("Mi ruta");
    expect(body.route?.segmentsGeoJson.features[0]?.properties.mode).toBe("hr");
    expect(body.postgisSqlPreview).toContain("INSERT INTO gpx_routes");
    expect(body.postgisSqlPreview).toContain("ST_GeomFromText($5, 4326)");
    expect(body.postgisSqlPreview).not.toContain("LINESTRING");
  });

  it("deduplica por externalId y responde 200", async () => {
    const first = await POST(jsonPost({ gpx: GPX_A }));
    expect(first.status).toBe(201);
    const second = await POST(jsonPost({ gpx: GPX_A }));
    expect(second.status).toBe(200);
    const body = (await second.json()) as UploadResponse;
    expect(body.deduplicated).toBe(true);
    const third = await POST(jsonPost({ gpx: GPX_B }));
    expect(third.status).toBe(201);
    expect(listRouteSummaries("local-owner")).toHaveLength(4);
  });

  it("deja la ruta cargada disponible en GET por id", async () => {
    const upload = (await (await POST(jsonPost({ gpx: GPX_A }))).json()) as UploadResponse;
    const externalId = upload.route?.externalId ?? "";
    const response = await GET(getRequest(`?id=${encodeURIComponent(externalId)}`));
    const body = (await response.json()) as ListResponse;
    expect(body.route?.externalId).toBe(externalId);
  });

  it("acepta multipart/form-data con file", async () => {
    const form = new FormData();
    form.append("file", new File([GPX_A], "ruta.gpx", { type: "application/gpx+xml" }));
    form.append("title", "Desde archivo");
    const response = await POST(formPost(form));
    expect(response.status).toBe(201);
    const body = (await response.json()) as UploadResponse;
    expect(body.route?.title).toBe("Desde archivo");
    expect(body.route?.pointsCount).toBe(3);
  });

  it("acepta multipart/form-data con campo gpx como texto", async () => {
    const form = new FormData();
    form.append("gpx", GPX_B);
    const response = await POST(formPost(form));
    expect(response.status).toBe(201);
  });

  it("rechaza con 413 un Content-Length mayor a 25 MB", async () => {
    const request = new Request(`${BASE}/api/routes/upload`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": String(25 * 1024 * 1024 + 1),
      },
      body: JSON.stringify({ gpx: GPX_A }),
    });
    const response = await POST(request);
    expect(response.status).toBe(413);
  });

  it("rechaza con 413 un cuerpo real mayor a 25 MB", async () => {
    const padding = "x".repeat(25 * 1024 * 1024 + 1024);
    const response = await POST(jsonPost({ gpx: `${GPX_A}<!--${padding}-->` }));
    expect(response.status).toBe(413);
  });

  it("rechaza source apple_health con 403 en JSON, query y multipart", async () => {
    const json = await POST(jsonPost({ gpx: GPX_A, source: "apple_health" }));
    expect(json.status).toBe(403);
    const query = await POST(jsonPost({ gpx: GPX_A }, {}, "?source=apple_health"));
    expect(query.status).toBe(403);
    const form = new FormData();
    form.append("gpx", GPX_A);
    form.append("source", "Apple-Health");
    const multipart = await POST(formPost(form));
    expect(multipart.status).toBe(403);
    expect(listRouteSummaries("local-owner")).toHaveLength(2);
  });

  it("rechaza GPX invalido o vacio con 400", async () => {
    const invalid = await POST(jsonPost({ gpx: "<html>no es gpx</html>" }));
    expect(invalid.status).toBe(400);
    const empty = await POST(jsonPost({ gpx: "   " }));
    expect(empty.status).toBe(400);
    const missing = await POST(jsonPost({ title: "sin gpx" }));
    expect(missing.status).toBe(400);
    const notJson = await POST(
      new Request(`${BASE}/api/routes/upload`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{no-json",
      }),
    );
    expect(notJson.status).toBe(400);
    const badSource = await POST(jsonPost({ gpx: GPX_A, source: "strava" }));
    expect(badSource.status).toBe(400);
    const badColor = await POST(jsonPost({ gpx: GPX_A, colorMode: "rainbow" }));
    expect(badColor.status).toBe(400);
  });
});

describe("routes-store cuotas", () => {
  it("evicta la ruta mas antigua al superar MAX_ROUTES_PER_ACTOR", () => {
    for (let i = 0; i < MAX_ROUTES_PER_ACTOR + 5; i += 1) {
      insertRoute("quota-actor", buildStoredRoute(`r-${i}`, "2026-11-01T00:00:00.000Z"));
    }
    const summaries = listRouteSummaries("quota-actor");
    expect(summaries).toHaveLength(MAX_ROUTES_PER_ACTOR);
    expect(summaries.some((s) => s.externalId === "r-0")).toBe(false);
    expect(summaries.some((s) => s.externalId === `r-${MAX_ROUTES_PER_ACTOR + 4}`)).toBe(true);
  });

  it("evicta el actor menos usado al superar MAX_ACTORS", () => {
    for (let i = 0; i < MAX_ACTORS + 3; i += 1) {
      listRouteSummaries(`actor-${i}`);
    }
    expect(countRoutesActors()).toBe(MAX_ACTORS);
  });
});
