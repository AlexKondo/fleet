import { describe, expect, it } from "vitest";
import { pastTripsPrompt } from "./chatOrchestrator";

describe("pastTripsPrompt", () => {
  it("is empty without trips", () => {
    expect(pastTripsPrompt(undefined)).toBe("");
    expect(pastTripsPrompt([])).toBe("");
  });
  it("lists the trips as data and carries the memory rule, one line per destination", () => {
    const p = pastTripsPrompt([
      { destination: 'EZ "Tower"\nSP', date: "30/10", departureTime: "08:00", returnTime: "20:00" },
      { destination: "Aracruz", date: "20/10", departureTime: "07:30", returnTime: null },
    ]);
    expect(p).toContain('- "EZ  Tower  SP" on 30/10: left at 08:00, returned at 20:00');
    expect(p).toContain('- "Aracruz" on 20/10: left at 07:30\n');
    expect(p).toContain("Memory rule");
    expect(p).toContain("Quer manter os mesmos horários?");
  });
});
