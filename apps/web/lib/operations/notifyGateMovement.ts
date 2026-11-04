import "server-only";
import type { TypedSupabaseClient } from "@fleet/supabase-client";
import { getFleetManagerEmails } from "@/lib/email/recipients";
import { renderEmail } from "@/lib/email/renderEmail";
import { sendEmail } from "@/lib/email/sendEmail";
import { getAppUrl } from "@/lib/getAppUrl";

const TZ = "America/Sao_Paulo";

const CASES = {
  departure: { subject: "Portaria: saída liberada", heading: "Saída liberada pela portaria", line: "saiu pelo portão" },
  arrival: { subject: "Portaria: chegada registrada", heading: "Chegada registrada pela portaria", line: "chegou ao portão" },
  denied: { subject: "Portaria: saída impedida", heading: "Saída impedida pela portaria", line: "teve a saída impedida pela portaria" },
} as const;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Tells the fleet managers (by e-mail) that the gate released a vehicle, received it back, or refused a departure. Best effort and silent: the movement is
 * already recorded (and the bell already told the managers, see migration 0252), so nothing here may fail the porter's confirmation.
 */
export async function notifyGateMovement(db: TypedSupabaseClient, reservationId: string, kind: string): Promise<void> {
  const c = CASES[kind as keyof typeof CASES];
  if (!c) return;
  try {
    const { data: r } = await db
      .from("reservations")
      .select("organization_id, vehicle:vehicles(plate, name), trip_request:trip_requests(destination, requester:profiles(full_name))")
      .eq("id", reservationId)
      .maybeSingle();
    if (!r) return;
    const emails = await getFleetManagerEmails(db, r.organization_id);
    if (emails.length === 0) return;
    const when = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, dateStyle: "short", timeStyle: "short" }).format(new Date());
    const vehicle = [r.vehicle?.name, r.vehicle?.plate ? `(${r.vehicle.plate})` : ""].filter(Boolean).join(" ") || "Veículo";
    const who = r.trip_request?.requester?.full_name ?? "—";
    const { html, text } = renderEmail({
      heading: c.heading,
      bodyLines: [
        `O veículo <strong>${esc(vehicle)}</strong> ${c.line} às <strong>${when}</strong> (Brasília).`,
        `Colaborador: ${esc(who)}${r.trip_request?.destination ? ` · Destino: ${esc(r.trip_request.destination)}` : ""}`,
      ],
      ctaLabel: "Abrir a reserva",
      ctaUrl: `${getAppUrl()}/reservations/${reservationId}`,
    });
    await sendEmail({ to: emails, subject: `${c.subject} — ${r.vehicle?.plate ?? ""}`.trim(), html, text });
  } catch {
    // best effort
  }
}
