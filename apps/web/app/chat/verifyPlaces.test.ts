import { describe, expect, it } from "vitest";
import { dictionaries } from "@/lib/i18n/dictionaries";
import type { ResolveOutcome } from "@/lib/carpool/resolveLocationText";
import { verifyReservationPlaces } from "./verifyPlaces";

const place = (lat: number): ResolveOutcome => ({ status: "resolved", place: { label: "x", coordinates: { lat, lng: -46 }, source: "geocoding_provider" } });
const deps = (byText: Record<string, ResolveOutcome>, route: () => Promise<{ status: string; distanceKm?: number }> = async () => ({ status: "ok", distanceKm: 87.4 })) => ({
  resolve: async (t: string) => byText[t] ?? ({ status: "needs_precision", reason: "not_found" } as ResolveOutcome),
  route: route as never,
});
const slots = { origin: "fábrica da GWM", destination: "EZ Tower, Torre A" };

describe("places are verified before any vehicle is suggested", () => {
  it("both located: ok, with the route distance (rounded) for the autonomy", async () => {
    const r = await verifyReservationPlaces(slots, deps({ "fábrica da GWM": place(-23.1), "EZ Tower, Torre A": place(-23.6) }), dictionaries["pt-BR"]);
    expect(r).toEqual({ status: "ok", distanceKm: 87, destinationLabel: "x" });
  });
  it("a destination that is not found: asks politely, names it, and never says 'adivinhar'", async () => {
    const r = await verifyReservationPlaces(slots, deps({ "fábrica da GWM": place(-23.1) }), dictionaries["pt-BR"]);
    expect(r.status).toBe("ask");
    const msg = (r as { message: string }).message;
    expect(msg).toContain("Antes de escolher o veículo, preciso confirmar o endereço");
    expect(msg).toContain("Não consegui localizar “EZ Tower, Torre A” no mapa");
    expect(msg).toContain("local de destino");
    expect(msg).not.toMatch(/adivinh|guess/i);
    expect(msg).toContain("eu escolho o veículo ideal");
  });
  it("both unclear: both are asked in the same message", async () => {
    const r = await verifyReservationPlaces({ origin: "São Paulo", destination: "" }, { resolve: async (t) => (t ? ({ status: "needs_precision", reason: "city_level" } as ResolveOutcome) : ({ status: "needs_precision", reason: "empty" } as ResolveOutcome)), route: async () => ({ status: "ok", distanceKm: 1 }) }, dictionaries["pt-BR"]);
    const msg = (r as { message: string }).message;
    expect(msg).toContain("Entendi “São Paulo” como uma cidade");
    expect(msg).toContain("Pode me informar o local de destino?");
  });
  it("the text is right in every language, with no unfilled placeholder", async () => {
    for (const locale of ["pt-BR", "en-US", "es", "zh-CN"] as const) {
      const r = await verifyReservationPlaces(slots, deps({ "fábrica da GWM": place(-23.1) }), dictionaries[locale]);
      const msg = (r as { message: string }).message;
      expect(msg, locale).not.toMatch(/\{(text|field|details)\}/);
      expect(msg, locale).toContain("EZ Tower, Torre A");
    }
  });
  it("map service unavailable: cannot verify, the flow goes on (nobody is blocked by an outage)", async () => {
    const r = await verifyReservationPlaces(slots, { resolve: async () => ({ status: "unavailable", reason: "missing_api_key" }), route: async () => ({ status: "ok", distanceKm: 1 }) }, dictionaries["pt-BR"]);
    expect(r).toEqual({ status: "unverified" });
  });
  it("places located but the route fails: still ok, just without a distance", async () => {
    const r = await verifyReservationPlaces(slots, deps({ "fábrica da GWM": place(-23.1), "EZ Tower, Torre A": place(-23.6) }, async () => ({ status: "unavailable" })), dictionaries["pt-BR"]);
    expect(r).toEqual({ status: "ok", destinationLabel: "x" });
  });
});
