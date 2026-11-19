export type SwCacheStrategy = "cache-first" | "network-first" | "bypass";

export const SW_CACHE_VERSION = "pulsetrack-shell-v1";

export const SW_PRECACHE_ROUTES: readonly string[] = [
  "/",
  "/gym",
  "/routes",
  "/nutrition",
  "/ai-engine",
  "/manifest.webmanifest",
  "/icon.svg",
];

export function classifySwRequest(input: {
  method: string;
  origin: string;
  selfOrigin: string;
  pathname: string;
  mode: string;
}): SwCacheStrategy {
  if (input.method.toUpperCase() !== "GET") return "bypass";
  if (input.origin !== input.selfOrigin) return "bypass";
  if (input.pathname.startsWith("/api/")) return "bypass";
  if (
    input.pathname.startsWith("/_next/static/") ||
    input.pathname.startsWith("/workers/") ||
    input.pathname === "/manifest.webmanifest" ||
    input.pathname === "/icon.svg" ||
    input.pathname === "/apple-touch-icon.png"
  ) {
    return "cache-first";
  }
  if (input.mode === "navigate") return "network-first";
  return "bypass";
}
