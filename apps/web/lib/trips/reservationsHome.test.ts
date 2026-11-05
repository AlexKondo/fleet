import { describe, expect, it } from "vitest";
import { reservationsHomeFor } from "./reservationsHome";

describe("reservationsHomeFor", () => {
  it("an employee goes to Início, where the reservation is listed", () => {
    expect(reservationsHomeFor("employee")).toBe("/dashboard");
  });
  it("the gate goes to Portaria", () => {
    expect(reservationsHomeFor("security")).toBe("/gate");
  });
  it("a manager's own reservations stay on Viagens", () => {
    expect(reservationsHomeFor("fleet_manager")).toBe("/trips");
    expect(reservationsHomeFor("administrator")).toBe("/trips");
    expect(reservationsHomeFor(undefined)).toBe("/trips");
  });
});
