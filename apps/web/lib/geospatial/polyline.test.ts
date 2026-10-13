import { describe, expect, it } from "vitest";
import { decodePolyline, encodePolyline, fitPolyline, simplifyPolyline } from "./polyline";

// Google's documented example polyline (contains a backtick on purpose).
const GOOGLE_EXAMPLE = ["_p~iF~ps|U_ulLnnqC_mqNvxq", "@"].join(String.fromCharCode(96));

/** A wiggly ~430 km route (Sao Paulo -> Brasilia-like) with n points: far too long for one Static Maps URL. */
function longRoute(n: number) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    pts.push({
      lat: -23.55 + t * (-15.79 + 23.55) + Math.sin(i / 7) * 0.02,
      lng: -46.63 + t * (-47.88 + 46.63) + Math.cos(i / 5) * 0.02,
    });
  }
  return pts;
}

describe("polyline codec", () => {
  it("decodes Google's reference example", () => {
    expect(decodePolyline(GOOGLE_EXAMPLE)).toEqual([
      { lat: 38.5, lng: -120.2 },
      { lat: 40.7, lng: -120.95 },
      { lat: 43.252, lng: -126.453 },
    ]);
  });
  it("round-trips encode/decode at 1e5 precision", () => {
    const pts = longRoute(50);
    const back = decodePolyline(encodePolyline(pts));
    expect(back).toHaveLength(50);
    back.forEach((p, i) => {
      expect(Math.abs(p.lat - pts[i]!.lat)).toBeLessThan(1e-5);
      expect(Math.abs(p.lng - pts[i]!.lng)).toBeLessThan(1e-5);
    });
  });
  it("never throws on garbage and returns what it could read", () => {
    expect(decodePolyline("")).toEqual([]);
    expect(Array.isArray(decodePolyline("\u0000\u0001 not a polyline"))).toBe(true);
  });
});

describe("fitPolyline (Static Maps URL budget)", () => {
  it("returns a short polyline untouched", () => {
    const enc = encodePolyline(longRoute(10));
    expect(fitPolyline(enc, 6000)).toBe(enc);
  });
  it("a 400+ km route with thousands of points is downsampled to fit, endpoints kept", () => {
    const pts = longRoute(6000);
    const enc = encodePolyline(pts);
    expect(encodeURIComponent(enc).length).toBeGreaterThan(6000);
    const fitted = fitPolyline(enc, 6000)!;
    expect(fitted).not.toBeNull();
    expect(encodeURIComponent(fitted).length).toBeLessThanOrEqual(6000);
    const out = decodePolyline(fitted);
    expect(out.length).toBeGreaterThan(2);
    expect(out[0]!.lat).toBeCloseTo(pts[0]!.lat, 4);
    expect(out[0]!.lng).toBeCloseTo(pts[0]!.lng, 4);
    expect(out[out.length - 1]!.lat).toBeCloseTo(pts[pts.length - 1]!.lat, 4);
    expect(out[out.length - 1]!.lng).toBeCloseTo(pts[pts.length - 1]!.lng, 4);
  });
  it("a very short (2-point) route is kept as is", () => {
    const enc = encodePolyline([
      { lat: -23.5505, lng: -46.6333 },
      { lat: -23.5507, lng: -46.6335 },
    ]);
    expect(fitPolyline(enc, 500)).toBe(enc);
  });
  it("input that cannot be made to fit (or has < 2 points) yields null (caller reports map_unavailable)", () => {
    expect(fitPolyline(encodePolyline(longRoute(300)), 4)).toBeNull();
    expect(fitPolyline("?".repeat(10), 5)).toBeNull();
  });
  it("simplification keeps endpoints and never adds points", () => {
    const pts = longRoute(500);
    const s = simplifyPolyline(pts, 500);
    expect(s[0]).toEqual(pts[0]);
    expect(s[s.length - 1]).toEqual(pts[pts.length - 1]);
    expect(s.length).toBeLessThan(pts.length);
  });
});
