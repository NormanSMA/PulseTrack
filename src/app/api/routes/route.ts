import { NextResponse } from "next/server";
import { isAppleHealthSource } from "@/lib/ingest/swr-policy";
import {
  getLatestRoute,
  getRoute,
  listRouteSummaries,
  resolveActorKey,
} from "@/lib/geo/routes-store";

const MAX_ID_LENGTH = 200;
const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);

  const source = searchParams.get("source");
  if (source !== null && isAppleHealthSource(source)) {
    return NextResponse.json(
      { ok: false, error: "ADR-001: apple_health esta estrictamente prohibido en PulseTrack." },
      { status: 403, headers: NO_STORE },
    );
  }

  const actorKey = resolveActorKey(request);
  const id = searchParams.get("id")?.trim();

  if (id !== undefined && id.length > 0) {
    if (id.length > MAX_ID_LENGTH) {
      return NextResponse.json(
        { ok: false, error: "id excede el largo maximo permitido." },
        { status: 400, headers: NO_STORE },
      );
    }
    const route = getRoute(actorKey, id);
    if (!route) {
      return NextResponse.json(
        { ok: false, error: "Ruta no encontrada." },
        { status: 404, headers: NO_STORE },
      );
    }
    return NextResponse.json(
      { ok: true, routes: listRouteSummaries(actorKey), route },
      { headers: NO_STORE },
    );
  }

  return NextResponse.json(
    { ok: true, routes: listRouteSummaries(actorKey), route: getLatestRoute(actorKey) },
    { headers: NO_STORE },
  );
}
