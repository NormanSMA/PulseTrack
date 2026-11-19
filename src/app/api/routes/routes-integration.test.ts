import { beforeEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/routes/route";
import { POST } from "@/app/api/routes/upload/route";
import { runGpxBenchmark } from "@/lib/geo/gpx-engine";
import { resetRoutesStore, type StoredRoute } from "@/lib/geo/routes-store";

interface RoutesGetBody {
  ok: boolean;
  routes: Array<{ externalId: string }>;
  route: StoredRoute | null;
}

interface UploadBody {
  ok: boolean;
  route: StoredRoute;
  deduplicated: boolean;
  error?: string;
}

const SAMPLE_GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Garmin" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">
  <trk>
    <name>Intervalos Laguna</name>
    <type>running</type>
    <trkseg>
      <trkpt lat="12.0000" lon="-86.0000"><ele>100</ele><time>2026-11-16T12:00:00Z</time>
        <extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>125</gpxtpx:hr><gpxtpx:atemp>22</gpxtpx:atemp></gpxtpx:TrackPointExtension></extensions>
      </trkpt>
      <trkpt lat="12.0010" lon="-86.0000"><ele>100</ele><time>2026-11-16T12:00:40Z</time>
        <extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>130</gpxtpx:hr><gpxtpx:atemp>23</gpxtpx:atemp></gpxtpx:TrackPointExtension></extensions>
      </trkpt>
      <trkpt lat="12.0020" lon="-86.0000"><ele>100</ele><time>2026-11-16T12:01:20Z</time>
        <extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>152</gpxtpx:hr><gpxtpx:atemp>24</gpxtpx:atemp></gpxtpx:TrackPointExtension></extensions>
      </trkpt>
      <trkpt lat="12.0030" lon="-86.0025"><ele>118</ele><time>2026-11-16T12:02:20Z</time>
        <extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>174</gpxtpx:hr><gpxtpx:atemp>26</gpxtpx:atemp></gpxtpx:TrackPointExtension></extensions>
      </trkpt>
    </trkseg>
  </trk>
</gpx>`;

const SECOND_GPX = SAMPLE_GPX.replace("<ele>118</ele>", "<ele>124</ele>");

function jsonUpload(body: unknown, query = "", headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost/api/routes/upload${query}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("Integracion /api/routes + gpx-engine real", () => {
  beforeEach(() => {
    resetRoutesStore();
  });

  it("procesa JSON y multipart con parseGpxTrack real, normaliza pulse->hr y persiste en GET", async () => {
    const resPulse = await POST(jsonUpload({ gpx: SAMPLE_GPX, colorMode: "pulse" }, "", { "x-user-id": "int-pulse" }));
    expect(resPulse.status).toBe(201);
    const bodyPulse = (await resPulse.json()) as UploadBody;
    expect(bodyPulse.ok).toBe(true);
    expect(bodyPulse.deduplicated).toBe(false);
    expect(bodyPulse.route.wktLineStringZ.startsWith("LINESTRING Z(")).toBe(true);
    expect(bodyPulse.route.gapPaceSecKm).not.toBeNull();
    expect(bodyPulse.route.paHrDecouplingPct).not.toBeNull();
    expect(bodyPulse.route.segmentsGeoJson.features).toHaveLength(bodyPulse.route.simplifiedCount - 1);

    const resHr = await POST(jsonUpload({ gpx: SAMPLE_GPX, colorMode: "hr" }, "", { "x-user-id": "int-hr" }));
    expect(resHr.status).toBe(201);
    const bodyHr = (await resHr.json()) as UploadBody;
    expect(bodyPulse.route.segmentsGeoJson).toEqual(bodyHr.route.segmentsGeoJson);

    const form = new FormData();
    form.append("file", new File([SECOND_GPX], "laguna-form.gpx", { type: "application/gpx+xml" }));
    form.append("source", "garmin");
    form.append("title", "Laguna FormData");
    const resForm = await POST(
      new Request("http://localhost/api/routes/upload", {
        method: "POST",
        headers: { "x-user-id": "int-pulse" },
        body: form,
      }),
    );
    expect(resForm.status).toBe(201);
    const bodyForm = (await resForm.json()) as UploadBody;
    expect(bodyForm.route.source).toBe("garmin");
    expect(bodyForm.route.title).toBe("Laguna FormData");
    expect(bodyForm.route.segmentsGeoJson.features).toHaveLength(bodyForm.route.simplifiedCount - 1);

    const resGet = await GET(
      new Request(`http://localhost/api/routes?id=${encodeURIComponent(bodyForm.route.externalId)}`, {
        headers: { "x-user-id": "int-pulse" },
      }),
    );
    expect(resGet.status).toBe(200);
    const bodyGet = (await resGet.json()) as RoutesGetBody;
    expect(bodyGet.route?.externalId).toBe(bodyForm.route.externalId);
    expect(bodyGet.routes.some((item) => item.externalId === bodyPulse.route.externalId)).toBe(true);
  });

  it("deduplica uploads repetidos y aplica guardas 403 apple_health y 413 >10 MB", async () => {
    const first = await POST(jsonUpload({ gpx: SAMPLE_GPX }));
    expect(first.status).toBe(201);
    const second = await POST(jsonUpload({ gpx: SAMPLE_GPX }));
    expect(second.status).toBe(200);
    const dupBody = (await second.json()) as UploadBody;
    expect(dupBody.deduplicated).toBe(true);

    const resQuery403 = await POST(jsonUpload({ gpx: SAMPLE_GPX }, "?source=apple_health"));
    expect(resQuery403.status).toBe(403);
    const resJson403 = await POST(jsonUpload({ gpx: SAMPLE_GPX, source: "apple_health" }));
    expect(resJson403.status).toBe(403);
    const form403 = new FormData();
    form403.append("gpx", SAMPLE_GPX);
    form403.append("source", "Apple-Health");
    const resForm403 = await POST(
      new Request("http://localhost/api/routes/upload", { method: "POST", body: form403 }),
    );
    expect(resForm403.status).toBe(403);

    const oversized = "x".repeat(10 * 1024 * 1024 + 512);
    const res413 = await POST(jsonUpload({ gpx: `${SAMPLE_GPX}<!--${oversized}-->` }));
    expect(res413.status).toBe(413);

    const resNonStringSource = await POST(jsonUpload({ gpx: SAMPLE_GPX, source: 123 }));
    expect(resNonStringSource.status).toBe(400);

    const longNameGpx = SAMPLE_GPX.replace("Intervalos Laguna", "N".repeat(200)).replace("running", "T".repeat(80));
    const resTrunc = await POST(jsonUpload({ gpx: longNameGpx }, "", { "x-user-id": "int-trunc" }));
    expect(resTrunc.status).toBe(201);
    const bodyTrunc = (await resTrunc.json()) as UploadBody;
    expect(bodyTrunc.route.title).toHaveLength(120);
    expect(bodyTrunc.route.activityType).toHaveLength(40);
  });

  it("comprime >98% sobre 50 000 pts con invariantes deterministas en ADR-003", () => {
    runGpxBenchmark(2_000);
    const bench = runGpxBenchmark(50_000);
    expect(bench.pointCount).toBe(50_000);
    expect(bench.simplifiedCount).toBeGreaterThan(10);
    expect(bench.simplifiedCount).toBeLessThan(1_000);
    expect(Number.isFinite(bench.parseMs)).toBe(true);
    expect(Number.isFinite(bench.rdpMs)).toBe(true);
    expect(Number.isFinite(bench.gapMs)).toBe(true);
    expect(bench.parseMs).toBeGreaterThanOrEqual(0);
    expect(bench.rdpMs).toBeGreaterThanOrEqual(0);
    expect(bench.gapMs).toBeGreaterThanOrEqual(0);
    expect(bench.totalMs).toBeCloseTo(bench.parseMs + bench.rdpMs + bench.gapMs, 6);
    expect(bench.withinBudget16Ms).toBe(bench.totalMs < 16);
  });
});
