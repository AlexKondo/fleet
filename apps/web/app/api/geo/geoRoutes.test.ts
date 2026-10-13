import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const core = {
  map: vi.fn(),
  suggest: vi.fn(),
};
vi.mock("@/app/carpool/routeMapActions", () => ({ getTripRouteMap: (...a: unknown[]) => core.map(...a) }));
vi.mock("@/app/carpool/placeAutocompleteActions", () => ({ suggestPlaces: (...a: unknown[]) => core.suggest(...a) }));

import { POST as mapPost } from "./route-map/route";
import { POST as acPost } from "./autocomplete/route";
import { NextRequest } from "next/server";

const HOST = "app.example.com";
function req(path: string, body: unknown, over: { headers?: Record<string, string | null>; raw?: string } = {}) {
  const headers: Record<string, string> = { host: HOST, origin: `https://${HOST}`, "sec-fetch-site": "same-origin", "content-type": "application/json" };
  for (const [k, v] of Object.entries(over.headers ?? {})) {
    if (v === null) delete headers[k];
    else headers[k] = v;
  }
  return new NextRequest(`https://${HOST}${path}`, { method: "POST", headers, body: over.raw ?? JSON.stringify(body) });
}
const MAP = "/api/geo/route-map";
const AC = "/api/geo/autocomplete";

beforeEach(() => {
  core.map.mockReset().mockResolvedValue({ status: "ok", imageDataUrl: "data:image/png;base64,AA", distanceKm: 1, durationMin: 2, originLabel: "a", destinationLabel: "b", approximate: false });
  core.suggest.mockReset().mockResolvedValue({ status: "ok", suggestions: [] });
});

describe.each([
  ["route-map", mapPost, MAP, { originText: "A", destinationText: "B" }, () => core.map],
  ["autocomplete", acPost, AC, { input: "Avenida", sessionToken: "123e4567-e89b-12d3-a456-426614174000" }, () => core.suggest],
] as const)("/api/geo/%s", (_name, POST, path, good, spy) => {
  it("same-origin JSON works: 200, no-store, no CORS headers", async () => {
    const res = await POST(req(path, good));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect([...res.headers.keys()].some((k) => k.startsWith("access-control-"))).toBe(false);
    expect(spy()).toHaveBeenCalledTimes(1);
  });
  it.each([
    ["foreign Origin", { origin: "https://evil.example" }],
    ["missing Origin", { origin: null }],
    ["Sec-Fetch-Site cross-site", { "sec-fetch-site": "cross-site" }],
    ["Sec-Fetch-Site same-site", { "sec-fetch-site": "same-site" }],
    ["missing Sec-Fetch-Site", { "sec-fetch-site": null }],
    ["Origin host that only starts with the host", { origin: `https://${HOST}.evil.example` }],
  ])("CSRF: %s -> 403 and the core never runs", async (_n, headers) => {
    const res = await POST(req(path, good, { headers }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
    expect(spy()).not.toHaveBeenCalled();
  });
  it("Sec-Fetch-Site none with a same-host Origin is allowed", async () => {
    expect((await POST(req(path, good, { headers: { "sec-fetch-site": "none" } }))).status).toBe(200);
  });
  it.each([
    ["not JSON", { raw: "{nope" }],
    ["array body", { raw: "[1]" }],
    ["wrong content-type", { headers: { "content-type": "text/plain" } }],
    ["unknown key", { raw: JSON.stringify({ ...good, extra: 1 }) }],
    ["oversized body", { raw: JSON.stringify({ ...good, input: "x".repeat(6000), originText: "x".repeat(6000) }) }],
  ])("validation: %s -> 400 invalid_input", async (_n, over) => {
    const res = await POST(req(path, good, over as never));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_input" });
    expect(spy()).not.toHaveBeenCalled();
  });
  it("wrong field types -> 400", async () => {
    const bad = Object.fromEntries(Object.keys(good).map((k) => [k, 5]));
    expect((await POST(req(path, bad))).status).toBe(400);
  });
  it("no session (core says not_authenticated) -> 401 JSON", async () => {
    const un = { status: "unavailable", reason: "not_authenticated" };
    core.map.mockResolvedValue(un);
    core.suggest.mockResolvedValue(un);
    const res = await POST(req(path, good));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "not_authenticated" });
  });
});

describe("response bodies", () => {
  it("other unavailable reasons stay 200 with the fixed code (the UI is silent)", async () => {
    core.suggest.mockResolvedValue({ status: "unavailable", reason: "rate_limited" });
    const res = await acPost(req(AC, { input: "abcd" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "unavailable", reason: "rate_limited" });
  });
  it("sessionToken is optional for autocomplete", async () => {
    expect((await acPost(req(AC, { input: "abcd" }))).status).toBe(200);
  });
});
