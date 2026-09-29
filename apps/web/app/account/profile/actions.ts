"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { getDictionary } from "@/lib/i18n/getLocale";

export interface UpdateProfileState {
  status: "idle" | "success" | "error";
  error?: string;
}

/** profiles has no self-update RLS policy (see updateDriverAuthorization's comment in
 * settings/users/actions.ts) — admin client, scoped to the caller's own id only. */
export async function updateOwnProfile(
  _prevState: UpdateProfileState,
  formData: FormData,
): Promise<UpdateProfileState> {
  const dict = await getDictionary();
  const supabase = await createSupabaseServerClient();
  const user = await getCurrentUser(supabase);
  if (!user) return { status: "error", error: dict.errors.common.not_authenticated };

  const fullName = String(formData.get("fullName") ?? "").trim();
  if (!fullName) {
    return { status: "error", error: dict.account.profile.nameRequired };
  }

  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("profiles").update({ full_name: fullName }).eq("id", user.id);
  if (error) {
    return { status: "error", error: dict.account.profile.saveFailed };
  }

  revalidatePath("/account/profile");
  revalidatePath("/dashboard");
  return { status: "success" };
}
