import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { classifySwRequest, SW_PRECACHE_ROUTES } from "./sw-policy";

describe("sw-policy PWA offline", () => {
  const selfOrigin = "https://pulsetrack.nsma.dev";

  it("incluye las 5 vistas principales y el manifiesto en precache", () => {
    expect(SW_PRECACHE_ROUTES).toContain("/");
    expect(SW_PRECACHE_ROUTES).toContain("/gym");
    expect(SW_PRECACHE_ROUTES).toContain("/routes");
    expect(SW_PRECACHE_ROUTES).toContain("/nutrition");
    expect(SW_PRECACHE_ROUTES).toContain("/ai-engine");
    expect(SW_PRECACHE_ROUTES).toContain("/manifest.webmanifest");
  });

  it("usa cache-first para chunks de Next y worker de MapLibre", () => {
    expect(
      classifySwRequest({
        method: "GET",
        origin: selfOrigin,
        selfOrigin,
        pathname: "/_next/static/chunks/app.js",
        mode: "no-cors",
      }),
    ).toBe("cache-first");
    expect(
      classifySwRequest({
        method: "GET",
        origin: selfOrigin,
        selfOrigin,
        pathname: "/workers/maplibre-gl-worker.js",
        mode: "same-origin",
      }),
    ).toBe("cache-first");
  });

  it("usa network-first para navegaciones y bypass para APIs, mutaciones y origenes externos", () => {
    expect(
      classifySwRequest({
        method: "GET",
        origin: selfOrigin,
        selfOrigin,
        pathname: "/routes",
        mode: "navigate",
      }),
    ).toBe("network-first");

    expect(
      classifySwRequest({
        method: "GET",
        origin: selfOrigin,
        selfOrigin,
        pathname: "/api/routes",
        mode: "cors",
      }),
    ).toBe("bypass");

    expect(
      classifySwRequest({
        method: "POST",
        origin: selfOrigin,
        selfOrigin,
        pathname: "/nutrition",
        mode: "cors",
      }),
    ).toBe("bypass");

    expect(
      classifySwRequest({
        method: "GET",
        origin: "https://basemaps.cartocdn.com",
        selfOrigin,
        pathname: "/dark_nolabels/1/1/1.png",
        mode: "cors",
      }),
    ).toBe("bypass");
  });

  it("valida invariantes directas del archivo desplegado public/sw.js", () => {
    const swSource = readFileSync(path.join(process.cwd(), "public", "sw.js"), "utf8");
    expect(swSource).toContain('CACHE_PREFIX = "pulsetrack-shell-"');
    expect(swSource).toContain('url.pathname.startsWith("/api/")');
    expect(swSource).toContain("event.waitUntil(");
    expect(swSource).toContain("response.status >= 500");
    expect(swSource).toContain("key.startsWith(CACHE_PREFIX)");
  });
});
