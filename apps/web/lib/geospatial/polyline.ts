/**
 * Pure helpers for Google's encoded polyline format (no I/O, no secrets - unit-tested in polyline.test.ts).
 * Used by the route-map module to keep the Static Maps request URL under Google's 8192-character limit: a long
 * route (400+ km) has a polyline that does not fit, so it is decoded, simplified (Douglas-Peucker, endpoints are
 * always kept) and re-encoded until the final URL fits.
 */

export interface PolyPoint {
  lat: number;
  lng: number;
}

/** Decodes an encoded polyline (precision 1e5). Malformed input yields as many points as could be read. */
export function decodePolyline(encoded: string): PolyPoint[] {
  const points: PolyPoint[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  const readValue = (): number | null => {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      if (index >= encoded.length) return null;
      byte = encoded.charCodeAt(index++) - 63;
      if (byte < 0 || byte > 63) return null;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && shift < 35);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < encoded.length) {
    const dLat = readValue();
    if (dLat === null) break;
    const dLng = readValue();
    if (dLng === null) break;
    lat += dLat;
    lng += dLng;
    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return points;
}

function encodeValue(value: number): string {
  let v = value < 0 ? ~(value << 1) : value << 1;
  let out = "";
  while (v >= 0x20) {
    out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
    v >>= 5;
  }
  return out + String.fromCharCode(v + 63);
}

export function encodePolyline(points: readonly PolyPoint[]): string {
  let prevLat = 0;
  let prevLng = 0;
  let out = "";
  for (const p of points) {
    const lat = Math.round(p.lat * 1e5);
    const lng = Math.round(p.lng * 1e5);
    out += encodeValue(lat - prevLat) + encodeValue(lng - prevLng);
    prevLat = lat;
    prevLng = lng;
  }
  return out;
}

/** Perpendicular distance in metres (equirectangular approximation - plenty for simplification). */
function distanceToSegmentM(p: PolyPoint, a: PolyPoint, b: PolyPoint): number {
  const kLat = 111_320;
  const kLng = 111_320 * Math.cos((a.lat * Math.PI) / 180);
  const px = (p.lng - a.lng) * kLng;
  const py = (p.lat - a.lat) * kLat;
  const bx = (b.lng - a.lng) * kLng;
  const by = (b.lat - a.lat) * kLat;
  const len2 = bx * bx + by * by;
  if (len2 === 0) return Math.hypot(px, py);
  const t = Math.max(0, Math.min(1, (px * bx + py * by) / len2));
  return Math.hypot(px - t * bx, py - t * by);
}

/** Douglas-Peucker (iterative). First and last points are always kept. */
export function simplifyPolyline(points: readonly PolyPoint[], toleranceM: number): PolyPoint[] {
  if (points.length <= 2) return [...points];
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [start, end] = stack.pop()!;
    let maxDist = 0;
    let maxIdx = -1;
    for (let i = start + 1; i < end; i++) {
      const d = distanceToSegmentM(points[i]!, points[start]!, points[end]!);
      if (d > maxDist) {
        maxDist = d;
        maxIdx = i;
      }
    }
    if (maxIdx !== -1 && maxDist > toleranceM) {
      keep[maxIdx] = 1;
      stack.push([start, maxIdx], [maxIdx, end]);
    }
  }
  return points.filter((_, i) => keep[i] === 1);
}

/**
 * Returns an encoded polyline whose URL-encoded form is at most `maxEncodedLength` characters, keeping the
 * endpoints. The original string is returned untouched when it already fits. Returns null when even the two
 * endpoints do not fit (cannot happen with sane limits) or the input cannot be decoded to 2+ points.
 */
export function fitPolyline(encoded: string, maxEncodedLength: number): string | null {
  const fits = (s: string) => encodeURIComponent(s).length <= maxEncodedLength;
  if (fits(encoded)) return encoded;
  const points = decodePolyline(encoded);
  if (points.length < 2) return null;
  let tolerance = 20;
  for (let i = 0; i < 24; i++) {
    const candidate = encodePolyline(simplifyPolyline(points, tolerance));
    if (fits(candidate)) return candidate;
    tolerance *= 1.8;
  }
  const endpoints = encodePolyline([points[0]!, points[points.length - 1]!]);
  return fits(endpoints) ? endpoints : null;
}
