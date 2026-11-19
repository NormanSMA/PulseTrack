"use client";

import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { StyleSpecification } from "maplibre-gl";
import "./maplibre-amoled.css";

export type MapStyleId = "mono-2d" | "topo" | "satellite-3d";

export interface SegmentFeature {
  type: "Feature";
  properties: { colorHex?: string } | null;
  geometry: { type: "LineString"; coordinates: number[][] };
}

export interface SegmentCollection {
  type: "FeatureCollection";
  features: SegmentFeature[];
}

export interface GpxMapViewerProps {
  segments: SegmentCollection | null;
  styleId: MapStyleId;
  routeKey: string;
}

const ROUTE_SOURCE = "route-segments";
const ROUTE_LAYER = "route-line";
const DEFAULT_COLOR_HEX = "#60A5FA";

const MAP_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    mono: {
      type: "raster",
      tiles: ["https://basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "OpenStreetMap, CARTO",
    },
    topo: {
      type: "raster",
      tiles: ["https://tile.opentopomap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      maxzoom: 17,
      attribution: "OpenTopoMap (CC-BY-SA)",
    },
    satellite: {
      type: "raster",
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
      maxzoom: 19,
      attribution: "Esri World Imagery",
    },
  },
  layers: [
    { id: "bg", type: "background", paint: { "background-color": "#000000" } },
    { id: "base-mono", type: "raster", source: "mono" },
    {
      id: "base-topo",
      type: "raster",
      source: "topo",
      layout: { visibility: "none" },
    },
    {
      id: "base-satellite",
      type: "raster",
      source: "satellite",
      layout: { visibility: "none" },
    },
  ],
};

const BASE_LAYER_BY_STYLE: Record<MapStyleId, string> = {
  "mono-2d": "base-mono",
  topo: "base-topo",
  "satellite-3d": "base-satellite",
};

function hasWebGl(): boolean {
  try {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    return ctx !== null;
  } catch {
    return false;
  }
}

function computeBounds(
  segments: SegmentCollection | null,
): [number, number, number, number] | null {
  if (!segments) return null;
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const feature of segments.features) {
    for (const coord of feature.geometry.coordinates) {
      const lon = coord[0];
      const lat = coord[1];
      if (typeof lon !== "number" || typeof lat !== "number") continue;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  }
  if (!Number.isFinite(minLon) || !Number.isFinite(minLat)) return null;
  return [minLon, minLat, maxLon, maxLat];
}

function applyStyleMode(map: maplibregl.Map, styleId: MapStyleId): void {
  const active = BASE_LAYER_BY_STYLE[styleId];
  for (const layerId of Object.values(BASE_LAYER_BY_STYLE)) {
    if (map.getLayer(layerId)) {
      map.setLayoutProperty(
        layerId,
        "visibility",
        layerId === active ? "visible" : "none",
      );
    }
  }
  const is3d = styleId === "satellite-3d";
  map.easeTo({
    pitch: is3d ? 55 : 0,
    bearing: is3d ? -15 : 0,
    duration: 600,
  });
}

function CanvasRouteFallback({
  segments,
}: {
  segments: SegmentCollection | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const draw = () => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const bounds = computeBounds(segments);
      if (!segments || !bounds) return;
      const [minLon, minLat, maxLon, maxLat] = bounds;
      const midLat = ((minLat + maxLat) / 2) * (Math.PI / 180);
      const lonSpan = Math.max((maxLon - minLon) * Math.cos(midLat), 1e-6);
      const latSpan = Math.max(maxLat - minLat, 1e-6);
      const pad = 24;
      const scale = Math.min(
        (width - pad * 2) / lonSpan,
        (height - pad * 2) / latSpan,
      );
      const offsetX = (width - lonSpan * scale) / 2;
      const offsetY = (height - latSpan * scale) / 2;

      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (const feature of segments.features) {
        const coords = feature.geometry.coordinates;
        if (coords.length < 2) continue;
        ctx.strokeStyle = feature.properties?.colorHex ?? DEFAULT_COLOR_HEX;
        ctx.beginPath();
        coords.forEach((coord, index) => {
          const lon = coord[0] ?? minLon;
          const lat = coord[1] ?? minLat;
          const x = offsetX + (lon - minLon) * Math.cos(midLat) * scale;
          const y = height - offsetY - (lat - minLat) * scale;
          if (index === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();
      }
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [segments]);

  return (
    <div className="relative h-full w-full bg-void">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label="Ruta GPX dibujada en Canvas 2D"
        className="h-full w-full"
      />
      <p className="absolute left-3 top-3 rounded-lg border border-border-subtle bg-surface px-2.5 py-1 text-xs text-ink-secondary">
        WebGL no disponible. Vista Canvas 2D.
      </p>
    </div>
  );
}

export function GpxMapViewer({ segments, styleId, routeKey }: GpxMapViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const readyRef = useRef(false);
  const segmentsRef = useRef<SegmentCollection | null>(segments);
  const styleRef = useRef<MapStyleId>(styleId);
  const [useFallback, setUseFallback] = useState(false);

  segmentsRef.current = segments;
  styleRef.current = styleId;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (!hasWebGl()) {
      setUseFallback(true);
      return;
    }

    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container,
        style: MAP_STYLE,
        center: [0, 0],
        zoom: 1,
        attributionControl: { compact: true },
      });
    } catch {
      setUseFallback(true);
      return;
    }
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");

    map.on("error", () => {
      if (!map.loaded() && !readyRef.current && !map.isStyleLoaded()) {
        setUseFallback(true);
      }
    });

    map.on("load", () => {
      map.addSource(ROUTE_SOURCE, {
        type: "geojson",
        data: segmentsRef.current ?? { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: ROUTE_LAYER,
        type: "line",
        source: ROUTE_SOURCE,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ["coalesce", ["get", "colorHex"], DEFAULT_COLOR_HEX],
          "line-width": 4,
        },
      });
      readyRef.current = true;
      applyStyleMode(map, styleRef.current);
      const bounds = computeBounds(segmentsRef.current);
      if (bounds) {
        map.fitBounds(
          [
            [bounds[0], bounds[1]],
            [bounds[2], bounds[3]],
          ],
          { padding: 48, duration: 0 },
        );
      }
    });

    return () => {
      readyRef.current = false;
      mapRef.current = null;
      map.remove();
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const source = map.getSource(ROUTE_SOURCE);
    if (source && "setData" in source && segments) {
      (source as maplibregl.GeoJSONSource).setData(segments);
    }
  }, [segments]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const bounds = computeBounds(segmentsRef.current);
    if (bounds) {
      map.fitBounds(
        [
          [bounds[0], bounds[1]],
          [bounds[2], bounds[3]],
        ],
        { padding: 48, duration: 600 },
      );
    }
  }, [routeKey]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    applyStyleMode(map, styleId);
  }, [styleId]);

  if (useFallback) {
    return <CanvasRouteFallback segments={segments} />;
  }

  return <div ref={containerRef} className="h-full w-full bg-void" />;
}
