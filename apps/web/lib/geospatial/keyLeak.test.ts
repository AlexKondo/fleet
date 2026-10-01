import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Cost Guard always lets the call through here (its own behavior is covered by costGuard.test.ts).
vi.mock("./costGuard", () => ({
  withCostGuard: async (_org: string, _kind: string, doCall: () => Promise<unknown>) => ({
    status: "ok",
    result: await doCall(),
  }),
}));

import { geocodeAddress, searchPlaces } from "./googlePlacesProvider";
import { createGoogleRoutingProvider } from "./googleRoutingProvider";
import { providerErrorReason, redactSecrets } from "./redact";

// Fake secret with the real key's shape ("AIza" + 35 chars); never a real credential.
const KEY = "AIzaSyFAKEKEYFORLEAKTESTS0123456789abcde";
const ORIGINAL = process.env.GOOGLE_MAPS_API_KEY;
const P1 = { lat: -23.55, lng: -46.63 };
const P2 = { lat: -23.56, lng: -46.64 };

const FAILURES: [string, () => unknown][] = [
  ["fetch rejects with an error that ECHOES the full request URL (key included)", () => Promise.reject(new Error(`request to https://maps.googleapis.com/maps/api/geocode/json?address=x&key=${KEY} failed, reason: socket hang up`))],
  ["timeout (TimeoutError carrying the URL)", () => Promise.reject(Object.assign(new Error(`The operation was aborted due to timeout https://maps.googleapis.com/...?key=${KEY}`), { name: "TimeoutError" }))],
  ["abort", () => Promise.reject(Object.assign(new Error("aborted " + KEY), { name: "AbortError" }))],
  ["HTTP 403 invalid key", () => Promise.resolve({ ok: false, status: 403, json: async () => ({ error_message: `The provided API key ${KEY} is invalid.`, status: "REQUEST_DENIED" }) })],
  ["HTTP 429 quota", () => Promise.resolve({ ok: false, status: 429, json: async () => ({ error: { message: `quota exceeded for key ${KEY}` } }) })],
  ["200 with REQUEST_DENIED body that echoes the key", () => Promise.resolve({ ok: true, json: async () => ({ status: "REQUEST_DENIED", error_message: `API key ${KEY} is invalid`, results: [] }) })],
  ["malformed JSON body", () => Promise.resolve({ ok: true, json: async () => { throw new SyntaxError(`Unexpected token in ${KEY}`); } })],
];

describe("C7b: the provider API key never appears in any failure outcome, log line or thrown error", () => {
  const logs: string[] = [];
  beforeEach(() => {
    process.env.GOOGLE_MAPS_API_KEY = KEY;
    logs.length = 0;
    for (const m of ["log", "error", "warn", "info", "debug"] as const) {
      vi.spyOn(console, m).mockImplementation((...a: unknown[]) => { logs.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ")); });
    }
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    process.env.GOOGLE_MAPS_API_KEY = ORIGINAL;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  for (const [name, make] of FAILURES) {
    it(`geocodeAddress: ${name}`, async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => make());
      const outcome = await geocodeAddress("org-1", "Av. Paulista 1000");
      expect(outcome.status).toBe("unavailable");
      expect(JSON.stringify(outcome)).not.toContain(KEY);
      expect(JSON.stringify(outcome)).not.toMatch(/key=/i);
      expect(logs.join("\n")).not.toContain(KEY);
    });
    it(`searchPlaces: ${name}`, async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => make());
      const outcome = await searchPlaces("org-1", "Aeroporto");
      expect(outcome.status).toBe("unavailable");
      expect(JSON.stringify(outcome)).not.toContain(KEY);
      expect(logs.join("\n")).not.toContain(KEY);
    });
    it(`routing (computeRoute + evaluateInsertion): ${name}`, async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => make());
      const provider = createGoogleRoutingProvider("org-1");
      const a = await provider.computeRoute(P1, P2);
      const b = await provider.evaluateInsertion({ hostOrigin: P1, hostDestination: P2, candidatePickup: P1, candidateDropoff: P2 });
      for (const o of [a, b]) {
        expect(o.status).toBe("unavailable");
        expect(JSON.stringify(o)).not.toContain(KEY);
      }
      expect(logs.join("\n")).not.toContain(KEY);
    });
  }

  it("the key is sent only to Google, as a query parameter of the Geocoding URL or the X-Goog-Api-Key header, and never as a body field", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => ({ places: [] }) });
    await searchPlaces("org-1", "x");
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, { headers: Record<string, string>; body: string }];
    expect(url).not.toContain(KEY);
    expect(init.headers["X-Goog-Api-Key"]).toBe(KEY);
    expect(init.body).not.toContain(KEY);
  });

  it("providerErrorReason returns fixed codes only", () => {
    expect(providerErrorReason("geocode", Object.assign(new Error("x"), { name: "TimeoutError" }))).toBe("geocode_timeout");
    expect(providerErrorReason("places", Object.assign(new Error("x"), { name: "AbortError" }))).toBe("places_timeout");
    expect(providerErrorReason("routes", new Error(`boom ${KEY}`))).toBe("routes_network_error");
    expect(providerErrorReason("routes", "string error")).toBe("routes_network_error");
  });

  it("redactSecrets strips key= parameters and the literal key from arbitrary text", () => {
    const text = `GET https://maps.googleapis.com/maps/api/geocode/json?address=a&key=${KEY}&language=pt failed; ${KEY} again`;
    const out = redactSecrets(text, [KEY]);
    expect(out).not.toContain(KEY);
    expect(out).toContain("key=[redacted]");
    expect(redactSecrets("nothing to hide", [KEY])).toBe("nothing to hide");
  });
});
