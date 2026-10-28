import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const read = (f: string) => readFileSync(path.resolve("app", f), "utf8");

describe("Reservar Veículo layout", () => {
  const form = read("trips/new/TripRequestForm.tsx");
  it("the vehicle's place is automatic: there is no field for it, and the search treats the origin as free text", () => {
    expect(form).not.toContain("rv-pickup-location");
    expect(form).not.toContain('name="originLocationId"');
    expect(form).toContain("originIsFreeText: true");
    expect(read("trips/new/actions.ts")).toContain("originIsFreeText: true");
  });
  it("date sits with date and time with time, then the reason takes its own row below them", () => {
    const at = (id: string) => form.indexOf(`id="${id}"`);
    expect(at("rv-dep-date")).toBeLessThan(at("rv-ret-date"));
    expect(at("rv-ret-date")).toBeLessThan(at("rv-dep-time"));
    expect(at("rv-dep-time")).toBeLessThan(at("rv-ret-time"));
    expect(at("rv-ret-time")).toBeLessThan(at("rv-motivo"));
    expect(form).toMatch(/className="fm-field rv-s14">\s*<label className="fm-label" htmlFor="rv-motivo"/);
  });
  it("the vehicle card and the reservation say where the vehicle is", () => {
    expect(read("trips/new/VehicleOptions.tsx")).toContain('data-testid="vehicle-place"');
    expect(read("reservations/[id]/page.tsx")).toContain('data-testid="vehicle-place"');
  });
});
