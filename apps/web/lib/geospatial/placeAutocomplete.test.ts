import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./costGuard", () => ({
  withCostGuard: async (_org: string, _kind: string, doCall: () => Promise<unknown>, ok: (r: unknown) => boolean) => ({
    status: "ok",
    result: await doCall(),
    ok,
  }),
}));

import {
  autocompleteAddress,
  clampAutocompleteInput,
  cleanSessionToken,
  matchPointSuggestions,
  mergeSuggestions,
  parseAutocompleteBody,
  type PlaceSuggestion,
} from "./placeAutocomplete";
import type { CorporateMobilityPoint } from "./corporateMobilityPoints";

const KEY = "AIzaSyFAKEKEYFORAUTOCOMPLETE0123456789";
const point = (name: string, extra: Partial<CorporateMobilityPoint> = {}): CorporateMobilityPoint => ({
  id: `p-${name}`,
  organizationId: "o",
  name,
  aliases: [],
  addressLabel: "Rua X, 1 - Cidade",
  latitude: -23,
  longitude: -46,
  isActive: true,
  category: null,
  providerPlaceRef: null,
  ...extra,
});
const place = (text: string): PlaceSuggestion => ({ id: `g-${text}`, text, main: text, secondary: "", kind: "place" });

describe("input clamp", () => {
  it("requires 3 chars, trims, collapses whitespace and caps at 120", () => {
    expect(clampAutocompleteInput("ab")).toBeNull();
    expect(clampAutocompleteInput("  a  b ")).toBe("a b");
    expect(clampAutocompleteInput("  a  ")).toBeNull();
    expect(clampAutocompleteInput("  Av   Paulista ")).toBe("Av Paulista");
    expect(clampAutocompleteInput("x".repeat(500))).toHaveLength(120);
    expect(clampAutocompleteInput(undefined)).toBeNull();
    expect(clampAutocompleteInput({ a: 1 })).toBeNull();
  });
  it("accepts only UUID-shaped session tokens", () => {
    expect(cleanSessionToken("123e4567-e89b-12d3-a456-426614174000")).toBe("123e4567-e89b-12d3-a456-426614174000");
    expect(cleanSessionToken("<script>")).toBeUndefined();
    expect(cleanSessionToken(5)).toBeUndefined();
  });
});

describe("mobility points first", () => {
  it("matches name / alias / address, accent-insensitive, active only, max 3", () => {
    const pts = [
      point("Matriz Valinhos"),
      point("Filial São Paulo", { aliases: ["SP Centro"] }),
      point("Inativo Valinhos", { isActive: false }),
      point("Portaria", { addressLabel: "Av. Paulista, 1000" }),
      point("Garagem Valinhos 2"),
      point("Garagem Valinhos 3"),
    ];
    expect(matchPointSuggestions("valinhos", pts).map((s) => s.text)).toEqual(["Matriz Valinhos", "Garagem Valinhos 2", "Garagem Valinhos 3"]);
    expect(matchPointSuggestions("sao paulo", pts).map((s) => s.text)).toEqual(["Filial São Paulo"]);
    expect(matchPointSuggestions("sp cen", pts).map((s) => s.text)).toEqual(["Filial São Paulo"]);
    expect(matchPointSuggestions("paulista", pts).map((s) => s.text)).toEqual(["Portaria"]);
    expect(matchPointSuggestions("zz", pts)).toEqual([]);
  });
  it("merge puts points before Google results, dedupes and caps at 6", () => {
    const pts = matchPointSuggestions("matriz", [point("Matriz")]);
    const merged = mergeSuggestions(pts, [place("a1"), place("Matriz"), place("a2"), place("a3"), place("a4"), place("a5"), place("a6")]);
    expect(merged[0]).toMatchObject({ kind: "point", text: "Matriz" });
    expect(merged).toHaveLength(6);
    expect(merged.filter((s) => s.text === "Matriz")).toHaveLength(1);
  });
});

describe("provider body parsing", () => {
  it("maps predictions and tolerates garbage", () => {
    const out = parseAutocompleteBody(
      {
        suggestions: [
          { placePrediction: { placeId: "p1", text: { text: "Av. Paulista, 1578 - Bela Vista, São Paulo - SP, Brasil" }, structuredFormat: { mainText: { text: "Av. Paulista, 1578" }, secondaryText: { text: "Bela Vista" } } } },
          { placePrediction: { placeId: 5, text: { text: "bad" } } },
          { queryPrediction: { text: { text: "x" } } },
          null,
        ],
      },
      6,
    );
    expect(out).toEqual([{ id: "p1", text: "Av. Paulista, 1578 - Bela Vista, São Paulo - SP, Brasil", main: "Av. Paulista, 1578", secondary: "Bela Vista", kind: "place" }]);
    expect(parseAutocompleteBody({}, 6)).toEqual([]);
    expect(parseAutocompleteBody({ suggestions: "x" }, 6)).toBeNull();
    expect(parseAutocompleteBody(null, 6)).toBeNull();
  });
  it("caps the number of results", () => {
    const suggestions = Array.from({ length: 10 }, (_, i) => ({ placePrediction: { placeId: `p${i}`, text: { text: `t${i}` } } }));
    expect(parseAutocompleteBody({ suggestions }, 4)).toHaveLength(4);
  });
});

describe("autocompleteAddress", () => {
  const original = process.env.GOOGLE_MAPS_API_KEY;
  beforeEach(() => {
    process.env.GOOGLE_MAPS_API_KEY = KEY;
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    process.env.GOOGLE_MAPS_API_KEY = original;
    vi.unstubAllGlobals();
  });
  const bodyResponse = (obj: unknown, ok = true, status = 200) =>
    new Response(JSON.stringify(obj), { status: ok ? status : status });

  it("no key -> missing_api_key without a call", async () => {
    delete process.env.GOOGLE_MAPS_API_KEY;
    expect(await autocompleteAddress("o", "abc", "pt-BR", undefined)).toEqual({ status: "unavailable", reason: "missing_api_key" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("sends the key in the header only, region br, language and session token", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(bodyResponse({ suggestions: [{ placePrediction: { placeId: "p", text: { text: "t" } } }] }));
    const out = await autocompleteAddress("o", "Avenida Paulista 15", "en", "123e4567-e89b-12d3-a456-426614174000");
    expect(out.status).toBe("ok");
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(String(url)).toBe("https://places.googleapis.com/v1/places:autocomplete");
    expect(String(url)).not.toContain(KEY);
    expect((init.headers as Record<string, string>)["X-Goog-Api-Key"]).toBe(KEY);
    expect(JSON.parse(init.body as string)).toEqual({ input: "Avenida Paulista 15", languageCode: "en", regionCode: "br", sessionToken: "123e4567-e89b-12d3-a456-426614174000" });
  });
  it("HTTP errors / network errors / oversize -> fixed reasons that never contain the key or provider text", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(bodyResponse({ error: { message: `bad ${KEY}` } }, false, 403));
    const a = await autocompleteAddress("o", "abc", "pt-BR", undefined);
    expect(a).toEqual({ status: "unavailable", reason: "autocomplete_http_403" });
    (fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error(`fetch failed for https://x?key=${KEY}`));
    const b = await autocompleteAddress("o", "abc", "pt-BR", undefined);
    expect(b).toEqual({ status: "unavailable", reason: "places_network_error" });
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(new Response("x".repeat(70_000), { status: 200 }));
    const c = await autocompleteAddress("o", "abc", "pt-BR", undefined);
    expect(c).toEqual({ status: "unavailable", reason: "autocomplete_response_too_large" });
    for (const r of [a, b, c]) expect(JSON.stringify(r)).not.toContain(KEY);
  });
});
