"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/currentUser";
export async function submitPrivacy(form: FormData) {
  const db = await createSupabaseServerClient();
  if (!(await getCurrentUser(db))) redirect("/login");
  const { error } = await db.rpc("fm_privacy_submit", {
    p_kind: String(form.get("kind")),
    p_summary: String(form.get("summary") ?? "").slice(0, 3000),
    p_request_id: String(form.get("request_id")),
  });
  if (!error) revalidatePath("/account/privacy");
  redirect(`/account/privacy?${error ? "error=1" : "success=1"}`);
}
