import { cleanUserText, formatWhen, signBody, SIGNATURE_HEADER, TIMESTAMP_HEADER } from "@/lib/approvals/whatsappApproval";
import { currentNoticeEnv, noticeUrl, type NoticeDeps, type NoticeResult } from "@/lib/approvals/notifyRequester";

/**
 * Tells the rider, by WhatsApp through n8n, what the host answered to the carpool request: accepted (with the trip details) or refused (with the
 * host's justification). Sent from every place the host can answer (WhatsApp buttons and the app). Best effort and silent, only when the rider has a
 * WhatsApp number registered with consent (fm_carpool_decision_notice, migration 0235). Nothing is sent while the request is still pending.
 */
interface DecisionNotice {
  ok?: boolean;
  reason?: string;
  phone_e164?: string;
  status?: string;
  host_name?: string | null;
  destination?: string | null;
  departure_at?: string | null;
  plate?: string | null;
  vehicle_name?: string | null;
}

export function buildRiderMessage(n: DecisionNotice, justification?: string | null): string | null {
  const host = cleanUserText(n.host_name, 80) || "O dono da reserva";
  const lines: string[] = [];
  const vehicle = [cleanUserText(n.vehicle_name, 60), cleanUserText(n.plate, 12) ? `(${cleanUserText(n.plate, 12)})` : ""].filter(Boolean).join(" ");
  if (n.status === "ACCEPTED") {
    lines.push(`✅ *${host} aceitou levar você de carona!*`);
    if (n.departure_at) lines.push(`Saída: ${formatWhen(n.departure_at)}`);
    if (n.destination) lines.push(`Destino: ${cleanUserText(n.destination)}`);
    if (vehicle) lines.push(`Veículo: ${vehicle}`);
    return lines.join("\n");
  }
  if (n.status === "REJECTED") {
    lines.push(`❌ *${host} não poderá levar você de carona.*`);
    const why = cleanUserText(justification, 300);
    if (why) lines.push(`Motivo: ${why}`);
    lines.push("Você pode procurar outra carona ou reservar um veículo no FleetMind.");
    return lines.join("\n");
  }
  return null;
}

export async function notifyRiderOfDecision(requestId: string, justification: string | null | undefined, deps: NoticeDeps): Promise<NoticeResult> {
  const env = deps.env ?? currentNoticeEnv();
  const url = noticeUrl(env);
  if (!url || !env.secret) return { status: "skipped", reason: "not_configured" };
  try {
    const res = await deps.rpc("fm_carpool_decision_notice", { p_request_id: requestId });
    if (res.error) return { status: "failed", error: "notice_error" };
    const n = res.data as DecisionNotice | null;
    if (!n || n.ok !== true || !n.phone_e164) return { status: "skipped", reason: n?.reason ?? "no_notice" };
    const text = buildRiderMessage(n, justification);
    if (!text) return { status: "skipped", reason: "not_decided" };
    const body = JSON.stringify({ type: "carpool_decision", request_id: requestId, to: n.phone_e164, text });
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
