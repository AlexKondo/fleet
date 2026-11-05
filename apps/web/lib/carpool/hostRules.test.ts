import { defaultCarpoolPolicyConfig } from "@fleet/domain";
import { describe, expect, it } from "vitest";
import { detourOverLimit, hostSeesRider } from "./hostRules";
import type { PolicyLoad } from "./loadPolicy";

const load = (over: Partial<typeof defaultCarpoolPolicyConfig> = {}): PolicyLoad => ({ ok: true, policy: { ...defaultCarpoolPolicyConfig, ...over }, policyVersion: 1 });

describe("hostSeesRider", () => {
  it("by default the host sees who asked, as it always was", () => {
    expect(hostSeesRider(load(), "PENDING")).toBe(true);
  });
  it("with the option off, the name only appears once accepted", () => {
    const hidden = load({ hostSeesRiderBeforeAccept: false });
    expect(hostSeesRider(hidden, "PENDING")).toBe(false);
    expect(hostSeesRider(hidden, "REJECTED")).toBe(false);
    expect(hostSeesRider(hidden, "EXPIRED")).toBe(false);
    expect(hostSeesRider(hidden, "ACCEPTED")).toBe(true);
  });
  it("an unknown policy keeps the name hidden", () => {
    expect(hostSeesRider({ ok: false }, "PENDING")).toBe(false);
  });
});

describe("detourOverLimit", () => {
  it("within the limits there is nothing to warn about", () => {
    expect(detourOverLimit(load(), 5, 10)).toBeNull();
  });
  it("past either limit the host is told what the limits are", () => {
    expect(detourOverLimit(load(), 8, 10)).toEqual({ km: 5, min: 10 });
    expect(detourOverLimit(load(), 3, 15)).toEqual({ km: 5, min: 10 });
  });
  it("no detour recorded, or no policy, no warning", () => {
    expect(detourOverLimit(load(), null, null)).toBeNull();
    expect(detourOverLimit({ ok: false }, 50, 50)).toBeNull();
  });
});
