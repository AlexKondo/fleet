import { cleanUserText, formatWhen, signBody, SIGNATURE_HEADER, TIMESTAMP_HEADER } from "@/lib/approvals/whatsappApproval";
import { currentNoticeEnv, noticeUrl, type NoticeDeps, type NoticeResult } from "@/lib/approvals/notifyRequester";

/**
 * Tells the owner of a reservation (the host), by WhatsApp through n8n, that somebody is taking a carpool with them, with the details of the trip.
 * While the request waits for the host the message carries two buttons, Aceitar / Recusar (the token inside the button ids is single-use and bound to
 * that request and to the host's number; Recusar then asks for a justification that goes to the rider). Best effort and silent: the request already
 * exists and shows in the app, so nothing here may fail the caller. Only sent when the host has a WhatsApp number registered with consent
 * (fm_carpool_notice, migrations 0234/0235). The rider's name is the only personal data in the message.
 */
interface CarpoolNotice {
  ok?: boolean;
  reason?: string;
  phone_e164?: string;
  status?: string;
  token?: string | null;
  rider_name?: string | null;
  seats?: number | null;
  pickup_label?: string | null;
  destination?: string | null;
  departure_at?: string | null;
  plate?: string | null;
  vehicle_name?: string | null;
}

/** Button ids of the host's answer: "cp:yes:<token>" / "cp:no:<token>". */
export const CARPOOL_YES = "cp:yes:";
export const CARPOOL_NO = "cp:no:";

export function buildHostMessage(n: CarpoolNotice): string {
  const rider = cleanUserText(n.rider_name, 80) || "Um colega";
  const seats = Number(n.seats ?? 1) > 1 ? ` (${Number(n.seats)} lugares)` : "";
  const accepted = n.status === "ACCEPTED";
  const lines = [accepted ? `🚗 *${rider} vai de carona com você!*${seats}` : `🚗 *${rider} quer ir de carona com você.*${seats}`];
  lines.push("", "*Sua reserva:*");
  if (n.departure_at) lines.push(`Saída: ${formatWhen(n.departure_at)}`);
  if (n.destination) lines.push(`Destino: ${cleanUserText(n.destination)}`);
  const vehicle = [cleanUserText(n.vehicle_name, 60), cleanUserText(n.plate, 12) ? `(${cleanUserText(n.plate, 12)})` : ""].filter(Boolean).join(" ");
  if (vehicle) lines.push(`Veículo: ${vehicle}`);
  if (n.pickup_label) lines.push("", `Embarque do passageiro: ${cleanUserText(n.pickup_label)}`);
  if (!accepted) lines.push("", "Você aceita levar?");
  return lines.join("\n");
}

export async function notifyHostOfCarpool(requestId: string, deps: NoticeDeps): Promise<NoticeResult> {
  const env = deps.env ?? currentNoticeEnv();
  const url = noticeUrl(env);
  if (!url || !env.secret) return { status: "skipped", reason: "not_configured" };
  try {
    const res = await deps.rpc("fm_carpool_notice", { p_request_id: requestId });
    if (res.error) return { status: "failed", error: "notice_error" };
    const n = res.data as CarpoolNotice | null;
    if (!n || n.ok !== true || !n.phone_e164) return { status: "skipped", reason: n?.reason ?? "no_notice" };
    const buttons = n.status === "PENDING" && n.token
      ? [{ id: `${CARPOOL_YES}${n.token}`, title: "Aceitar" }, { id: `${CARPOOL_NO}${n.token}`, title: "Recusar" }]
      : undefined;
    const body = JSON.stringify({ type: "carpool_notice", request_id: requestId, to: n.phone_e164, text: buildHostMessage(n), title: "Pedido de carona", ...(buttons ? { buttons } : {}) });
    const timestamp = String(Math.floor((deps.now?.() ?? Date.now()) / 1000));
    const out = await (deps.fetch ?? fetch)(url, {
      method: "POST",
      headers: { "content-type": "application/json", [TIMESTAMP_HEADER]: timestamp, [SIGNATURE_HEADER]: signBody(body, env.secret, timestamp) },
      body,
      signal: AbortSignal.timeout(8000),
    });
    return out.ok ? { status: "sent" } : { status: "failed", error: `http_${out.status}` };
  } catch (e) {
    return { status: "failed", error: e instanceof Error ? e.name : "network_error" };
  }
}
