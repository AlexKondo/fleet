import { describe, expect, it } from "vitest";
import { buildTripPrefillHref, parseTripPrefill } from "./tripPrefill";
import { dictionaries } from "../i18n/dictionaries";
import { noVehicleReply, translateVehicleReasons } from "../../app/chat/noVehicle";

/** FIX-VENCIDAS / Assistente: chat -> /trips/new hand-off and reason-code translation. */
describe("trip prefill hand-off", () => {
  const slots = {
    departureAt: "2026-10-21T15:00:00-03:00",
    expectedReturnAt: "2026-10-21T22:00:00-03:00",
    origin: "Fábrica GWM",
    destination: "EZ Tower, São Paulo",
    distanceKm: "158.6",
    passengerCount: "2",
    requiresCargo: "false",
    allowCarpool: "true",
    offerSeats: "3",
    preferredVehicleId: "never-forwarded",
  };

  it("round-trips the trip data and the carpool intention (Brasília local times), nothing else", () => {
    const href = buildTripPrefillHref(slots);
    expect(href.startsWith("/trips/new?")).toBe(true);
    const params = Object.fromEntries(new URL(href, "http://x").searchParams);
    expect(params.preferredVehicleId).toBeUndefined();
    expect(parseTripPrefill(params)).toEqual({
      origin: "Fábrica GWM",
      destination: "EZ Tower, São Paulo",
      departureAt: "2026-10-21T15:00",
      expectedReturnAt: "2026-10-21T22:00",
      passengerCount: "2",
      distanceKm: "159",
      allowCarpool: "on",
      offerSeats: "3",
    });
  });

  it("drops malformed or out-of-range values instead of trusting the query string", () => {
    expect(
      parseTripPrefill({
        departureAt: "amanhã",
        expectedReturnAt: ["2026-10-21T22:00"],
        passengerCount: "0",
        distanceKm: "-5",
        allowCarpool: "yes",
        offerSeats: "3",
        requiresCargo: "true",
        origin: "x".repeat(400),
      }),
    ).toEqual({ origin: "x".repeat(300) });
    expect(parseTripPrefill({ allowCarpool: "off", offerSeats: "2" })).toEqual({ allowCarpool: "off" });
    expect(buildTripPrefillHref({})).toBe("/trips/new");
  });
});

describe("no-vehicle reply", () => {
  it("translates engine codes in every locale and never shows an untranslated code", () => {
    for (const dict of Object.values(dictionaries)) {
      const texts = translateVehicleReasons(dict, ["no_candidates_available", "some_new_engine_code", "Texto já legível."]);
      expect(texts[0]).toBe(dict.trips.reasons.no_candidates_available);
      expect(texts).not.toContain("some_new_engine_code");
      expect(texts).toContain("Texto já legível.");
      const reply = noVehicleReply(dict, { allowCarpool: "true", origin: "A" }, ["no_candidates_available"]);
      expect(reply.content).not.toMatch(/no_candidates_available/);
      expect(reply.content).toContain(dict.chat.replies.alternatives.reservation);
      expect(reply.content).toContain(dict.chat.replies.keptInForm);
      expect(reply.content).toContain(dict.chat.noVehicle.carpoolKept);
      expect(reply.link.label).toBe(dict.chat.noVehicle.openForm);
    }
  });

  it("falls back to the generic intro when the engine gave no usable reason", () => {
    const dict = dictionaries["pt-BR"];
    const reply = noVehicleReply(dict, { allowCarpool: "false" }, ["unknown_code"]);
    expect(reply.content).toContain(dict.chat.replies.fleet.intro);
    expect(reply.content).not.toContain(dict.chat.noVehicle.carpoolKept);
  });
});
