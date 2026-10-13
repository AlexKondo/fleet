import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const kinds: string[] = [];
vi.mock("./costGuard", () => ({
  withCostGuard: async (_org: string, kind: string, doCall: () => Promise<unknown>) => (kinds.push(kind), { status: "ok", result: await doCall() }),
}));

import { buildStaticMapUrl, fetchRouteMapImage, MAX_IMAGE_BYTES, STATIC_MAP_URL_LIMIT } from "./routeMap";
import { encodePolyline } from "./polyline";

const KEY = "AIzaSyFAKEKEYFORROUTEMAPTESTS0123456789a";
const ORIGINAL = process.env.GOOGLE_MAPS_API_KEY;
const O = { lat: -23.5505, lng: -46.6333 };
const D = { lat: -15.7939, lng: -47.8828 };
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

function bigPolyline(n: number): string {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    pts.push({ lat: O.lat + t * (D.lat - O.lat) + Math.sin(i / 7) * 0.02, lng: O.lng + t * (D.lng - O.lng) + Math.cos(i / 5) * 0.02 });
  }
  return encodePolyline(pts);
}

describe("buildStaticMapUrl", () => {
  it("long route (400+ km, thousands of points): URL fits Google's 8192 limit", () => {
    const url = buildStaticMapUrl({ encodedPolyline: bigPolyline(8000), origin: O, destination: D, apiKey: KEY })!;
    expect(url).not.toBeNull();
    expect(url.length).toBeLessThanOrEqual(STATIC_MAP_URL_LIMIT);
    expect(url).toContain("size=640x360");
    expect(url).toContain("scale=2");
    expect(url).toContain("language=pt-BR");
    expect(decodeURIComponent(url)).toContain("color:0x2369c8ff|weight:5|enc:");
  });
  it("very short route works and is not downsampled", () => {
    const enc = encodePolyline([O, { lat: O.lat + 0.0002, lng: O.lng + 0.0002 }]);
    const url = buildStaticMapUrl({ encodedPolyline: enc, origin: O, destination: O, apiKey: KEY })!;
    expect(url.length).toBeLessThan(900);
    expect(url).toContain(encodeURIComponent(enc));
  });
});

describe("fetchRouteMapImage", () => {
  beforeEach(() => {
    process.env.GOOGLE_MAPS_API_KEY = KEY;
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    process.env.GOOGLE_MAPS_API_KEY = ORIGINAL;
    vi.unstubAllGlobals();
  });
  const args = { encodedPolyline: encodePolyline([O, D]), origin: O, destination: D };
  const mockFetch = (r: unknown) =>
    (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => (r instanceof Error ? Promise.reject(r) : Promise.resolve(r)));
  const resp = (over: Partial<{ ok: boolean; status: number; type: string; len: string; bytes: Uint8Array }> = {}) => {
    const bytes = over.bytes ?? PNG;
    return {
      ok: over.ok ?? true,
      status: over.status ?? 200,
      headers: new Headers({ "content-type": over.type ?? "image/png", ...(over.len ? { "content-length": over.len } : {}) }),
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    };
  };

  it("ok -> data:image/png;base64 and the key only goes in the outgoing request", async () => {
    mockFetch(resp());
    const out = await fetchRouteMapImage("org", args);
    expect(out.status).toBe("ok");
    if (out.status === "ok") {
      expect(out.dataUrl.startsWith("data:image/png;base64,")).toBe(true);
      expect(out.dataUrl).not.toContain(KEY);
    }
    const calledUrl = String((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![0]);
    expect(calledUrl.startsWith("https://maps.googleapis.com/maps/api/staticmap?")).toBe(true);
  });
  it.each([
    ["non-png content type", () => resp({ type: "text/html" }), "static_bad_content_type"],
    ["not really a PNG", () => resp({ bytes: new Uint8Array([1, 2, 3, 4]) }), "static_bad_content_type"],
    ["declared too large", () => resp({ len: String(MAX_IMAGE_BYTES + 1) }), "static_too_large"],
    ["actual body too large", () => resp({ bytes: new Uint8Array(MAX_IMAGE_BYTES + 1) }), "static_too_large"],
    ["HTTP 403", () => resp({ ok: false, status: 403 }), "static_http_403"],
  ])("%s -> fixed reason, no key", async (_n, make, reason) => {
    mockFetch(make());
    const out = await fetchRouteMapImage("org", args);
    expect(out).toEqual({ status: "unavailable", reason });
    expect(JSON.stringify(out)).not.toContain(KEY);
  });
  it("a network error that echoes the URL (key included) never leaks", async () => {
    mockFetch(new Error(`request to https://maps.googleapis.com/maps/api/staticmap?key=${KEY} failed`));
    const out = await fetchRouteMapImage("org", args);
    expect(out.status).toBe("unavailable");
    expect(JSON.stringify(out)).not.toContain(KEY);
    expect(JSON.stringify(out)).not.toMatch(/key=/i);
  });
  it("is metered under its own static_map kind (never routing) and honours the language", async () => {
    kinds.length = 0;
    mockFetch(resp());
    await fetchRouteMapImage("org", { ...args, language: "zh-CN" });
    expect(kinds).toEqual(["static_map"]);
    expect(String((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![0])).toContain("language=zh-CN");
  });
  it("missing key -> unavailable without calling Google", async () => {
    delete process.env.GOOGLE_MAPS_API_KEY;
    const out = await fetchRouteMapImage("org", args);
    expect(out).toEqual({ status: "unavailable", reason: "missing_api_key" });
    expect(fetch).not.toHaveBeenCalled();
  });
});
