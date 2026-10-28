"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { approvalsErrorKey } from "@/lib/i18n/areas/approvals";

export interface ApprovalSaveState {
  status: "idle" | "success" | "error";
  /** key of approvalsTexts (translated on the client) */
  errorKey?: ReturnType<typeof approvalsErrorKey>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Saves the direct manager and the WhatsApp number of ONE person. Authorization lives in the database functions (administrator of the
 * caller's organization only, migration 0229); this action only validates the shape and forwards what the form sent.
 */
export async function saveApprovalChannel(_prev: ApprovalSaveState, formData: FormData): Promise<ApprovalSaveState> {
  const supabase = await createSupabaseServerClient();
  const user = await getCurrentUser(supabase);
  if (!user) return { status: "error", errorKey: "errNotAuthorized" };

  const userId = String(formData.get("userId") ?? "");
  const managerRaw = String(formData.get("managerId") ?? "");
  const phone = String(formData.get("phone") ?? "").trim().slice(0, 40);
  const consent = formData.get("consent") === "on";
  if (!UUID.test(userId) || (managerRaw !== "" && !UUID.test(managerRaw))) return { status: "error", errorKey: "errNotFound" };

  // only what changed is written (every write is audited): the form carries the values it was rendered with
  const hadManager = String(formData.get("hadManager") ?? "");
  const hadPhone = formData.get("hadPhone") === "1";
  if (managerRaw !== hadManager) {
    const manager = await supabase.rpc("fm_set_user_manager", { p_user_id: userId, p_manager_id: managerRaw === "" ? null : managerRaw });
    if (manager.error) return { status: "error", errorKey: approvalsErrorKey(manager.error.message) };
  }
  if (phone !== "" || hadPhone) {
    const contact = await supabase.rpc("fm_set_whatsapp_contact", { p_user_id: userId, p_phone: phone === "" ? null : phone, p_consent: consent });
    if (contact.error) return { status: "error", errorKey: approvalsErrorKey(contact.error.message) };
  }

  revalidatePath("/settings/approvals");
  return { status: "success" };
}
