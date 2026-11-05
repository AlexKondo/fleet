import { describe, expect, it } from "vitest";
import { returnOdometerReference } from "./odometerReference";

describe("returnOdometerReference", () => {
  it("the km typed at the departure, not the vehicle's old km", () => {
    expect(returnOdometerReference(1200, [1250])).toEqual({ km: 1250, fromPickup: true });
  });
  it("the porter's visual check has no km and is ignored", () => {
    expect(returnOdometerReference(1200, [null, 1250])).toEqual({ km: 1250, fromPickup: true });
  });
  it("never below what the vehicle already has", () => {
    expect(returnOdometerReference(1300, [1250])).toEqual({ km: 1300, fromPickup: true });
  });
  it("with no km at the departure, the last km of the vehicle, not called the departure's", () => {
    expect(returnOdometerReference(1200, [])).toEqual({ km: 1200, fromPickup: false });
    expect(returnOdometerReference(1200, [null])).toEqual({ km: 1200, fromPickup: false });
  });
});
