/**
 * Request headers carrying the identity middleware already verified with
 * `supabase.auth.getUser()` for this request. Shared by lib/supabase/middleware.ts (which
 * is the only writer, and which strips any inbound copy first) and
 * lib/auth/currentUser.ts (the only reader).
 */
export const VERIFIED_USER_ID_HEADER = "x-fleet-user-id";
export const VERIFIED_USER_EMAIL_HEADER = "x-fleet-user-email";
/**
 * L6: the result of the license read the middleware gate already performed for this request ("1" = no CNH on
 * file, "0" = has one; absent = unknown / not read). Set only by middleware (stripped from every inbound
 * request first) and used only by AppShell for UI decisions, so the page does not repeat the get_my_license()
 * RPC. The gate itself (redirect to /account/license) stays in middleware and never trusts this header.
 */
export const LICENSE_MISSING_HEADER = "x-fleet-license-missing";
