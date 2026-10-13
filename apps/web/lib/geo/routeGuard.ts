import "server-only";
import { NextResponse } from "next/server";

/**
 * Shared guard of the /api/geo/* route handlers (route map + address autocomplete). They are plain POST JSON endpoints that
 * need the Supabase session cookie (middleware answers 401 JSON without one) and are CSRF-protected here: the request must be
 * same-origin (Origin host equals the request host AND Sec-Fetch-Site is same-origin/none). No CORS headers are ever sent
 * and every answer is `Cache-Control: no-store`. Bodies are capped and strictly shaped; failures are fixed codes.
 */

export const MAX_BODY_BYTES = 4096;
const NO_STORE = { "Cache-Control": "no-store" } as const;

export function jsonNoStore(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

/** Same-origin check. Returns null when the request may proceed, otherwise the 403 answer. */
export function rejectCrossOrigin(request: Request): NextResponse | null {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? new URL(request.url).host;
  const origin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  let originHost: string | null = null;
  try {
    originHost = origin ? new URL(origin).host : null;
  } catch {
    originHost = null;
  }
  const sameOrigin = originHost !== null && originHost === host;
  const siteOk = site === "same-origin" || site === "none";
  return sameOrigin && siteOk ? null : jsonNoStore({ error: "forbidden" }, 403);
}

/** Reads a JSON object body (<= 4 KB, application/json) whose keys are a subset of `allowed`; null when invalid. */
export async function readJsonObject(request: Request, allowed: readonly string[]): Promise<Record<string, unknown> | null> {
  const type = (request.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  if (type !== "application/json") return null;
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return null;
  let text: string;
  try {
    text = await request.text();
  } catch {
    return null;
  }
  if (text.length > MAX_BODY_BYTES) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;
  return Object.keys(obj).every((k) => allowed.includes(k)) ? obj : null;
}

export const isText = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max;
