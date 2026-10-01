import { describe, expect, it } from "vitest";
import { buildDriverUpdate } from "./driverUpdate";

const form = (entries: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
};

describe("buildDriverUpdate (M3: never wipe a CNH with blank hidden inputs)", () => {
  it("authorization toggle writes ONLY driver_authorized (license columns untouched)", () => {
    const on = buildDriverUpdate(form({ intent: "authorization", authorizationSubmitted: "1", driverAuthorized: "on", userId: "u" }));
    expect(on).toEqual({ ok: true, update: { driver_authorized: true } });
    const off = buildDriverUpdate(form({ intent: "authorization", authorizationSubmitted: "1", userId: "u" }));
    expect(off).toEqual({ ok: true, update: { driver_authorized: false } });
  });

  it("a legacy form that posts blank license hidden inputs together with the toggle cannot write them", () => {
    const r = buildDriverUpdate(
      form({ intent: "authorization", authorizationSubmitted: "1", driverAuthorized: "on", licenseNumber: "", licenseCategory: "", licenseExpiration: "" }),
    );
    expect(r).toEqual({ ok: true, update: { driver_authorized: true } });
    if (r.ok) {
      expect(r.update).not.toHaveProperty("drivers_license_number");
      expect(r.update).not.toHaveProperty("drivers_license_expiration");
    }
  });

  it("license form writes only the three license columns (never driver_authorized)", () => {
    const r = buildDriverUpdate(form({ intent: "license", licenseNumber: " 123 ", licenseCategory: "B", licenseExpiration: "2031-01-01" }));
    expect(r).toEqual({
      ok: true,
      update: { drivers_license_number: "123", drivers_license_category: "B", drivers_license_expiration: "2031-01-01" },
    });
  });

  it("an administrator may clear a CNH deliberately (all three fields present but empty)", () => {
    const r = buildDriverUpdate(form({ intent: "license", licenseNumber: "", licenseCategory: "", licenseExpiration: "" }));
    expect(r.ok).toBe(true);
  });

  it("refuses a license submission that does not carry the fields at all", () => {
    expect(buildDriverUpdate(form({ intent: "license", licenseNumber: "1" }))).toEqual({ ok: false, reason: "license_fields_missing" });
    expect(buildDriverUpdate(form({ intent: "license" }))).toEqual({ ok: false, reason: "license_fields_missing" });
  });

  it("refuses a missing / unknown intent and an authorization form without its marker", () => {
    expect(buildDriverUpdate(form({ userId: "u", driverAuthorized: "on" }))).toEqual({ ok: false, reason: "invalid_intent" });
    expect(buildDriverUpdate(form({ intent: "x" }))).toEqual({ ok: false, reason: "invalid_intent" });
    expect(buildDriverUpdate(form({ intent: "authorization" }))).toEqual({ ok: false, reason: "invalid_intent" });
  });
});
