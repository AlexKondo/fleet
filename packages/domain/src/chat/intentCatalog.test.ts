import { describe, expect, it } from "vitest";
import {
  CARPOOL_INTENT_NAMES,
  INTENT_NAMES,
  isCarpoolIntent,
  isIntentKnown,
  missingRequiredSlots,
  requiredSlotsFor,
  requiresConfirmation,
} from "./intentCatalog";

describe("intentCatalog", () => {
  it("recognizes catalog intents and rejects anything else", () => {
    expect(isIntentKnown("CREATE_RESERVATION")).toBe(true);
    expect(isIntentKnown("DELETE_EVERYTHING")).toBe(false);
  });

  it("requires confirmation for mutating intents, not for read-only ones", () => {
    expect(requiresConfirmation("CREATE_RESERVATION")).toBe("yes");
    expect(requiresConfirmation("CANCEL_RESERVATION")).toBe("yes");
    expect(requiresConfirmation("VIEW_RESERVATION")).toBe("no");
    expect(requiresConfirmation("ASK_FLEET")).toBe("no");
  });

  it("reports only the slots still missing, not ones already filled", () => {
    expect(
      missingRequiredSlots("CREATE_RESERVATION", { departureAt: "2026-10-01T08:00:00Z" }),
    ).toEqual(["expectedReturnAt", "destination", "allowCarpool"]);

    expect(
      missingRequiredSlots("CREATE_RESERVATION", {
        departureAt: "2026-10-01T08:00:00Z",
        expectedReturnAt: "2026-10-01T17:00:00Z",
        destination: "São Paulo",
        allowCarpool: "true",
      }),
    ).toEqual([]);
  });

  it("has a definition for every catalog intent (no silent gaps)", () => {
    // requiresConfirmation/requiredSlotsFor index into a Record<IntentName, ...> — if an
    // intent were ever added to INTENT_NAMES without a matching entry, TypeScript itself
    // would already fail the build, but this pins the runtime behavior too rather than
    // relying purely on that compile-time guarantee.
    for (const intent of INTENT_NAMES) {
      expect(["yes", "potentially", "no"]).toContain(requiresConfirmation(intent));
      expect(Array.isArray(requiredSlotsFor(intent))).toBe(true);
    }
  });

  it("registers the 7 carpool intents with the right confirmation and anchor slots (Phase C6)", () => {
    expect([...CARPOOL_INTENT_NAMES].sort()).toEqual(
      [
        "ACCEPT_CARPOOL_REQUEST",
        "CANCEL_CARPOOL_REQUEST",
        "DISABLE_CARPOOL",
        "FIND_CARPOOL",
        "OFFER_CARPOOL",
        "REJECT_CARPOOL_REQUEST",
        "REQUEST_CARPOOL",
      ].sort(),
    );
    for (const intent of CARPOOL_INTENT_NAMES) {
      expect(isIntentKnown(intent)).toBe(true);
      expect(isCarpoolIntent(intent)).toBe(true);
      // Only the read-only search skips confirmation; every state-changing intent needs it.
      expect(requiresConfirmation(intent)).toBe(intent === "FIND_CARPOOL" ? "no" : "yes");
    }
    expect(isCarpoolIntent("CREATE_RESERVATION")).toBe(false);
    expect(requiredSlotsFor("OFFER_CARPOOL")).toEqual(["seats"]);
    expect(requiredSlotsFor("FIND_CARPOOL")).toEqual(["destination", "departureAt"]);
    expect(missingRequiredSlots("FIND_CARPOOL", { departureAt: "2026-10-02T08:00:00-03:00" })).toEqual(["destination"]);
    for (const intent of ["ACCEPT_CARPOOL_REQUEST", "REJECT_CARPOOL_REQUEST", "CANCEL_CARPOOL_REQUEST"] as const) {
      expect(requiredSlotsFor(intent)).toEqual(["requestId"]);
    }
  });

  it("every mutating (confirmation-required) intent actually needs at least one slot to act on", () => {
    // A "yes"/"potentially" intent with zero required slots would mean the LLM could
    // trigger it from something as vague as "sim" with nothing to confirm against —
    // every intent that changes state should be anchored to something concrete
    // (a reservation id, a destination, etc).
    for (const intent of INTENT_NAMES) {
      if (requiresConfirmation(intent) === "no") continue;
      expect(requiredSlotsFor(intent).length).toBeGreaterThan(0);
    }
  });
});
