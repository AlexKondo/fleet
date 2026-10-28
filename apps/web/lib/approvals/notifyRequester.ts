import { cleanUserText, formatWhen, signBody, SIGNATURE_HEADER, TIMESTAMP_HEADER } from "./whatsappApproval";

/**
 * Tells the requester, by WhatsApp (through n8n), what their direct manager decided. Best effort and silent: the decision is already
 * recorded and the in-app bell already told them, so nothing here may fail the caller. Only sent when the requester has a WhatsApp number
 * registered with consent (fm_requester_notice, migration 0233).
 */
export interface NoticeEnv {
  /** the approval webhook (N8N_APPROVAL_WEBHOOK_URL): the notice endpoint is its sibling "fleet-notify" unless N8N_NOTIFY_WEBHOOK_URL says otherwise */
  approvalUrl?: string;
  notifyUrl?: string;
  secret?: string;
}

export interface NoticeDeps {
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
  fetch?: typeof fetch;
  env?: NoticeEnv;
  now?: () => number;
}

export type NoticeResult = { status: "sent" } | { status: "skipped"; reason: string } | { status: "failed"; error: string };

interface Notice {
  ok?: boolean;
  reason?: string;
  phone_e164?: string;
  status?: string;
  plate?: string | null;
  vehicle_name?: string | null;
  origin?: string | null;
  destination?: string | null;
  departure_at?: string | null;
  return_at?: string | null;
}

const TIMEOUT_MS = 8000;

export function currentNoticeEnv(): NoticeEnv {
  return { approvalUrl: process.env.N8N_APPROVAL_WEBHOOK_URL, notifyUrl: process.env.N8N_NOTIFY_WEBHOOK_URL, secret: process.env.N8N_APPROVAL_SECRET };
}

export function noticeUrl(env: NoticeEnv): string | null {
  if (env.notifyUrl) return env.notifyUrl;
  if (!env.approvalUrl) return null;
  return env.approvalUrl.replace(/\/[^/]*\/?$/, "/fleet-notify");
}

/** The message the requester reads. */
export function buildRequesterMessage(decision: "approve" | "reject", n: Notice): string {
  const vehicleName = cleanUserText(n.vehicle_name, 60);
  const plate = cleanUserText(n.plate, 12);
  const vehicle = [vehicleName, plate && !vehicleName.toUpperCase().includes(plate.toUpperCase()) ? `(${plate})` : ""].filter(Boolean).join(" ");
  const lines: string[] = [];
  if (decision === "approve") {
    lines.push("✅ *Sua reserva foi aprovada!* O veículo está confirmado para você.");
    if (vehicle) lines.push(`Veículo: ${vehicle}`);
  } else {
    lines.push("❌ *Sua reserva foi recusada pelo seu gestor.*");
    if (vehicle) lines.push(`Veículo pedido: ${vehicle}`);
  }
  if (n.departure_at) lines.push(`Saída: ${formatWhen(n.departure_at)}`);
  if (n.return_at) lines.push(`Retorno: ${formatWhen(n.return_at)}`);
  if (n.destination) lines.push(`Destino: ${cleanUserText(n.destination)}`);
  if (decision === "reject") lines.push("Se precisar, faça um novo pedido ou fale com o seu gestor.");
  return lines.join("\n");
}

export async function notifyRequesterOutcome(reservationId: string, decision: "approve" | "reject", deps: NoticeDeps): Promise<NoticeResult> {
  const env = deps.env ?? currentNoticeEnv();
  const url = noticeUrl(env);
  if (!url || !env.secret) return { status: "skipped", reason: "not_configured" };
  try {
    const res = await deps.rpc("fm_requester_notice", { p_reservation_id: reservationId });
    if (res.error) return { status: "failed", error: "notice_error" };
    const n = res.data as Notice | null;
    if (!n || n.ok !== true || !n.phone_e164) return { status: "skipped", reason: n?.reason ?? "no_notice" };
    const body = JSON.stringify({ type: "requester_notice", reservation_id: reservationId, to: n.phone_e164, text: buildRequesterMessage(decision, n) });
    const timestamp = String(Math.floor((deps.now?.() ?? Date.now()) / 1000));
    const out = await (deps.fetch ?? fetch)(url, {
      method: "POST",
      headers: { "content-type": "application/json", [TIMESTAMP_HEADER]: timestamp, [SIGNATURE_HEADER]: signBody(body, env.secret, timestamp) },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return out.ok ? { status: "sent" } : { status: "failed", error: `http_${out.status}` };
  } catch (e) {
    return { status: "failed", error: e instanceof Error ? e.name : "network_error" };
  }
}
