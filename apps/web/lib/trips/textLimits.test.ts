import { describe, expect, it } from "vitest";
import { clampText, MAX_JUSTIFICATION_TEXT, MAX_LOCATION_TEXT } from "./textLimits";

describe("C7b trip text caps", () => {
  it("clamps huge / hostile text and coerces non-strings", () => {
    expect(clampText("A".repeat(10_000), MAX_LOCATION_TEXT)).toHaveLength(MAX_LOCATION_TEXT);
    expect(clampText("x".repeat(900), MAX_JUSTIFICATION_TEXT)).toHaveLength(MAX_JUSTIFICATION_TEXT);
    expect(clampText(null, 10)).toBe("");
    expect(clampText(undefined, 10)).toBe("");
    expect(clampText(12345, 3)).toBe("123");
    expect(clampText("<img src=x onerror=alert(1)>", 100)).toBe("<img src=x onerror=alert(1)>"); // kept as DATA; escaped at render
  });
});
