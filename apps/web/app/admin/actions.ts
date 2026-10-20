"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { loadOperationalWorkspace } from "@/lib/operations/load";
export async function adminCommand(form: FormData) {
  const data = await loadOperationalWorkspace(["administrator"]);
  const command = String(form.get("command"));
  const target = command === "ai.policy" ? "/admin/ai" : "/admin/audit";
  let error = false;
  const payload =
    command === "ai.policy"
      ? {
          enabled: form.get("enabled") === "on",
          version: Number(form.get("version")),
          reason: String(form.get("reason") ?? "").slice(0, 1000),
        }
      : {
          id: String(form.get("id")),
          version: Number(form.get("version")),
          status: String(form.get("status")),
          response: String(form.get("response") ?? "").slice(0, 5000),
        };
  try {
    if (!["ai.policy", "privacy.respond"].includes(command)) throw new Error();
    const result = await data.db.rpc("fm_admin_command", {
      p_command: command,
      p_payload: payload,
      p_request_id: String(form.get("request_id")),
    });
    error = Boolean(result.error);
  } catch {
    error = true;
  }
  if (!error) revalidatePath("/admin", "layout");
  redirect(`${target}?${error ? "error=INVALID_INPUT" : "success=1"}`);
}
