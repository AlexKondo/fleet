import { describe, expect, it } from "vitest";
import { custodyChanges, selectableUnits } from "./unitChoices";
import type { Custodian, Unit } from "./keyCustody";

const unit = (id: string, over: Partial<Unit> = {}): Unit => ({ id, name: id, enabled: true, workflow: "gate_visual", version: 1, mobility_point_id: `p-${id}`, ...over });
const assigned = (unit_id: string, enabled: boolean, version = 1): Custodian => ({ unit_id, user_id: "ana", enabled, version });

describe("selectableUnits", () => {
  it("offers the units of active places", () => {
    expect(selectableUnits([unit("a"), unit("b")], new Set(["p-a"])).map((u) => u.id)).toEqual(["a"]);
  });
  it("leaves out a disabled unit, and keeps a unit with no place", () => {
    const units = [unit("a", { enabled: false }), unit("b", { mobility_point_id: null })];
    expect(selectableUnits(units, new Set(["p-a"])).map((u) => u.id)).toEqual(["b"]);
  });
});

describe("custodyChanges", () => {
  it("adds a unit, starting from version zero", () => {
    expect(custodyChanges([], "ana", ["a"], new Set(["a"]))).toEqual([{ unit_id: "a", enabled: true, version: 0 }]);
  });
  it("takes a unit away, with the version it has", () => {
    expect(custodyChanges([assigned("a", true, 3)], "ana", ["a"], new Set())).toEqual([{ unit_id: "a", enabled: false, version: 3 }]);
  });
  it("gives back a unit that had been taken away", () => {
    expect(custodyChanges([assigned("a", false, 2)], "ana", ["a"], new Set(["a"]))).toEqual([{ unit_id: "a", enabled: true, version: 2 }]);
  });
  it("nothing to change, no command", () => {
    expect(custodyChanges([assigned("a", true)], "ana", ["a", "b"], new Set(["a"]))).toEqual([]);
  });
  it("another person's custody and a unit that was not offered are not touched", () => {
    const other: Custodian = { unit_id: "a", user_id: "bia", enabled: true, version: 1 };
    expect(custodyChanges([other, assigned("hidden", true)], "ana", ["a"], new Set(["a"]))).toEqual([{ unit_id: "a", enabled: true, version: 0 }]);
  });
});
