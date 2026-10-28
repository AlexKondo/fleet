"use server";

import { redirect } from "next/navigation";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isResultStatus } from "@/lib/approvals/emailResult";

const TOKEN = /^[0-9a-f]{32,128}$/;

/**
 * The manager's tap on Aprovar / Recusar on the e-mail confirmation page. A server action (POST), so link scanners and prefetchers that
 * only GET the e-mail link can never decide anything. The decision is authorized inside the database (single-use e-mail token, still
 * the requester's direct manager, not expired - migration 0229); this code only forwards it with the service role.
 */
export async function decideByEmail(token: string, decision: "approve" | "reject"): Promise<void> {
  let status = "generic_error";
  if (TOKEN.test(token) && (decision === "approve" || decision === "reject")) {
    try {
      const admin = createSupabaseAdminClient();
      const { data, error } = await admin.rpc("fm_approval_decide", { p_token: token, p_decision: decision, p_from_phone: "", p_message_id: null, p_channel: "email" });
      if (!error && data && typeof data === "object" && !Array.isArray(data) && typeof (data as { status?: unknown }).status === "string") {
        status = (data as { status: string }).status;
      } else if (error) {
        console.error("email approval: decide failed", error.message);
      }
    } catch (e) {
      console.error("email approval: unexpected failure", e instanceof Error ? e.message : e);
    }
  }
  const shown = isResultStatus(status) ? status : "generic_error";
  redirect(`/aprovar/${TOKEN.test(token) ? token : "x"}?r=${shown}`);
}
