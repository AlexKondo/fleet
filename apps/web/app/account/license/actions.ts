"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { analyzeDriversLicense } from "@/lib/domain/analyzeDriversLicense";
import { getDictionary } from "@/lib/i18n/getLocale";

export interface LicenseUploadState {
  status: "idle" | "success" | "success_expired" | "unreadable" | "error";
  error?: string;
  /** Shown back to the user for both success and success_expired so a misread (e.g. the
   * model confusing "Validade" with "Emissão" or another printed date) is obvious on
   * screen immediately instead of a silent wrong block/approval. */
  read?: { fullName: string; number: string; category: string; expirationDate: string };
}

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

/**
 * First-access CNH capture: reads the photo with a vision LLM (analyzeDriversLicense.ts)
 * and, only when every field comes back readable AND the printed expiration date is still
 * in the future, auto-sets driver_authorized=true — matching the manual approval a fleet
 * manager would otherwise grant on /settings/users (updateDriverAuthorization). An
 * unreadable photo or an already-expired license leaves driver_authorized untouched
 * (false by default), so the driver falls back to asking their fleet manager/administrator
 * for manual approval — same UI, no separate "pending" state needed.
 */
export async function submitLicensePhoto(
  _prevState: LicenseUploadState,
  formData: FormData,
): Promise<LicenseUploadState> {
  const dict = await getDictionary();
  const supabase = await createSupabaseServerClient();
  const user = await getCurrentUser(supabase);
  if (!user) return { status: "error", error: dict.errors.common.not_authenticated };

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
  // OCR) get persisted, to profiles.
  const admin = createSupabaseAdminClient();
  const result = await analyzeDriversLicense(photo);

  if (result.status === "error") {
    console.error("submitLicensePhoto: analyzeDriversLicense failed:", result.message);
    return { status: "error", error: dict.account.license.analysisFailed };
  }
  if (result.status === "unreadable") {
    return { status: "unreadable" };
  }

  const expiration = new Date(`${result.data.expirationDate}T00:00:00Z`);
  const isStillValid = expiration.getTime() > Date.now();

  // profiles has no client-side UPDATE RLS policy (see updateDriverAuthorization's
  // comment in settings/users/actions.ts) — admin client, scoped to the caller's own id.
  const { error } = await admin
    .from("profiles")
    .update({
      drivers_license_number: result.data.number,
      drivers_license_category: result.data.category,
      drivers_license_expiration: result.data.expirationDate,
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
    read: {
      fullName: result.data.fullName,
      number: result.data.number,
      category: result.data.category,
      expirationDate: result.data.expirationDate,
    },
  };
}
