import { describe, expect, it } from "vitest";
import { selectedLocation, upcomingServices } from "./upcomingServices";

const v = (plate: string, odometer_km: number, next_service_odometer_km: number | null) => ({ plate, odometer_km, next_service_odometer_km });

describe("upcomingServices", () => {
  it("the closest to the review first, with how much is left", () => {
    const list = upcomingServices([v("A", 8243, 12000), v("B", 11800, 12000), v("C", 11500, 12000)]);
    expect(list.map((r) => [r.plate, r.kmLeft])).toEqual([["B", 200], ["C", 500], ["A", 3757]]);
  });
  it("a vehicle past its review comes first and shows 0 km left", () => {
    const list = upcomingServices([v("A", 11800, 12000), v("B", 12300, 12000)]);
    expect(list[0]).toMatchObject({ plate: "B", kmLeft: 0, reached: true });
    expect(list[1]).toMatchObject({ plate: "A", reached: false });
  });
  it("vehicles with no review km are left out and the list stops at five", () => {
    const many = Array.from({ length: 8 }, (_, i) => v(`V${i}`, 1000, 2000 + i));
    expect(upcomingServices([...many, v("X", 10, null)])).toHaveLength(5);
    expect(upcomingServices([v("X", 10, null)])).toEqual([]);
  });
});

describe("selectedLocation", () => {
  const locations = [{ id: "l1" }, { id: "l2" }];
  it("keeps a location that exists", () => {
    expect(selectedLocation("l2", locations)).toBe("l2");
  });
  it("anything else means every location", () => {
    expect(selectedLocation(undefined, locations)).toBe("all");
    expect(selectedLocation("all", locations)).toBe("all");
    expect(selectedLocation("someone-elses", locations)).toBe("all");
  });
});
