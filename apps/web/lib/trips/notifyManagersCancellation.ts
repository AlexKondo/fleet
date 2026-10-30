import "server-only";
import type { TypedSupabaseClient } from "@fleet/supabase-client";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getFleetManagerEmails } from "@/lib/email/recipients";
import { renderEmail } from "@/lib/email/renderEmail";
import { sendEmail } from "@/lib/email/sendEmail";
import { getAppUrl } from "@/lib/getAppUrl";
import { formatDateTime } from "@/lib/formatDateTime";
import { DEFAULT_LOCALE } from "@/lib/i18n/locales";

export const MIN_CANCEL_REASON_CHARS = 3;
export const MAX_CANCEL_REASON_CHARS = 300;

/** The reason the person typed, trimmed and clamped; null when it is too short to be an explanation. */
export function cleanCancelReason(raw: unknown): string | null {
  const text = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim().slice(0, MAX_CANCEL_REASON_CHARS) : "";
  return text.length >= MIN_CANCEL_REASON_CHARS ? text : null;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Tells the fleet managers that a requester cancelled their own reservation, WITH the reason the requester gave (callers must
 * ask for it first: nothing is sent without one). Best effort and silent like the "nova reserva" notice: the cancellation is
 * already recorded, so nothing here may fail the caller. In-app bell (service role, scoped to the caller's organization, fixed
 * template: employees cannot insert notifications for coworkers, see 0067) + e-mail.
 */
export async function notifyManagersOfCancellation(
  supabase: TypedSupabaseClient,
  args: { organizationId: string; requesterId: string; reservationId: string; reason: string },
): Promise<void> {
  try {
    const { data: res } = await supabase
      .from("reservations")
      .select("start_at, end_at, vehicle:vehicles(plate, name), trip_request:trip_requests(origin, destination)")
      .eq("id", args.reservationId)
      .maybeSingle();
    const { data: requester } = await supabase.from("profiles").select("full_name").eq("id", args.requesterId).maybeSingle();

    const who = requester?.full_name?.trim() || "Um colaborador";
    const vehicle = res?.vehicle ? [res.vehicle.name, res.vehicle.plate].filter(Boolean).join(" · ") : "";
    const destination = res?.trip_request?.destination ?? "";
    const when = res?.start_at ? formatDateTime(res.start_at, DEFAULT_LOCALE) : "";
    const body = [
      `${who} cancelou a reserva${vehicle ? ` do veículo ${vehicle}` : ""}${destination ? ` para ${destination}` : ""}${when ? ` (saída ${when})` : ""}.`,
      `Motivo: ${args.reason}`,
    ].join(" ");

    const admin = createSupabaseAdminClient();
    const { data: managers } = await admin
      .from("profiles")
      .select("id")
      .eq("organization_id", args.organizationId)
      .in("role", ["fleet_manager", "administrator"]);
    if (managers && managers.length > 0) {
      await admin.from("notifications").insert(
        managers
          .filter((m) => m.id !== args.requesterId)
          .map((m) => ({
            organization_id: args.organizationId,
            user_id: m.id,
            title: "Reserva cancelada pelo solicitante",
            body,
            entity_type: "reservation",
            entity_id: args.reservationId,
          })),
      );
    }

    const emails = await getFleetManagerEmails(supabase, args.organizationId);
    if (emails.length > 0) {
      const { html, text } = renderEmail({
        heading: "Reserva cancelada pelo solicitante",
        bodyLines: [
          `<strong>${escapeHtml(who)}</strong> cancelou a reserva${vehicle ? ` do veículo <strong>${escapeHtml(vehicle)}</strong>` : ""}${destination ? ` para <strong>${escapeHtml(destination)}</strong>` : ""}${when ? ` (saída ${escapeHtml(when)})` : ""}.`,
          `Motivo: ${escapeHtml(args.reason)}`,
        ],
        ctaLabel: "Abrir Painel",
        ctaUrl: `${getAppUrl()}/dashboard`,
      });
      await sendEmail({ to: emails, subject: "Reserva cancelada pelo solicitante", html, text });
    }
  } catch (e) {
    console.error("notifyManagersOfCancellation failed:", e instanceof Error ? e.message : e);
  }
}
