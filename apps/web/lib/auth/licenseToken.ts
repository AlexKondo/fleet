import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Signed result of the CNH vision analysis (anti-fraud, migration 0075). The "analyze" phase returns it next to the fields it
 * shows; the "confirm" phase takes number / category / expiration / name ONLY from a verified token and ignores every
 * client-sent value, so the hidden inputs of the review step can no longer be tampered with.
 *
 *   token = base64url(JSON{uid, fullName, number, category, expirationDate, iat, nonce}) + "." + base64url(HMAC-SHA256)
 *
 * The key is derived (HMAC with a fixed context label) from SUPABASE_SERVICE_ROLE_KEY: no new env var, never sent anywhere.
 * Bound to the authenticated user id; valid for 15 minutes (replaying it inside that window just re-applies the same values).
 */
export const LICENSE_TOKEN_TTL_MS = 15 * 60 * 1000;
const CONTEXT = "fleet:cnh-ai-result:v1";
const CLOCK_SKEW_MS = 60 * 1000;

export interface LicenseTokenPayload {
  uid: string;
  fullName: string;
  number: string;
  category: string;
  expirationDate: string;
  /**
   * created_at of the member's latest administrator CNH reset (audit_log driver_license_reset) AT ISSUE TIME, "" when there was none.
   * The confirm phase refuses the token when a NEWER reset exists (replay after a reset). It is a comparison of two database values,
   * so it does not depend on the app server clock matching the database clock.
   */
  lastReset: string;
  /** Issue time (ms since epoch); only present on a verified payload. */
  iat?: number;
}

function derivedKey(): Buffer | null {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) return null;
  return createHmac("sha256", secret).update(CONTEXT).digest();
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");

export function signLicenseToken(payload: Omit<LicenseTokenPayload, "iat">, now: number = Date.now()): string | null {
  const key = derivedKey();
  if (!key) return null;
  const body = b64(JSON.stringify({ ...payload, iat: now, nonce: randomBytes(12).toString("hex") }));
  const sig = createHmac("sha256", key).update(body).digest();
  return `${body}.${b64(sig)}`;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The payload when the token is genuine, bound to `uid` and fresh; null otherwise (callers must not say why). */
export function verifyLicenseToken(token: unknown, uid: string, now: number = Date.now()): LicenseTokenPayload | null {
  const key = derivedKey();
  if (!key || typeof token !== "string" || token.length > 4096) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts as [string, string];
  const expected = createHmac("sha256", key).update(body).digest();
  let given: Buffer;
  try {
    given = Buffer.from(sig, "base64url");
  } catch {
    return null;
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let p: Record<string, unknown>;
  try {
    p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (typeof p !== "object" || p === null) return null;
  const { uid: tokenUid, fullName, number, category, expirationDate, iat, lastReset } = p;
  if (typeof lastReset !== "string") return null;
  if (tokenUid !== uid) return null;
  if (typeof iat !== "number" || !Number.isFinite(iat) || now - iat > LICENSE_TOKEN_TTL_MS || iat - now > CLOCK_SKEW_MS) return null;
  if (typeof fullName !== "string" || typeof number !== "string" || typeof category !== "string" || typeof expirationDate !== "string") return null;
  if (!fullName.trim() || !number.trim() || !category.trim() || !ISO_DATE.test(expirationDate)) return null;
  if (!Number.isFinite(new Date(`${expirationDate}T00:00:00Z`).getTime())) return null;
  return { uid: tokenUid, fullName, number, category, expirationDate, lastReset, iat };
}
