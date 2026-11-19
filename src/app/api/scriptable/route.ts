import { NextResponse } from "next/server";
import { buildScriptableWidgetPayload } from "@/lib/ai/cloud-router";
import {
  getLatestTelemetryLog,
  resolveActorKey,
} from "@/lib/ai/telemetry-store";
import { isAppleHealthSource } from "@/lib/ingest/swr-policy";

const NO_STORE = { "Cache-Control": "no-store" } as const;
const SCRIPTABLE_CACHE_HEADERS = {
  "Cache-Control": "public, max-age=900, stale-while-revalidate=900",
  "X-PulseTrack-Cache-TTL": "900",
} as const;

export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const source = searchParams.get("source");
  if (source !== null && isAppleHealthSource(source)) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "ADR-001: apple_health esta estrictamente prohibido en PulseTrack.",
      },
      { status: 403, headers: NO_STORE },
    );
  }

  const actor = resolveActorKey(request);
  const latestLog = getLatestTelemetryLog(actor);

  const payload = buildScriptableWidgetPayload(
    latestLog
      ? {
          activeProvider: latestLog.provider,
          activeModel: latestLog.modelName,
          routerLatencyMs: latestLog.latencyMs,
          fallbackActive: latestLog.fallbackUsed,
        }
      : undefined,
  );

  return NextResponse.json(
    { ok: true, payload },
    { status: 200, headers: SCRIPTABLE_CACHE_HEADERS },
  );
}
