import { NextResponse } from "next/server";
import { WEATHER_TTL_MS } from "@/lib/ingest/swr-policy";

const DEFAULT_LAT = 12.1364;
const DEFAULT_LON = -86.2514;
const OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast";

interface WeatherData {
  latitude: number;
  longitude: number;
  tempC: number;
  humidityPct: number;
  pressureHpa: number;
  windSpeedKmh: number;
  weatherCode: number;
  condition: string;
  observedAt: string;
}

interface WeatherCacheEntry {
  fetchedAtMs: number;
  fetchedAt: string;
  weather: WeatherData;
}

const weatherCache = new Map<string, WeatherCacheEntry>();

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function describeWmoCode(code: number): string {
  if (code === 0) return "Despejado";
  if (code >= 1 && code <= 3) return "Parcialmente nublado";
  if (code === 45 || code === 48) return "Niebla";
  if ((code >= 51 && code <= 65) || (code >= 80 && code <= 82)) return "Lluvia";
  if (code >= 95 && code <= 99) return "Tormenta";
  return "Condicion variable";
}

function buildDeterministicFixture(latitude: number, longitude: number): WeatherData {
  return {
    latitude: Number(latitude.toFixed(4)),
    longitude: Number(longitude.toFixed(4)),
    tempC: 27.4,
    humidityPct: 64.0,
    pressureHpa: 1012.6,
    windSpeedKmh: 11.2,
    weatherCode: 2,
    condition: "Parcialmente nublado",
    observedAt: "2026-11-18T12:00:00Z",
  };
}

function parseCoordinate(raw: string | null, fallback: number, min: number, max: number): number | null {
  if (raw === null || raw.trim() === "") {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    return null;
  }
  return parsed;
}

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const lat = parseCoordinate(url.searchParams.get("lat"), DEFAULT_LAT, -90, 90);
  const lon = parseCoordinate(url.searchParams.get("lon"), DEFAULT_LON, -180, 180);

  if (lat === null || lon === null) {
    return NextResponse.json(
      { ok: false, error: "Coordenadas lat/lon invalidas." },
      { status: 400 },
    );
  }

  const forceParam = url.searchParams.get("force")?.toLowerCase();
  const forceRefresh = forceParam === "true" || forceParam === "1";
  const cacheKey = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  if (!forceRefresh) {
    const cached = weatherCache.get(cacheKey);
    if (cached && nowMs - cached.fetchedAtMs < WEATHER_TTL_MS) {
      const remainingTtlMs = Math.max(0, WEATHER_TTL_MS - (nowMs - cached.fetchedAtMs));
      return NextResponse.json(
        {
          ok: true,
          weather: cached.weather,
          cached: true,
          fallback: false,
          source: "open-meteo",
          ttlMs: WEATHER_TTL_MS,
          remainingTtlMs,
          fetchedAt: cached.fetchedAt,
        },
        { status: 200 },
      );
    }
  }

  const upstreamUrl = new URL(OPEN_METEO_URL);
  upstreamUrl.searchParams.set("latitude", String(lat));
  upstreamUrl.searchParams.set("longitude", String(lon));
  upstreamUrl.searchParams.set(
    "current",
    "temperature_2m,relative_humidity_2m,surface_pressure,weather_code,wind_speed_10m",
  );
  upstreamUrl.searchParams.set("timezone", "auto");

  try {
    const response = await fetch(upstreamUrl.toString(), {
      method: "GET",
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) {
      throw new Error(`Open-Meteo HTTP ${response.status}`);
    }

    const payload: unknown = await response.json();
    const current = isPlainRecord(payload) && isPlainRecord(payload.current) ? payload.current : null;
    if (!current) {
      throw new Error("Respuesta Open-Meteo sin bloque current");
    }

    const tempC = current.temperature_2m;
    const humidityPct = current.relative_humidity_2m;
    const pressureHpa = current.surface_pressure ?? 1013.25;
    const windSpeedKmh = current.wind_speed_10m ?? 0;
    const rawCode = current.weather_code ?? 0;

    if (
      !isFiniteNumber(tempC) ||
      !isFiniteNumber(humidityPct) ||
      humidityPct < 0 ||
      humidityPct > 100 ||
      !isFiniteNumber(pressureHpa) ||
      !isFiniteNumber(windSpeedKmh) ||
      !isFiniteNumber(rawCode)
    ) {
      throw new Error("Valores numericos no finitos desde Open-Meteo");
    }

    const weatherCode = Math.trunc(rawCode);
    const weather: WeatherData = {
      latitude: Number(lat.toFixed(4)),
      longitude: Number(lon.toFixed(4)),
      tempC: Number(tempC.toFixed(2)),
      humidityPct: Number(humidityPct.toFixed(2)),
      pressureHpa: Number(pressureHpa.toFixed(2)),
      windSpeedKmh: Number(windSpeedKmh.toFixed(2)),
      weatherCode,
      condition: describeWmoCode(weatherCode),
      observedAt: typeof current.time === "string" ? current.time : nowIso,
    };

    weatherCache.set(cacheKey, {
      fetchedAtMs: nowMs,
      fetchedAt: nowIso,
      weather,
    });

    return NextResponse.json(
      {
        ok: true,
        weather,
        cached: false,
        fallback: false,
        source: "open-meteo",
        ttlMs: WEATHER_TTL_MS,
        remainingTtlMs: WEATHER_TTL_MS,
        fetchedAt: nowIso,
      },
      { status: 200 },
    );
  } catch {
    const fixture = buildDeterministicFixture(lat, lon);
    return NextResponse.json(
      {
        ok: true,
        weather: fixture,
        cached: false,
        fallback: true,
        source: "fixture",
        ttlMs: WEATHER_TTL_MS,
        remainingTtlMs: 0,
        fetchedAt: nowIso,
      },
      { status: 200 },
    );
  }
}
