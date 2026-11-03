import { describe, expect, it } from "vitest";
import { licenseState, summarizePastTrips } from "./driverContext";

describe("summarizePastTrips", () => {
  it("keeps the latest trip per destination (accents/case ignored) with Brazil-time hours", () => {
    const rows = [
      { destination: "EZ Tower, São Paulo", departure_at: "2026-10-30T11:00:00Z", expected_return_at: "2026-10-30T23:00:00Z" },
      { destination: "ez tower sao paulo", departure_at: "2026-10-29T10:00:00Z", expected_return_at: null },
      { destination: "Aracruz", departure_at: "2026-10-20T10:30:00Z", expected_return_at: "2026-10-20T20:00:00Z" },
    ];
    expect(summarizePastTrips(rows)).toEqual([
      { destination: "EZ Tower, São Paulo", date: "30/10", departureTime: "08:00", returnTime: "20:00" },
      { destination: "Aracruz", date: "20/10", departureTime: "07:30", returnTime: "17:00" },
    ]);
  });
  it("ignores rows without destination or departure and respects the limit", () => {
    const rows = [{ destination: null, departure_at: "2026-10-30T11:00:00Z", expected_return_at: null }, { destination: "A", departure_at: "2026-10-30T11:00:00Z", expected_return_at: null }, { destination: "B", departure_at: "2026-10-30T11:00:00Z", expected_return_at: null }];
    expect(summarizePastTrips(rows, 1).map((t) => t.destination)).toEqual(["A"]);
  });
});

describe("licenseState", () => {
  const now = new Date("2026-11-03T15:00:00Z");
  it("is missing without a date", () => {
    expect(licenseState(null, now)).toEqual({ kind: "missing" });
  });
  it("is expired after the date and expiring within 30 days", () => {
    expect(licenseState("2026-11-02", now)).toEqual({ kind: "expired", date: "02/11/2026" });
    expect(licenseState("2026-11-20", now)).toMatchObject({ kind: "expiring", date: "20/11/2026", days: 18 });
    expect(licenseState("2026-12-02", now)).toMatchObject({ kind: "expiring" });
  });
  it("is ok further away", () => {
    expect(licenseState("2026-12-10", now)).toEqual({ kind: "ok" });
  });
});
