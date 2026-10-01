import { describe, expect, it } from "vitest";
import { licenseMissingFromHeader } from "./ownLicense";
import { LICENSE_MISSING_HEADER } from "./headers";

describe("L6: license result shared from middleware to AppShell", () => {
  it("parses only the two values middleware writes; anything else means 'read it yourself'", () => {
    expect(licenseMissingFromHeader("1")).toBe(true);
    expect(licenseMissingFromHeader("0")).toBe(false);
    for (const v of [null, undefined, "", "true", "false", "yes", "2", " 1"]) expect(licenseMissingFromHeader(v)).toBeNull();
  });
  it("uses a distinct header name from the identity headers", () => {
    expect(LICENSE_MISSING_HEADER).toBe("x-fleet-license-missing");
  });
});
