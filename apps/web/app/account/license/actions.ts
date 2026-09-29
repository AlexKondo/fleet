"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { analyzeDriversLicense } from "@/lib/domain/analyzeDriversLicense";
import { getDictionary } from "@/lib/i18n/getLocale";

export interface LicenseUploadState {
  status: "idle" | "analyzed" | "success" | "success_expired" | "unreadable" | "error";
  error?: string;
  /** Shown back to the user for both the "analyzed" review step and the final
   * success/success_expired result, so a misread (e.g. the model confusing "Validade"
   * with "Emissão" or another printed date) is obvious on screen before it's ever saved,
   * not just after. */
  read?: { fullName: string; number: string; category: string; expirationDate: string };
}

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

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
    const fullName = String(formData.get("fullName") ?? "");
    const number = String(formData.get("number") ?? "");
    const category = String(formData.get("category") ?? "");
    const expirationDate = String(formData.get("expirationDate") ?? "");
    if (!fullName || !number || !category || !expirationDate) {
      return { status: "error", error: dict.account.license.saveFailed };
    }

    const isStillValid = new Date(`${expirationDate}T00:00:00Z`).getTime() > Date.now();

    // profiles has no client-side UPDATE RLS policy (see updateDriverAuthorization's
    // comment in settings/users/actions.ts) — admin client, scoped to the caller's own id.
    const admin = createSupabaseAdminClient();
    const { error } = await admin
      .from("profiles")
      .update({
        drivers_license_number: number,
        drivers_license_category: category,
        drivers_license_expiration: expirationDate,
        driver_authorized: isStillValid,
      })
      .eq("id", user.id);
    if (error) {
      return { status: "error", error: dict.account.license.saveFailed };
    }

    revalidatePath("/account/license");
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

  return { status: "analyzed", read: result.data };
}
