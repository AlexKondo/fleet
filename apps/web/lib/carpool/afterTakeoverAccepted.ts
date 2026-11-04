import "server-only";
import { after } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email/sendEmail";
import { renderEmail } from "@/lib/email/renderEmail";
import { getAppUrl } from "@/lib/getAppUrl";
import { scheduleApprovalRequest } from "@/lib/approvals/scheduleApproval";
import { formatWhen } from "@/lib/approvals/whatsappApproval";

type Rpc = (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;

/**
 * The rider accepted the vehicle (the reservation is "aguardando aprovação"): his direct manager gets the approval request (WhatsApp / e-mail, the existing
 * flow). A rider without a direct manager sends it to the FLEET managers instead: bell + WhatsApp (queued by the database) and the e-mail sent here. Best
 * effort, after the response; the reservation already stands and shows in "Aprovar reservas".
 */
export function afterTakeoverAccepted(reservationId: string): void {
  scheduleApprovalRequest(reservationId);
  try {
    after(async () => {
      try {
        const admin = createSupabaseAdminClient();
        const res = await (admin.rpc as unknown as Rpc)("fm_takeover_fleet_notice", { p_reservation_id: reservationId });
        const n = res.data as { ok?: boolean; emails?: string[]; requester_name?: string; destination?: string; start_at?: string } | null;
        if (!n || n.ok !== true || !n.emails?.length) return;
        const { html, text } = renderEmail({
          heading: "Reserva aguardando aprovação",
          bodyLines: [
            `<strong>${n.requester_name ?? "Um colaborador"}</strong> assumiu uma reserva para <strong>${n.destination ?? ""}</strong> depois que o motorista cancelou a viagem, e não tem gestor direto cadastrado.`,
            n.start_at ? `Saída: ${formatWhen(n.start_at)}` : "",
          ].filter(Boolean),
          ctaLabel: "Aprovar reservas",
          ctaUrl: `${getAppUrl()}/dashboard`,
        });
        await sendEmail({ to: n.emails, subject: "Reserva aguardando aprovação (carona assumida)", html, text });
      } catch {
        // best effort: the managers still see it in "Aprovar reservas"
      }
    });
  } catch {
    // `after` outside a request scope (tests / scripts)
  }
}
