import "server-only";
import { after } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email/sendEmail";
import { renderEmail } from "@/lib/email/renderEmail";
import { getAppUrl } from "@/lib/getAppUrl";
import { dispatchApprovalRequest } from "./dispatchApproval";

/**
 * Called right after a reservation is created in "pending approval": the direct manager's bell notification and the approval request
 * (WhatsApp and/or e-mail, whichever is configured) are prepared and sent AFTER the response (never delays or fails the user's booking).
 */
export function scheduleApprovalRequest(reservationId: string | null | undefined): void {
  if (!reservationId) return;
  try {
    after(async () => {
      try {
        const admin = createSupabaseAdminClient();
        await dispatchApprovalRequest(reservationId, {
          rpc: (name, args) => (admin.rpc as unknown as (n: string, a: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>)(name, args),
          sendEmail,
          renderEmail,
          appUrl: getAppUrl(),
        });
      } catch {
        // the booking stands; the manager can still approve in the app
      }
    });
  } catch {
    // `after` outside a request scope (tests / scripts): nothing to schedule
  }
}
