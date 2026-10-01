import { describe, expect, it } from "vitest";
import { parseCarpoolPolicyForm } from "./policyInput";
import { carpoolErrorText, carpoolReasonText, fillTemplate } from "./errorText";
import { dictionaries } from "@/lib/i18n/dictionaries";

function form(over: Record<string, string | undefined> = {}) {
  const base: Record<string, string> = {
    carpoolEnabled: "on",
    carpoolFirstEnabled: "on",
    hostOptInRequired: "on",
    hostApprovalRequired: "on",
    allowIntermediatePickup: "on",
    allowIntermediateDropoff: "on",
    departureWindowMinutes: "20",
    returnWindowMinutes: "15",
    maxAdditionalDistanceKm: "7.5",
    maxAdditionalTimeMinutes: "12",
    maxCandidatesForPreciseRouting: "4",
    requestExpiryMinutes: "45",
    minimumSeatAvailability: "1",
  };
  const f = new FormData();
  for (const [k, v] of Object.entries({ ...base, ...over })) if (v !== undefined) f.set(k, v);
  return f;
}

describe("parseCarpoolPolicyForm (server-side validation, pack rule 11)", () => {
  it("accepts a sane configuration and maps every field", () => {
    const r = parseCarpoolPolicyForm(form());
    expect(r).toEqual({
      ok: true,
      values: {
        carpoolEnabled: true, carpoolFirstEnabled: true, hostOptInRequired: true, hostApprovalRequired: true,
        departureWindowMinutes: 20, returnWindowMinutes: 15, maxAdditionalDistanceKm: 7.5, maxAdditionalTimeMinutes: 12,
        maxCandidatesForPreciseRouting: 4, requestExpiryMinutes: 45, allowIntermediatePickup: true,
        allowIntermediateDropoff: true, minimumSeatAvailability: 1,
      },
    });
  });

  it("unchecked checkboxes are false", () => {
    const r = parseCarpoolPolicyForm(form({ carpoolEnabled: undefined, hostApprovalRequired: undefined }));
    expect(r.ok && r.values.carpoolEnabled).toBe(false);
    expect(r.ok && r.values.hostApprovalRequired).toBe(false);
  });

  it.each([
    ["departureWindowMinutes", "0"],
    ["departureWindowMinutes", "-5"],
    ["departureWindowMinutes", "999"],
    ["departureWindowMinutes", "7.5"],
    ["maxAdditionalDistanceKm", "0"],
    ["maxAdditionalDistanceKm", "-1"],
    ["maxAdditionalDistanceKm", "1000"],
    ["maxAdditionalDistanceKm", "NaN"],
    ["maxAdditionalDistanceKm", "Infinity"],
    ["maxAdditionalTimeMinutes", "abc"],
    ["maxAdditionalTimeMinutes", ""],
    ["maxCandidatesForPreciseRouting", "0"],
    ["maxCandidatesForPreciseRouting", "500"],
    ["requestExpiryMinutes", "0"],
    ["minimumSeatAvailability", "0"],
    ["minimumSeatAvailability", "99"],
  ])("refuses %s = %j", (field, value) => {
    const r = parseCarpoolPolicyForm(form({ [field]: value }));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.invalidFields).toContain(field);
  });

  it("a missing numeric field is refused", () => {
    expect(parseCarpoolPolicyForm(form({ returnWindowMinutes: undefined })).ok).toBe(false);
  });
});

describe("carpool error/status text helpers + i18n completeness", () => {
  const pt = dictionaries["pt-BR"];
  it("maps stable codes to translated messages, unknown to generic", () => {
    expect(carpoolErrorText(pt, "CARPOOL_NO_SEATS_AVAILABLE")).toBe(pt.carpool.errors.noSeats);
    expect(carpoolErrorText(pt, "carpool_unavailable")).toBe(pt.carpool.errors.unavailable);
    expect(carpoolErrorText(pt, "weird")).toBe(pt.carpool.errors.generic);
    expect(carpoolErrorText(pt, null)).toBe(pt.carpool.errors.generic);
  });
  it("INVALIDATED reasons are translated, a host's free-text rejection reason is shown as written", () => {
    expect(carpoolReasonText(pt, "HOST_TRIP_CANCELLED")).toBe(pt.carpool.reasons.HOST_TRIP_CANCELLED);
    expect(carpoolReasonText(pt, "sem espaço")).toBe("sem espaço");
    expect(carpoolReasonText(pt, null)).toBeNull();
  });
  it("fillTemplate substitutes and leaves unknown placeholders visible", () => {
    expect(fillTemplate("{a} e {b}", { a: 1 })).toBe("1 e {b}");
  });

  it("every locale defines the same carpool keys (no key missing in es / en-US / zh-CN)", () => {
    const keys = (o: unknown, p = ""): string[] =>
      Object.entries(o as Record<string, unknown>).flatMap(([k, v]) =>
        typeof v === "object" && v !== null ? keys(v, `${p}${k}.`) : [`${p}${k}`],
      );
    const ref = keys(pt.carpool).sort();
    for (const locale of ["en-US", "es", "zh-CN"] as const) {
      expect(keys(dictionaries[locale].carpool).sort()).toEqual(ref);
    }
  });

  it("the other locales are real translations, not copies of the pt-BR strings", () => {
    const flat = (o: unknown, p = ""): Record<string, string> =>
      Object.entries(o as Record<string, unknown>).reduce((acc, [k, v]) => {
        if (typeof v === "object" && v !== null) Object.assign(acc, flat(v, `${p}${k}.`));
        else acc[`${p}${k}`] = String(v);
        return acc;
      }, {} as Record<string, string>);
    const ptFlat = flat(pt.carpool);
    for (const locale of ["en-US", "es", "zh-CN"] as const) {
      const other = flat(dictionaries[locale].carpool);
      const same = Object.keys(ptFlat).filter((k) => other[k] === ptFlat[k]);
      // Spanish and Portuguese share genuine cognates (Destino, Cancelada, Expirada, Invalidada,
      // Publicando…), so es gets a higher allowance; en-US / zh-CN must be essentially all different.
      expect(same.length).toBeLessThanOrEqual(locale === "es" ? 14 : 2);
    }
  });
});
