import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { LICENSE_TOKEN_TTL_MS, signLicenseToken, verifyLicenseToken } from "./licenseToken";

const read = { fullName: "FULANO DE TAL", number: "12345678900", category: "B", expirationDate: "2031-05-20", lastReset: "" };
const UID = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
const original = process.env.SUPABASE_SERVICE_ROLE_KEY;
const now = 1_800_000_000_000;

beforeEach(() => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key-for-tests-0123456789";
});
afterEach(() => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = original;
});

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");

describe("signed CNH analysis token", () => {
  it("valid path: the verified payload carries exactly the signed values", () => {
    const t = signLicenseToken({ uid: UID, ...read }, now)!;
    expect(verifyLicenseToken(t, UID, now + 1000)).toEqual({ uid: UID, ...read, iat: now });
  });
  it("replay within the TTL is accepted (same values), after the TTL it is refused", () => {
    const t = signLicenseToken({ uid: UID, ...read }, now)!;
    expect(verifyLicenseToken(t, UID, now + 5 * 60_000)).not.toBeNull();
    expect(verifyLicenseToken(t, UID, now + 5 * 60_000)).not.toBeNull();
    expect(verifyLicenseToken(t, UID, now + LICENSE_TOKEN_TTL_MS)).not.toBeNull();
    expect(verifyLicenseToken(t, UID, now + LICENSE_TOKEN_TTL_MS + 1)).toBeNull();
  });
  it("another user's token is refused", () => {
    const t = signLicenseToken({ uid: UID, ...read }, now)!;
    expect(verifyLicenseToken(t, OTHER, now)).toBeNull();
  });
  it("tampering with the payload (e.g. a later expiration) breaks the signature", () => {
    const t = signLicenseToken({ uid: UID, ...read }, now)!;
    const [body, sig] = t.split(".") as [string, string];
    const forged = { ...JSON.parse(Buffer.from(body, "base64url").toString()), expirationDate: "2099-01-01" };
    expect(verifyLicenseToken(`${b64(forged)}.${sig}`, UID, now)).toBeNull();
  });
  it("a wrong / truncated / empty signature is refused", () => {
    const t = signLicenseToken({ uid: UID, ...read }, now)!;
    const [body] = t.split(".") as [string];
    for (const bad of [`${body}.AAAA`, `${body}.`, body, `${body}.${"A".repeat(43)}`, ""]) {
      expect(verifyLicenseToken(bad, UID, now)).toBeNull();
    }
  });
  it("a token signed with another key (or by someone who does not know the key) is refused", () => {
    const t = signLicenseToken({ uid: UID, ...read }, now)!;
    process.env.SUPABASE_SERVICE_ROLE_KEY = "a-different-key";
    expect(verifyLicenseToken(t, UID, now)).toBeNull();
  });
  it("garbage input types / oversize are refused", () => {
    for (const v of [undefined, null, 5, {}, "x".repeat(5000), "a.b.c"]) {
      expect(verifyLicenseToken(v, UID, now)).toBeNull();
    }
  });
  it("a token from the future (beyond the clock skew) is refused", () => {
    const t = signLicenseToken({ uid: UID, ...read }, now + 10 * 60_000)!;
    expect(verifyLicenseToken(t, UID, now)).toBeNull();
  });
  it("no signing key configured -> nothing is signed or verified", () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(signLicenseToken({ uid: UID, ...read }, now)).toBeNull();
    expect(verifyLicenseToken("a.b", UID, now)).toBeNull();
  });
  it("incomplete / malformed signed payloads are refused even with a valid signature", () => {
    for (const bad of [{ ...read, number: "" }, { ...read, expirationDate: "20/05/2031" }, { ...read, category: " " }]) {
      const t = signLicenseToken({ uid: UID, ...bad }, now)!;
      expect(verifyLicenseToken(t, UID, now)).toBeNull();
    }
  });
});
