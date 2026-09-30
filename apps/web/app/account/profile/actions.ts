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

const MAX_AVATAR_BYTES = 3 * 1024 * 1024;

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
  const update: { full_name: string; avatar_url?: string } = { full_name: fullName };

  const avatar = formData.get("avatar");
  if (avatar instanceof File && avatar.size > 0) {
    if (avatar.size > MAX_AVATAR_BYTES) {
      return { status: "error", error: dict.account.profile.avatarTooLarge };
    }
    if (!avatar.type.startsWith("image/")) {
      return { status: "error", error: dict.account.profile.avatarNotAnImage };
    }
    // Fixed filename per user (not per-upload) with upsert:true — a new photo simply
    // replaces the old one in Storage; there's no reason to keep every previous avatar
    // around, unlike inspection photos which are a permanent record of a vehicle's state.
    const ext = avatar.type === "image/png" ? "png" : avatar.type === "image/webp" ? "webp" : "jpg";
    const path = `${user.id}/avatar.${ext}`;
    const { error: uploadError } = await admin.storage
      .from("avatars")
      .upload(path, avatar, { upsert: true, contentType: avatar.type });
    if (uploadError) {
      return { status: "error", error: dict.account.profile.saveFailed };
    }
    const { data: publicUrl } = admin.storage.from("avatars").getPublicUrl(path);
    // Cache-bust: the path is stable per user, so an unchanged URL would keep showing the
    // old cached image in <img>/next/image after a re-upload.
    update.avatar_url = `${publicUrl.publicUrl}?v=${Date.now()}`;
  }

  const { error } = await admin.from("profiles").update(update).eq("id", user.id);
  if (error) {
    return { status: "error", error: dict.account.profile.saveFailed };
  }

  revalidatePath("/account/profile");
  revalidatePath("/dashboard");
  return { status: "success" };
}
