/**
 * Request headers carrying the identity middleware already verified with
 * `supabase.auth.getUser()` for this request. Shared by lib/supabase/middleware.ts (which
 * is the only writer, and which strips any inbound copy first) and
 * lib/auth/currentUser.ts (the only reader).
 */
export const VERIFIED_USER_ID_HEADER = "x-fleet-user-id";
export const VERIFIED_USER_EMAIL_HEADER = "x-fleet-user-email";
