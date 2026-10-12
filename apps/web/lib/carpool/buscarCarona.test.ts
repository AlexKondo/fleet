import { describe, expect, it } from "vitest";
import { deriveBuscarGate, localInputToIso, parseBuscarInput } from "./buscarCarona";

const NOW = new Date("2026-10-11T12:00:00.000Z");
const base = {
  originText: "  Av. Paulista, 1578, São Paulo ",
  destinationText: "Aeroporto de Congonhas",
  departureAt: "2026-10-12T10:00:00.000Z",
  passengerCount: 2,
};

describe("parseBuscarInput", () => {
  it("accepts a valid payload, trims text and keeps the exact instant", () => {
    const r = parseBuscarInput(base, NOW);
    expect(r).toEqual({
      ok: true,
      input: {
        originText: "Av. Paulista, 1578, São Paulo",
        destinationText: "Aeroporto de Congonhas",
        departureAt: "2026-10-12T10:00:00.000Z",
        passengerCount: 2,
      },
    });
  });
  it("rejects non-objects, empty places, bad dates and bad seat counts", () => {
    expect(parseBuscarInput(null, NOW).ok).toBe(false);
    expect(parseBuscarInput("x", NOW).ok).toBe(false);
    expect(parseBuscarInput({ ...base, originText: "   " }, NOW).ok).toBe(false);
    expect(parseBuscarInput({ ...base, destinationText: undefined }, NOW).ok).toBe(false);
    expect(parseBuscarInput({ ...base, departureAt: "not a date" }, NOW).ok).toBe(false);
    expect(parseBuscarInput({ ...base, departureAt: 123 }, NOW).ok).toBe(false);
    for (const seats of [0, -1, 1.5, 9, "2", NaN, null]) {
      expect(parseBuscarInput({ ...base, passengerCount: seats }, NOW).ok).toBe(false);
    }
  });
  it("rejects a departure clearly in the past but tolerates a few minutes", () => {
    expect(parseBuscarInput({ ...base, departureAt: "2026-10-11T11:00:00.000Z" }, NOW).ok).toBe(false);
    expect(parseBuscarInput({ ...base, departureAt: "2026-10-11T11:57:00.000Z" }, NOW).ok).toBe(true);
  });
  it("clamps huge free text", () => {
    const r = parseBuscarInput({ ...base, originText: "a".repeat(5000) }, NOW);
    expect(r.ok && r.input.originText.length).toBe(300);
  });
});

describe("deriveBuscarGate", () => {
  it("is enabled only when the policy was read and carpool is on", () => {
    expect(deriveBuscarGate({ ok: true, policy: { carpoolEnabled: true } })).toBe("enabled");
    expect(deriveBuscarGate({ ok: true, policy: { carpoolEnabled: false } })).toBe("disabled");
  });
  it("fails closed (unknown) when the policy could not be read", () => {
    expect(deriveBuscarGate({ ok: false })).toBe("unknown");
  });
});

describe("localInputToIso", () => {
  it("keeps the typed wall-clock time exactly (round-trips through local fields)", () => {
    const iso = localInputToIso("2026-10-12T07:30");
    expect(iso).not.toBeNull();
    const d = new Date(iso!);
    expect([d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()]).toEqual([
      2026, 10, 12, 7, 30, 0,
    ]);
  });
  it("rejects empty, malformed and overflowing values", () => {
    expect(localInputToIso("")).toBeNull();
    expect(localInputToIso("2026-10-12")).toBeNull();
    expect(localInputToIso("2026-02-31T10:00")).toBeNull();
    expect(localInputToIso("2026-10-12T25:00")).toBeNull();
  });
});
