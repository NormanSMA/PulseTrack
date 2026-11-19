import { describe, expect, it } from "vitest";
import {
  BiometricAuthorityError,
  STALE_WINDOW_MS,
  WEATHER_TTL_MS,
  assertBiometricAuthority,
  isAppleHealthSource,
  isStale,
  remainingCooldownMs,
} from "@/lib/ingest/swr-policy";

describe("swr-policy", () => {
  it("expone ventanas SWR de 15 min y clima de 60 min", () => {
    expect(STALE_WINDOW_MS).toBe(15 * 60 * 1000);
    expect(WEATHER_TTL_MS).toBe(60 * 60 * 1000);
  });

  it("evalua isStale y remainingCooldownMs en limites exactos", () => {
    const baseMs = Date.UTC(2026, 10, 18, 12, 0, 0);
    const iso = new Date(baseMs).toISOString();

    expect(isStale(null, baseMs)).toBe(true);
    expect(isStale(undefined, baseMs)).toBe(true);
    expect(isStale("fecha-invalida", baseMs)).toBe(true);
    expect(remainingCooldownMs(null, baseMs)).toBe(0);

    // 1 ms antes de cumplir 15 minutos sigue fresco
    const justBefore = baseMs + STALE_WINDOW_MS - 1;
    expect(isStale(iso, justBefore)).toBe(false);
    expect(remainingCooldownMs(iso, justBefore)).toBe(1);

    // Exactamente 15 minutos ya es stale
    const exactBoundary = baseMs + STALE_WINDOW_MS;
    expect(isStale(iso, exactBoundary)).toBe(true);
    expect(remainingCooldownMs(iso, exactBoundary)).toBe(0);

    // Soporta Date y number
    expect(isStale(new Date(baseMs), baseMs + 60_000)).toBe(false);
    expect(remainingCooldownMs(baseMs, baseMs + 60_000)).toBe(STALE_WINDOW_MS - 60_000);
  });

  it("rechaza apple_health y variantes en todos los modos", () => {
    expect(isAppleHealthSource("apple_health")).toBe(true);
    expect(isAppleHealthSource("Apple-Health")).toBe(true);
    expect(isAppleHealthSource("HealthKit")).toBe(true);
    expect(isAppleHealthSource("garmin")).toBe(false);

    for (const mode of [
      "service_role",
      "authenticated_checkin",
      "client",
      "sync_request",
    ] as const) {
      expect(() =>
        assertBiometricAuthority({ source: "apple_health" }, mode),
      ).toThrowError(BiometricAuthorityError);
    }

    expect(() =>
      assertBiometricAuthority(
        { records: [{ source: "Apple Health", activeKcal: 100 }] },
        "service_role",
      ),
    ).toThrowError(BiometricAuthorityError);
  });

  it("bloquea escritura cliente a campos Garmin y permite check-in subjetivo", () => {
    expect(() =>
      assertBiometricAuthority(
        { date: "2026-11-18", subjEnergy: 4, subjSoreness: 2, subjMood: 5 },
        "authenticated_checkin",
      ),
    ).not.toThrow();

    try {
      assertBiometricAuthority(
        { subjEnergy: 4, activeKcal: 999, hrvMs: 70 },
        "authenticated_checkin",
      );
      expect.unreachable("Debio lanzar BiometricAuthorityError");
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(BiometricAuthorityError);
      if (err instanceof BiometricAuthorityError) {
        expect(err.statusCode).toBe(403);
        expect(err.code).toBe("GARMIN_AUTHORITY_VIOLATION");
        expect(err.forbiddenFields).toEqual(["activeKcal", "hrvMs"]);
      }
    }

    // service_role si puede escribir campos Garmin
    expect(() =>
      assertBiometricAuthority(
        { source: "garmin", activeKcal: 620, hrvMs: 68.5 },
        "service_role",
      ),
    ).not.toThrow();
  });
});
