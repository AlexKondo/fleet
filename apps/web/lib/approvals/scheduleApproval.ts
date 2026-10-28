import "server-only";
import { after } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { approvalChannelConfigured, dispatchApprovalRequest } from "./dispatchApproval";

/**
 * Called right after a reservation is created in "pending approval": the WhatsApp request is prepared and sent AFTER the response
 * (never delays or fails the user's booking). Does nothing while the n8n channel is not configured.
 */
export function scheduleApprovalRequest(reservationId: string | null | undefined): void {
  if (!reservationId || !approvalChannelConfigured()) return;
  try {
    after(async () => {
      try {
        const admin = createSupabaseAdminClient();
        await dispatchApprovalRequest(reservationId, {
          rpc: (name, args) => (admin.rpc as unknown as (n: string, a: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>)(name, args),
        });
      } catch {
        // the booking stands; the manager can still approve in the app
      }
    });
  } catch {
    // `after` outside a request scope (tests / scripts): nothing to schedule
  }
}
