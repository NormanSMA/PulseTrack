import type {
  GpxBenchmarkResult,
  GpxParsedRoute,
  GpxSegmentFeature,
  GpxTrackPoint,
  RouteColorMode,
} from "./types";

const EARTH_RADIUS_M = 6_371_000;
const RADIANS_PER_DEGREE = Math.PI / 180;
const METERS_PER_DEGREE = EARTH_RADIUS_M * RADIANS_PER_DEGREE;
const FLAT_ENERGY_COST = 3.6;
const ELEVATION_NOISE_M = 1.5;
const MAX_POINTS = 100_000;
const DEFAULT_EPSILON_M = 5;

type ParseOptions = {
  title?: string;
  activityType?: string;
  source?: "garmin" | "gpx_upload";
  epsilonMeters?: number;
  colorMode?: RouteColorMode;
  maxPoints?: number;
};

export function haversineDistanceM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const halfLat = (lat2 - lat1) * RADIANS_PER_DEGREE / 2;
  const halfLon = (lon2 - lon1) * RADIANS_PER_DEGREE / 2;
  const a = Math.sin(halfLat) ** 2 + Math.sin(halfLon) ** 2 *
    Math.cos(lat1 * RADIANS_PER_DEGREE) * Math.cos(lat2 * RADIANS_PER_DEGREE);
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(Math.min(1, a)));
}

export function minettiEnergyCost(gradeDecimal: number): number {
  const grade = Math.max(-0.45, Math.min(0.45, gradeDecimal));
  return ((((155.4 * grade - 30.4) * grade - 43.3) * grade + 46.3) * grade + 19.5) *
    grade + FLAT_ENERGY_COST;
}

export function simplifyRdp(
  points: readonly GpxTrackPoint[],
  epsilonMeters = DEFAULT_EPSILON_M,
): GpxTrackPoint[] {
  if (!Number.isFinite(epsilonMeters) || epsilonMeters < 0) {
    throw new RangeError("La tolerancia RDP debe ser finita y no negativa.");
  }
  const count = points.length;
  if (count < 3) return [...points];

  const x = new Float64Array(count);
  const y = new Float64Array(count);
  const z = new Float64Array(count);
  const origin = points[0]!;
  const originLat = origin.lat;
  let previousLon = origin.lon;
  let longitudeOffset = -previousLon;
  for (let index = 0; index < count; index++) {
    const point = points[index]!;
    const deltaLon = point.lon - previousLon;
    if (Math.abs(deltaLon) > 180) longitudeOffset -= Math.sign(deltaLon) * 360;
    x[index] = (point.lon + longitudeOffset) * METERS_PER_DEGREE;
    y[index] = (point.lat - originLat) * METERS_PER_DEGREE;
    z[index] = point.eleM;
    previousLon = point.lon;
  }

  const lastIndex = count - 1;
  const keep = new Uint8Array(count);
  keep[0] = 1;
  keep[lastIndex] = 1;
  let stack = new Int32Array(Math.min(count * 2, 1024));
  let stackTop = 0;
  stack[stackTop++] = 0;
  stack[stackTop++] = lastIndex;
  const epsilonSq = epsilonMeters * epsilonMeters;
  const halfRadPerDeg = RADIANS_PER_DEGREE * 0.5;

  while (stackTop > 0) {
    const end = stack[--stackTop]!;
    const start = stack[--stackTop]!;
    const lonScale = Math.cos((points[start]!.lat + points[end]!.lat) * halfRadPerDeg);
    const startX = x[start]!;
    const startY = y[start]!;
    const startZ = z[start]!;
    const dx = (x[end]! - startX) * lonScale;
    const dy = y[end]! - startY;
    const dz = z[end]! - startZ;
    const lengthSq = dx * dx + dy * dy + dz * dz;
    const invLengthSq = lengthSq > 0 ? 1 / lengthSq : 0;
    let farthest = start;
    let maxDistanceSq = epsilonSq;

    for (let index = start + 1; index < end; index++) {
      const px = (x[index]! - startX) * lonScale;
      const py = y[index]! - startY;
      const pz = z[index]! - startZ;
      let fraction = invLengthSq > 0 ? (px * dx + py * dy + pz * dz) * invLengthSq : 0;
      if (fraction < 0) fraction = 0;
      else if (fraction > 1) fraction = 1;
      const rx = px - fraction * dx;
      const ry = py - fraction * dy;
      const rz = pz - fraction * dz;
      const distanceSq = rx * rx + ry * ry + rz * rz;
      if (distanceSq > maxDistanceSq) {
        maxDistanceSq = distanceSq;
        farthest = index;
      }
    }
    if (farthest === start) continue;
    keep[farthest] = 1;
    if (stackTop + 4 > stack.length) {
      const grown = new Int32Array(stack.length * 2);
      grown.set(stack);
      stack = grown;
    }
    if (farthest - start > 1) {
      stack[stackTop++] = start;
      stack[stackTop++] = farthest;
    }
    if (end - farthest > 1) {
      stack[stackTop++] = farthest;
      stack[stackTop++] = end;
    }
  }

  const simplified: GpxTrackPoint[] = [];
  for (let index = 0; index < count; index++) {
    if (keep[index] === 1) simplified.push(points[index]!);
  }
  return simplified;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function calculateGapPaceSecKm(
  points: readonly GpxTrackPoint[],
): { rawPaceSecKm: number | null; gapPaceSecKm: number | null } {
  const count = points.length;
  if (count < 2) return { rawPaceSecKm: null, gapPaceSecKm: null };

  let distanceM = 0;
  let elapsedMs = 0;
  let adjustedMs = 0;
  const prev = points[0]!;
  let prevTime = prev.timeMs;
  let prevDist = prev.cumDistM;
  let prevTimeValid = typeof prevTime === "number" && Number.isFinite(prevTime);

  for (let index = 1; index < count; index++) {
    const end = points[index]!;
    const endTime = end.timeMs;
    const endDist = end.cumDistM;
    const endTimeValid = typeof endTime === "number" && Number.isFinite(endTime);
    if (prevTimeValid && endTimeValid) {
      const segmentMs = endTime! - prevTime!;
      const segmentM = endDist - prevDist;
      const gradePct = end.gradePct;
      if (segmentMs > 0 && Number.isFinite(segmentMs) &&
          segmentM > 0 && Number.isFinite(segmentM) && Number.isFinite(gradePct)) {
        distanceM += segmentM;
        elapsedMs += segmentMs;
        adjustedMs += segmentMs * FLAT_ENERGY_COST / minettiEnergyCost(gradePct * 0.01);
      }
    }
    prevTime = endTime;
    prevDist = endDist;
    prevTimeValid = endTimeValid;
  }
  if (!distanceM) return { rawPaceSecKm: null, gapPaceSecKm: null };
  // Milliseconds per meter equal seconds per kilometer.
  const rawPaceSecKm = elapsedMs / distanceM;
  const gapPaceSecKm = adjustedMs / distanceM;
  return {
    rawPaceSecKm: Number.isFinite(rawPaceSecKm) ? rawPaceSecKm : null,
    gapPaceSecKm: Number.isFinite(gapPaceSecKm) ? gapPaceSecKm : null,
  };
}

type AerobicHalf = {
  distanceM: number;
  hrSum: number;
  thermalMs: number;
  thermalHrSum: number;
  tempSum: number;
};

function interpolateSample(
  first: number | null,
  last: number | null,
  fraction: number,
): number | null {
  if (first === null) return last;
  return last === null ? first : first * (1 - fraction) + last * fraction;
}

function accumulateAerobicHalf(
  half: AerobicHalf,
  start: GpxTrackPoint,
  end: GpxTrackPoint,
  distanceM: number,
  elapsedMs: number,
  fraction: number,
): void {
  const startHr = isFiniteNumber(start.hrBpm) && start.hrBpm > 0 ? start.hrBpm : null;
  const endHr = isFiniteNumber(end.hrBpm) && end.hrBpm > 0 ? end.hrBpm : null;
  const hrBpm = interpolateSample(startHr, endHr, fraction);
  if (hrBpm === null) return;
  half.distanceM += distanceM;
  half.hrSum += elapsedMs * hrBpm;

  const startTemp = startHr !== null && isFiniteNumber(start.tempC) ? start.tempC : null;
  const endTemp = endHr !== null && isFiniteNumber(end.tempC) ? end.tempC : null;
  const tempC = interpolateSample(startTemp, endTemp, fraction);
  const thermalHr = interpolateSample(startTemp === null ? null : startHr, endTemp === null ? null : endHr, fraction);
  if (tempC === null || thermalHr === null) return;
  half.thermalMs += elapsedMs;
  half.thermalHrSum += elapsedMs * thermalHr;
  half.tempSum += elapsedMs * tempC;
}

export function calculateAerobicDecoupling(
  points: readonly GpxTrackPoint[],
): { paHrDecouplingPct: number | null; thermalDriftBpm: number | null } {
  const empty = { paHrDecouplingPct: null, thermalDriftBpm: null };
  const firstTime = points.find((point) => isFiniteNumber(point.timeMs))?.timeMs;
  let lastTime: number | null = null;
  for (let index = points.length - 1; index >= 0; index--) {
    const time = points[index]!.timeMs;
    if (!isFiniteNumber(time)) continue;
    lastTime = time;
    break;
  }
  if (!isFiniteNumber(firstTime) || lastTime === null || lastTime <= firstTime) return empty;
  const midpoint = firstTime / 2 + lastTime / 2;
  const first: AerobicHalf = {
    distanceM: 0, hrSum: 0, thermalMs: 0, thermalHrSum: 0, tempSum: 0,
  };
  const last = { ...first };

  for (let index = 1; index < points.length; index++) {
    const start = points[index - 1]!;
    const end = points[index]!;
    if (!isFiniteNumber(start.timeMs) || !isFiniteNumber(end.timeMs)) continue;
    const segmentMs = end.timeMs - start.timeMs;
    const distanceM = end.cumDistM - start.cumDistM;
    if (segmentMs <= 0 || !Number.isFinite(segmentMs) || distanceM < 0 ||
        !Number.isFinite(distanceM)) continue;
    const firstMs = Math.max(0, Math.min(segmentMs, midpoint - start.timeMs));
    const firstFraction = firstMs / segmentMs;
    if (firstMs > 0) {
      accumulateAerobicHalf(first, start, end, distanceM * firstFraction, firstMs, firstFraction / 2);
    }
    const lastMs = segmentMs - firstMs;
    if (lastMs > 0) {
      accumulateAerobicHalf(last, start, end, distanceM * (1 - firstFraction), lastMs, (1 + firstFraction) / 2);
    }
  }

  // Dividing speed by time-weighted HR cancels elapsed time.
  const firstEfficiency = first.distanceM / first.hrSum;
  const lastEfficiency = last.distanceM / last.hrSum;
  const decoupling = (1 - lastEfficiency / firstEfficiency) * 100;
  const deltaTemp = last.tempSum / last.thermalMs - first.tempSum / first.thermalMs;
  const deltaHr = last.thermalHrSum / last.thermalMs - first.thermalHrSum / first.thermalMs;
  // Express the heart-rate change in the direction of warming.
  const thermalDrift = Math.abs(deltaTemp) < 1e-9 ? 0 : Math.sign(deltaTemp) * deltaHr;
  return {
    paHrDecouplingPct: Number.isFinite(decoupling) ? Number(decoupling.toFixed(2)) : null,
    thermalDriftBpm: Number.isFinite(thermalDrift) ? Number(thermalDrift.toFixed(2)) : null,
  };
}

export function toPostgisLineStringZ(points: readonly GpxTrackPoint[]): string {
  if (points.length < 2) throw new RangeError("Una ruta WKT requiere al menos dos puntos.");
  return `LINESTRING Z(${points.map(({ lon, lat, eleM }) => `${lon} ${lat} ${eleM}`).join(", ")})`;
}

function segmentColor(gradePct: number, hrBpm: number | null, mode: RouteColorMode): string {
  if (mode === "hr") {
    if (hrBpm === null || hrBpm < 120) return "#60A5FA";
    if (hrBpm < 150) return "#4ADE80";
    if (hrBpm < 170) return "#FBBF24";
    return "#F87171";
  }
  if (gradePct <= -3) return "#60A5FA";
  if (gradePct < 3) return "#4ADE80";
  if (gradePct < 8) return "#FBBF24";
  return "#F87171";
}

export function buildColoredSegmentsGeoJson(
  points: readonly GpxTrackPoint[],
  colorMode: RouteColorMode = "grade",
): GpxParsedRoute["segmentsGeoJson"] {
  const features: GpxSegmentFeature[] = [];
  for (let index = 1; index < points.length; index++) {
    const start = points[index - 1]!;
    const end = points[index]!;
    const { gradePct, hrBpm } = end;
    features.push({
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [[start.lon, start.lat, start.eleM], [end.lon, end.lat, end.eleM]],
      },
      properties: { index: index - 1, gradePct, hrBpm, colorHex: segmentColor(gradePct, hrBpm, colorMode) },
    });
  }
  return { type: "FeatureCollection", features };
}

const STRIP_XML_NOISE_RE = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>/g;

function isPrefixChar(code: number): boolean {
  return (
    (code >= 97 && code <= 122) ||
    (code >= 65 && code <= 90) ||
    (code >= 48 && code <= 57) ||
    code === 95 ||
    code === 45 ||
    code === 46
  );
}

function isXmlNameChar(code: number): boolean {
  return isPrefixChar(code) || code === 58;
}

function numericSlice(source: string, start: number, end: number, name: string): number {
  let s = start;
  let e = end;
  while (s < e && source.charCodeAt(s) <= 32) s++;
  while (e > s && source.charCodeAt(e - 1) <= 32) e--;
  if (s >= e) throw new RangeError(`Valor GPX inválido para ${name}.`);
  const number = Number(source.slice(s, e));
  if (!Number.isFinite(number)) throw new RangeError(`Valor GPX inválido para ${name}.`);
  return number;
}

function parseFixedDigits(source: string, offset: number, count: number): number {
  let value = 0;
  for (let i = 0; i < count; i++) {
    const digit = source.charCodeAt(offset + i) - 48;
    if (digit < 0 || digit > 9) return -1;
    value = value * 10 + digit;
  }
  return value;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  }
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

function parseIsoTimestampRange(source: string, start: number, end: number): number | null {
  let s = start;
  let e = end;
  while (s < e && source.charCodeAt(s) <= 32) s++;
  while (e > s && source.charCodeAt(e - 1) <= 32) e--;
  const len = e - s;
  if ((len === 20 || (len === 24 && source.charCodeAt(s + 19) === 46)) &&
      source.charCodeAt(e - 1) === 90 &&
      source.charCodeAt(s + 4) === 45 &&
      source.charCodeAt(s + 7) === 45 &&
      source.charCodeAt(s + 10) === 84 &&
      source.charCodeAt(s + 13) === 58 &&
      source.charCodeAt(s + 16) === 58) {
    const year = parseFixedDigits(source, s, 4);
    const month = parseFixedDigits(source, s + 5, 2);
    const day = parseFixedDigits(source, s + 8, 2);
    const hour = parseFixedDigits(source, s + 11, 2);
    const minute = parseFixedDigits(source, s + 14, 2);
    const second = parseFixedDigits(source, s + 17, 2);
    const ms = len === 24 ? parseFixedDigits(source, s + 20, 3) : 0;
    if (year >= 0 && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month) &&
        hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 && second >= 0 && second <= 59 && ms >= 0) {
      return Date.UTC(year, month - 1, day, hour, minute, second, ms);
    }
  }
  if (s >= e) return null;
  const timestamp = Date.parse(source.slice(s, e));
  return Number.isFinite(timestamp) ? timestamp : null;
}

function coordinateAttributesRange(
  source: string,
  start: number,
  end: number,
): { lat: number; lon: number } {
  let pos = start;
  let lat = NaN;
  let lon = NaN;
  let hasLat = false;
  let hasLon = false;
  while (pos < end) {
    while (pos < end && source.charCodeAt(pos) <= 32) pos++;
    if (pos >= end) break;
    const nameStart = pos;
    while (pos < end && isXmlNameChar(source.charCodeAt(pos))) pos++;
    if (pos === nameStart) throw new SyntaxError("Atributo GPX inválido.");
    const nameEnd = pos;
    while (pos < end && source.charCodeAt(pos) <= 32) pos++;
    if (pos >= end || source.charCodeAt(pos) !== 61) throw new SyntaxError("Atributo GPX inválido.");
    pos++;
    while (pos < end && source.charCodeAt(pos) <= 32) pos++;
    if (pos >= end) throw new SyntaxError("Atributo GPX inválido.");
    const quote = source.charCodeAt(pos);
    if (quote !== 34 && quote !== 39) throw new SyntaxError("Atributo GPX inválido.");
    const valStart = pos + 1;
    const valEnd = source.indexOf(quote === 34 ? '"' : "'", valStart);
    if (valEnd === -1 || valEnd >= end) throw new SyntaxError("Atributo GPX inválido.");
    pos = valEnd + 1;
    if (pos < end && source.charCodeAt(pos) > 32) throw new SyntaxError("Atributo GPX inválido.");
    if (nameEnd - nameStart === 3) {
      const c0 = source.charCodeAt(nameStart);
      const c1 = source.charCodeAt(nameStart + 1);
      const c2 = source.charCodeAt(nameStart + 2);
      if (c0 === 108 && c1 === 97 && c2 === 116) {
        lat = numericSlice(source, valStart, valEnd, "lat");
        hasLat = true;
      } else if (c0 === 108 && c1 === 111 && c2 === 110) {
        lon = numericSlice(source, valStart, valEnd, "lon");
        hasLon = true;
      }
    }
  }
  if (!hasLat) throw new RangeError("Valor GPX inválido para lat.");
  if (!hasLon) throw new RangeError("Valor GPX inválido para lon.");
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    throw new RangeError("Coordenadas GPX fuera de rango.");
  }
  return { lat, lon };
}

function regionsEqual(xml: string, aStart: number, bStart: number, length: number): boolean {
  for (let i = 0; i < length; i++) {
    if (xml.charCodeAt(aStart + i) !== xml.charCodeAt(bStart + i)) return false;
  }
  return true;
}

function isWhitespaceOnly(xml: string, start: number, end: number): boolean {
  for (let i = start; i < end; i++) {
    if (xml.charCodeAt(i) > 32) return false;
  }
  return true;
}

function matchPointField(xml: string, localStart: number, localLen: number): "ele" | "time" | "hr" | "atemp" | "temp" | null {
  if (localLen === 3) {
    if (xml.charCodeAt(localStart) === 101 && xml.charCodeAt(localStart + 1) === 108 && xml.charCodeAt(localStart + 2) === 101) {
      return "ele";
    }
  } else if (localLen === 4) {
    const c0 = xml.charCodeAt(localStart);
    const c1 = xml.charCodeAt(localStart + 1);
    const c2 = xml.charCodeAt(localStart + 2);
    const c3 = xml.charCodeAt(localStart + 3);
    if (c0 === 116 && c1 === 105 && c2 === 109 && c3 === 101) return "time";
    if (c0 === 116 && c1 === 101 && c2 === 109 && c3 === 112) return "temp";
  } else if (localLen === 2) {
    if (xml.charCodeAt(localStart) === 104 && xml.charCodeAt(localStart + 1) === 114) return "hr";
  } else if (localLen === 5) {
    if (xml.charCodeAt(localStart) === 97 && xml.charCodeAt(localStart + 1) === 116 &&
        xml.charCodeAt(localStart + 2) === 101 && xml.charCodeAt(localStart + 3) === 109 &&
        xml.charCodeAt(localStart + 4) === 112) {
      return "atemp";
    }
  }
  return null;
}

function parseTrackPointRange(
  xml: string,
  attrStart: number,
  attrEnd: number,
  bodyStart: number,
  bodyEnd: number,
  previous: GpxTrackPoint | undefined,
): GpxTrackPoint {
  const { lat, lon } = coordinateAttributesRange(xml, attrStart, attrEnd);
  let eleM = previous ? previous.eleM : 0;
  let timeMs: number | null = null;
  let hrBpm: number | null = null;
  let tempC: number | null = null;

  let pos = bodyStart < bodyEnd ? xml.indexOf("<", bodyStart) : -1;
  while (pos !== -1 && pos < bodyEnd) {
    const afterLt = xml.charCodeAt(pos + 1);
    if (afterLt === 47 || afterLt === 63 || afterLt === 33) {
      const skipGt = xml.indexOf(">", pos + 2);
      if (skipGt === -1 || skipGt >= bodyEnd) break;
      pos = xml.indexOf("<", skipGt + 1);
      continue;
    }
    const gt = xml.indexOf(">", pos + 1);
    if (gt === -1 || gt >= bodyEnd) break;
    if (xml.charCodeAt(gt - 1) === 47) {
      pos = xml.indexOf("<", gt + 1);
      continue;
    }

    let nameEnd = pos + 1;
    let colonPos = -1;
    let validName = true;
    while (nameEnd < gt) {
      const code = xml.charCodeAt(nameEnd);
      if (code <= 32) break;
      if (code === 58) {
        if (colonPos !== -1 || nameEnd === pos + 1) {
          validName = false;
          break;
        }
        colonPos = nameEnd;
      } else if (!isPrefixChar(code)) {
        validName = false;
        break;
      }
      nameEnd++;
    }

    if (!validName || !isWhitespaceOnly(xml, nameEnd, gt)) {
      pos = xml.indexOf("<", gt + 1);
      continue;
    }

    const localStart = colonPos === -1 ? pos + 1 : colonPos + 1;
    const field = matchPointField(xml, localStart, nameEnd - localStart);
    if (field === null) {
      pos = xml.indexOf("<", gt + 1);
      continue;
    }

    const valEnd = xml.indexOf("<", gt + 1);
    if (valEnd === -1 || valEnd >= bodyEnd || xml.charCodeAt(valEnd + 1) !== 47) {
      pos = xml.indexOf("<", gt + 1);
      continue;
    }
    const closeGt = xml.indexOf(">", valEnd + 2);
    if (closeGt === -1 || closeGt >= bodyEnd) {
      pos = xml.indexOf("<", gt + 1);
      continue;
    }
    const fullLen = nameEnd - (pos + 1);
    if (valEnd + 2 + fullLen > closeGt ||
        !regionsEqual(xml, pos + 1, valEnd + 2, fullLen) ||
        !isWhitespaceOnly(xml, valEnd + 2 + fullLen, closeGt)) {
      pos = xml.indexOf("<", gt + 1);
      continue;
    }

    switch (field) {
      case "ele":
        eleM = numericSlice(xml, gt + 1, valEnd, "ele");
        break;
      case "time":
        timeMs = parseIsoTimestampRange(xml, gt + 1, valEnd);
        break;
      case "hr": {
        const hr = numericSlice(xml, gt + 1, valEnd, "hr");
        hrBpm = hr > 0 ? hr : null;
        break;
      }
      case "atemp":
      case "temp":
        tempC = numericSlice(xml, gt + 1, valEnd, field);
        break;
    }
    pos = xml.indexOf("<", closeGt + 1);
  }

  const distanceM = previous ? haversineDistanceM(previous.lat, previous.lon, lat, lon) : 0;
  const prevEle = previous ? previous.eleM : eleM;
  const riseM = eleM - prevEle;
  const gradePct = distanceM > 0 ? (riseM / distanceM) * 100 : 0;
  if (!Number.isFinite(gradePct) || !Number.isFinite(riseM)) {
    throw new RangeError("Pendiente GPX fuera de rango.");
  }
  return {
    lat,
    lon,
    eleM,
    timeMs,
    hrBpm,
    tempC,
    gradePct,
    cumDistM: (previous ? previous.cumDistM : 0) + distanceM,
  };
}

function decodeXmlText(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|apos|#(?:x[\da-fA-F]+|\d+));/g, (entity, code: string) => {
    switch (code) {
      case "amp": return "&";
      case "lt": return "<";
      case "gt": return ">";
      case "quot": return '"';
      case "apos": return "'";
      default: {
        const value = code.startsWith("#x") ? Number.parseInt(code.slice(2), 16) : Number(code.slice(1));
        return value <= 0x10ffff ? String.fromCodePoint(value) : entity;
      }
    }
  }).trim();
}

type TrkptTagCursor = {
  tagStart: number;
  nameStart: number;
  nameEnd: number;
  attrStart: number;
  attrEnd: number;
  gt: number;
  isClosing: boolean;
  isSelfClosing: boolean;
};

function findNextTrkptTag(xml: string, fromIndex: number, out: TrkptTagCursor): boolean {
  let cursor = fromIndex;
  while (true) {
    const idx = xml.indexOf("trkpt", cursor);
    if (idx === -1) return false;
    const nameEnd = idx + 5;
    const after = xml.charCodeAt(nameEnd);
    if (after > 32 && after !== 47 && after !== 62) {
      cursor = nameEnd;
      continue;
    }

    let nameStart = idx;
    if (idx > 0 && xml.charCodeAt(idx - 1) === 58) {
      let scan = idx - 2;
      while (scan >= 0 && isPrefixChar(xml.charCodeAt(scan))) scan--;
      if (scan + 1 >= idx - 1) {
        cursor = nameEnd;
        continue;
      }
      nameStart = scan + 1;
    }

    let isClosing = false;
    let tagStart = -1;
    if (nameStart >= 1 && xml.charCodeAt(nameStart - 1) === 60) {
      tagStart = nameStart - 1;
    } else if (nameStart >= 2 && xml.charCodeAt(nameStart - 1) === 47 && xml.charCodeAt(nameStart - 2) === 60) {
      isClosing = true;
      tagStart = nameStart - 2;
    } else {
      cursor = nameEnd;
      continue;
    }

    const gt = xml.indexOf(">", nameEnd);
    if (gt === -1) return false;
    const innerLt = xml.indexOf("<", nameEnd);
    if (innerLt !== -1 && innerLt < gt) {
      cursor = innerLt;
      continue;
    }
    const isSelfClosing = gt - 1 >= nameEnd && xml.charCodeAt(gt - 1) === 47;
    out.tagStart = tagStart;
    out.nameStart = nameStart;
    out.nameEnd = nameEnd;
    out.attrStart = nameEnd;
    out.attrEnd = isSelfClosing ? gt - 1 : gt;
    out.gt = gt;
    out.isClosing = isClosing;
    out.isSelfClosing = isSelfClosing;
    return true;
  }
}

function readGpxPoints(gpxXml: string, maxPoints: number) {
  const hasXmlNoise = gpxXml.includes("<!--") || gpxXml.includes("<![CDATA[") || gpxXml.includes("<?");
  const xml = hasXmlNoise
    ? gpxXml.replace(
      STRIP_XML_NOISE_RE,
      (_, cdata: string | undefined) => cdata?.replace(/&/g, "&amp;").replace(/</g, "&lt;") ?? "",
    )
    : gpxXml;
  const points: GpxTrackPoint[] = [];
  let firstPointOffset = 0;
  let cursor = 0;
  let previous: GpxTrackPoint | undefined;
  const tag: TrkptTagCursor = {
    tagStart: 0,
    nameStart: 0,
    nameEnd: 0,
    attrStart: 0,
    attrEnd: 0,
    gt: 0,
    isClosing: false,
    isSelfClosing: false,
  };

  while (findNextTrkptTag(xml, cursor, tag)) {
    if (tag.isClosing) throw new SyntaxError("Cierre de punto GPX sin apertura.");
    if (points.length === maxPoints) throw new RangeError(`La ruta GPX excede ${maxPoints} puntos.`);
    if (points.length === 0) firstPointOffset = tag.tagStart;

    const attrStart = tag.attrStart;
    const attrEnd = tag.attrEnd;
    let bodyStart = 0;
    let bodyEnd = 0;
    if (tag.isSelfClosing) {
      cursor = tag.gt + 1;
    } else {
      const openNameStart = tag.nameStart;
      const openLen = tag.nameEnd - openNameStart;
      const openGt = tag.gt;
      if (!findNextTrkptTag(xml, openGt + 1, tag) ||
          !tag.isClosing ||
          tag.nameEnd - tag.nameStart !== openLen ||
          !regionsEqual(xml, openNameStart, tag.nameStart, openLen) ||
          !isWhitespaceOnly(xml, tag.attrStart, tag.gt)) {
        throw new SyntaxError("Punto GPX sin cierre válido.");
      }
      bodyStart = openGt + 1;
      bodyEnd = tag.tagStart;
      cursor = tag.gt + 1;
    }

    const point = parseTrackPointRange(
      xml,
      attrStart,
      attrEnd,
      bodyStart,
      bodyEnd,
      previous,
    );
    points.push(point);
    previous = point;
  }
  if (points.length < 2) throw new RangeError("Una ruta GPX requiere al menos dos puntos.");
  return { points, header: xml.slice(0, firstPointOffset) };
}

function routeMetadata(header: string) {
  const track = /<(?:[\w.-]+:)?trk(?:\s[^>]*)?>([\s\S]*)/.exec(header)?.[1] ?? "";
  const metadata = /<((?:[\w.-]+:)?metadata)(?:\s[^>]*)?>([\s\S]*?)<\/\1\s*>/.exec(header)?.[2] ?? "";
  const nameTag = /<((?:[\w.-]+:)?name)\s*>([^<]*)<\/\1\s*>/;
  const typeTag = /<((?:[\w.-]+:)?type)\s*>([^<]*)<\/\1\s*>/;
  const title = decodeXmlText(nameTag.exec(track)?.[2] ?? nameTag.exec(metadata)?.[2] ?? "").slice(0, 120);
  const activityType = decodeXmlText(typeTag.exec(track || header)?.[2] ?? "").slice(0, 40);
  return { title: title || "Ruta GPX", activityType: activityType || "running" };
}

function calculateElevation(points: readonly GpxTrackPoint[]) {
  let anchor = points[0]!.eleM;
  let extreme = anchor;
  let direction = 0;
  let elevationGainM = 0;
  let elevationLossM = 0;
  for (const { eleM } of points) {
    if (direction === 0) {
      if (Math.abs(eleM - anchor) < ELEVATION_NOISE_M) continue;
      direction = Math.sign(eleM - anchor);
      extreme = eleM;
    } else if ((eleM - extreme) * direction >= 0) {
      extreme = eleM;
    } else if (Math.abs(eleM - extreme) >= ELEVATION_NOISE_M) {
      if (direction > 0) elevationGainM += extreme - anchor;
      else elevationLossM += anchor - extreme;
      anchor = extreme;
      extreme = eleM;
      direction = -direction;
    }
  }
  if (direction > 0) elevationGainM += extreme - anchor;
  if (direction < 0) elevationLossM += anchor - extreme;
  if (!Number.isFinite(elevationGainM) || !Number.isFinite(elevationLossM)) {
    throw new RangeError("Desnivel GPX fuera de rango.");
  }
  return { elevationGainM, elevationLossM };
}

function summarizeSamples(points: readonly GpxTrackPoint[]) {
  let firstTime: number | null = null;
  let lastTime: number | null = null;
  let hrSum = 0;
  let hrCount = 0;
  let tempSum = 0;
  let tempCount = 0;
  for (const { timeMs, hrBpm, tempC } of points) {
    if (timeMs !== null) {
      firstTime ??= timeMs;
      lastTime = timeMs;
    }
    if (hrBpm !== null) {
      hrSum += hrBpm;
      hrCount++;
    }
    if (tempC !== null) {
      tempSum += tempC;
      tempCount++;
    }
  }
  return {
    startedAt: new Date(firstTime ?? 0).toISOString(),
    durationSec: Math.max(0, ((lastTime ?? 0) - (firstTime ?? 0)) / 1000),
    avgHrBpm: hrCount && Number.isFinite(hrSum) ? hrSum / hrCount : null,
    avgTempC: tempCount && Number.isFinite(tempSum) ? tempSum / tempCount : null,
  };
}

function fnv1a64(text: string): string {
  // Prime 0x100000001b3 split into two 32-bit words.
  let high = 0xcbf29ce4;
  let low = 0x84222325;
  for (const byte of new TextEncoder().encode(text)) {
    low = (low ^ byte) >>> 0;
    const product = low * 0x1b3;
    high = (Math.imul(high, 0x1b3) + Math.imul(low, 0x100) + Math.floor(product / 0x100000000)) >>> 0;
    low = product >>> 0;
  }
  return high.toString(16).padStart(8, "0") + low.toString(16).padStart(8, "0");
}

export function parseGpxTrack(gpxXml: string, options: ParseOptions = {}): GpxParsedRoute {
  const started = performance.now();
  const maxPoints = options.maxPoints ?? MAX_POINTS;
  if (!Number.isInteger(maxPoints) || maxPoints < 2) {
    throw new RangeError("El límite GPX debe ser un entero de al menos dos puntos.");
  }
  const { points, header } = readGpxPoints(gpxXml, Math.min(maxPoints, MAX_POINTS));
  const simplified = simplifyRdp(points, options.epsilonMeters);
  const segmentPoints = simplified.map((point, index) => {
    const previous = simplified[index - 1];
    if (!previous) return point;
    const distanceM = point.cumDistM - previous.cumDistM;
    const gradePct = distanceM > 0 ? (point.eleM - previous.eleM) / distanceM * 100 : 0;
    return { ...point, gradePct };
  });
  const { title, activityType } = routeMetadata(header);
  return {
    externalId: `gpx-${fnv1a64(gpxXml)}`,
    title: options.title ?? title,
    activityType: options.activityType ?? activityType,
    source: options.source ?? "gpx_upload",
    ...summarizeSamples(points),
    ...calculateElevation(points),
    ...calculateGapPaceSecKm(points),
    ...calculateAerobicDecoupling(points),
    distanceM: points.at(-1)!.cumDistM,
    pointsCount: points.length,
    simplifiedCount: simplified.length,
    points,
    wktLineStringZ: toPostgisLineStringZ(simplified),
    segmentsGeoJson: buildColoredSegmentsGeoJson(segmentPoints, options.colorMode),
    processingMs: performance.now() - started,
  };
}

export function generateSyntheticMountainGpx(pointCount: number): string {
  if (!Number.isInteger(pointCount) || pointCount < 0 || pointCount > MAX_POINTS) {
    throw new RangeError(`El tamaño GPX debe ser un entero entre 0 y ${MAX_POINTS}.`);
  }
  const parts = ['<gpx version="1.1"><trk><name>Ruta sintética</name><type>running</type><trkseg>'];
  const startTime = Date.UTC(2026, 0, 1);
  for (let index = 0; index < pointCount; index++) {
    const lat = 12.1 + index * 0.00002;
    const lon = -86.2 + 0.001 * Math.sin(index / 200);
    const eleM = 900 + 75 * Math.sin(index / 500);
    const time = new Date(startTime + 1000 * index).toISOString();
    parts.push(`<trkpt lat="${lat.toFixed(7)}" lon="${lon.toFixed(7)}"><ele>${eleM.toFixed(2)}</ele><time>${time}</time></trkpt>`);
  }
  parts.push("</trkseg></trk></gpx>");
  return parts.join("");
}

export function runGpxBenchmark(pointCount = 50_000): GpxBenchmarkResult {
  const xml = generateSyntheticMountainGpx(pointCount);
  const start = performance.now();
  const { points } = readGpxPoints(xml, MAX_POINTS);
  const parsed = performance.now();
  const simplified = simplifyRdp(points);
  const simplifiedAt = performance.now();
  calculateGapPaceSecKm(points);
  const end = performance.now();
  const totalMs = end - start;
  return {
    pointCount: points.length,
    simplifiedCount: simplified.length,
    parseMs: parsed - start,
    rdpMs: simplifiedAt - parsed,
    gapMs: end - simplifiedAt,
    totalMs,
    withinBudget16Ms: totalMs < 16,
  };
}
