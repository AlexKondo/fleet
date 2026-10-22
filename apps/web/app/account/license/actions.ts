"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { canDrive } from "@/lib/auth/ownLicense";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { analyzeDriversLicense } from "@/lib/domain/analyzeDriversLicense";
import { getDictionary } from "@/lib/i18n/getLocale";
import { signLicenseToken, verifyLicenseToken } from "@/lib/auth/licenseToken";

export interface LicenseUploadState {
  status: "idle" | "analyzed" | "success" | "success_expired" | "unreadable" | "error";
  error?: string;
  /** Shown back to the user for both the "analyzed" review step and the final
   * success/success_expired result, so a misread (e.g. the model confusing "Validade"
   * with "Emissão" or another printed date) is obvious on screen before it's ever saved,
   * not just after. */
  read?: { fullName: string; number: string; category: string; expirationDate: string };
  /** Signed result of the analysis (analyzed step only). The confirm phase trusts ONLY this, never client-sent field values. */
  token?: string;
}

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

/** created_at of the member's latest administrator CNH reset ("" when none); null when the audit log cannot be read (callers fail closed). */
async function latestResetAt(userId: string): Promise<string | null> {
  const { data, error } = await createSupabaseAdminClient()
    .from("audit_log")
    .select("created_at")
    .eq("entity_id", userId)
    .eq("action", "driver_license_reset")
    .order("created_at", { ascending: false })
    .limit(1);
  if (error || !data) return null;
  return data[0]?.created_at ?? "";
}

/**
 * First-access CNH capture, split into two phases driven by FormData's "phase" field so a
 * single server action + useActionState pair can serve both steps:
 *
 * 1. "analyze" (default, no phase field sent): reads the photo with a vision LLM
 *    (analyzeDriversLicense.ts) and returns the extracted fields for the driver to review
 *    — nothing is written to the database yet. This used to persist immediately on a
 *    successful read, which meant the middleware CNH gate (lib/supabase/middleware.ts)
 *    unblocked navigation the instant the model returned an answer, before the driver had
 *    even looked at what it read or clicked anything resembling "submit" — exactly the gap
 *    the user caught (confirmed CNH access to the rest of the app with zero interaction
 *    past the initial photo pick).
 * 2. "confirm": takes the four fields back from the client (as hidden inputs — the read
 *    fields aren't re-derived from anything server-side at this point) and only now
 *    writes profiles, only after the driver has explicitly ticked "Conferi os dados e
 *    estão corretos." Only this phase sets drivers_license_number, which is what the
 *    middleware gate actually checks — so navigation truly stays blocked until this step.
 */
export async function submitLicensePhoto(
  _prevState: LicenseUploadState,
  formData: FormData,
): Promise<LicenseUploadState> {
  const dict = await getDictionary();
  const supabase = await createSupabaseServerClient();
  const user = await getCurrentUser(supabase);
  if (!user) return { status: "error", error: dict.errors.common.not_authenticated };

  if (formData.get("phase") === "confirm") {
    // Anti-fraud (migration 0075): every client-sent field value is IGNORED. The data comes only from the signed token that the
    // analyze phase issued for THIS user (HMAC, 15 min). A bad / expired / foreign token gets the generic save-failed error.
    const verified = verifyLicenseToken(formData.get("token"), user.id);
    if (!verified) {
      return { status: "error", error: dict.account.license.saveFailed };
    }
    const { fullName, number, category, expirationDate } = verified;

    // A token issued BEFORE an administrator reset of this member's CNH must not be replayed afterwards (anti-fraud): the token carries
    // the created_at of the latest reset at issue time; a different (newer) latest reset now means the token is stale. Two database
    // values are compared (no app/DB clock skew involved). Fail closed when the audit cannot be read.
    const latestNow = await latestResetAt(user.id);
    if (latestNow === null || latestNow !== verified.lastReset) {
      return { status: "error", error: dict.account.license.saveFailed };
    }

    const isStillValid = canDrive({ number, category, expiration: expirationDate, driverAuthorized: true });

    // profiles has no client-side UPDATE RLS policy (see updateDriverAuthorization's
    // comment in settings/users/actions.ts) — admin client, scoped to the caller's own id.
    const admin = createSupabaseAdminClient();
    // The CNH is the authoritative source for the driver's legal name (it overwrites full_name with what the document says).
    // The ONLY writer of AI-read CNH data: the service_role-only RPC apply_ai_license_read (sets source = 'ai' and works through the
    // 0075 lock trigger); a plain UPDATE of these columns is refused by the DB for rows already locked by AI.
    const { error } = await admin.rpc("apply_ai_license_read", {
      p_user_id: user.id,
      p_full_name: fullName,
      p_number: number,
      p_category: category,
      p_expiration: expirationDate,
      p_authorized: isStillValid,
    });
    if (error) {
      return { status: "error", error: dict.account.license.saveFailed };
    }

    revalidatePath("/account/license");
    revalidatePath("/account/profile");
    revalidatePath("/dashboard");
    return {
      status: isStillValid ? "success" : "success_expired",
      read: { fullName, number, category, expirationDate },
    };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("organization_id")
    .eq("id", user.id)
    .single();
  if (!profile) return { status: "error", error: dict.errors.common.not_authenticated };

  const photo = formData.get("photo");
  if (!(photo instanceof File) || photo.size === 0) {
    return { status: "error", error: dict.account.license.noPhoto };
  }
  // CNH Digital (the official app) exports as a PDF, not a photo — accepted alongside
  // images; analyzeDriversLicense.ts routes a PDF through OpenAI's Responses API instead
  // of Chat Completions' image-only image_url.
  if (!photo.type.startsWith("image/") && photo.type !== "application/pdf") {
    return { status: "error", error: dict.account.license.notAnImage };
  }
  if (photo.size > MAX_PHOTO_BYTES) {
    return { status: "error", error: dict.account.license.photoTooLarge };
  }

  // The CNH photo/PDF itself is never stored — it's LGPD-sensitive personal data (an ID
  // document image), and nothing downstream needs the raw file once the four fields
  // below are extracted. It's held in memory just long enough to reach the vision model
  // (analyzeDriversLicense.ts) and then discarded when this request ends; only the
  // extracted business fields (already-required for driver authorization regardless of
  // OCR) ever reach the client, and only the confirm phase above persists them.
  const result = await analyzeDriversLicense(photo);

  if (result.status === "error") {
    console.error("submitLicensePhoto: analyzeDriversLicense failed:", result.message);
    return { status: "error", error: dict.account.license.analysisFailed };
  }
  if (result.status === "unreadable") {
    return { status: "unreadable" };
  }

  const lastReset = await latestResetAt(user.id);
  if (lastReset === null) return { status: "error", error: dict.account.license.analysisFailed };
  const token = signLicenseToken({ uid: user.id, ...result.data, lastReset });
  if (!token) return { status: "error", error: dict.account.license.analysisFailed };
  return { status: "analyzed", read: result.data, token };
}
