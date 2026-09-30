import { describe, expect, it } from "vitest";
import { isIntentKnown, missingRequiredSlots, requiresConfirmation } from "./intentCatalog";

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
    ).toEqual(["expectedReturnAt", "destination"]);

    expect(
      missingRequiredSlots("CREATE_RESERVATION", {
        departureAt: "2026-10-01T08:00:00Z",
        expectedReturnAt: "2026-10-01T17:00:00Z",
        destination: "São Paulo",
      }),
    ).toEqual([]);
  });
});
