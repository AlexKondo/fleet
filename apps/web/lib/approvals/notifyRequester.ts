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
export interface NoticeExtra {
  /** why it was refused (shown on a refusal) */
  reason?: string;
  /** who decided: the person is named in the message */
  by?: string | null;
}

export function buildRequesterMessage(decision: "approve" | "reject", n: Notice, extra: NoticeExtra = {}): string {
  const reason = extra.reason;
  const by = cleanUserText(extra.by, 80);
  const vehicleName = cleanUserText(n.vehicle_name, 60);
  const plate = cleanUserText(n.plate, 12);
  const vehicle = [vehicleName, plate && !vehicleName.toUpperCase().includes(plate.toUpperCase()) ? `(${plate})` : ""].filter(Boolean).join(" ");
  const lines: string[] = [];
  if (decision === "approve") {
    lines.push(by ? `✅ *Sua reserva foi aprovada por ${by}!* O veículo está confirmado para você.` : "✅ *Sua reserva foi aprovada!* O veículo está confirmado para você.");
    if (vehicle) lines.push(`Veículo: ${vehicle}`);
  } else {
    lines.push(by ? `❌ *Sua reserva foi recusada por ${by}.*` : "❌ *Sua reserva foi recusada pelo seu gestor.*");
    if (vehicle) lines.push(`Veículo pedido: ${vehicle}`);
  }
  if (n.departure_at) lines.push(`Saída: ${formatWhen(n.departure_at)}`);
  if (n.return_at) lines.push(`Retorno: ${formatWhen(n.return_at)}`);
  if (n.destination) lines.push(`Destino: ${cleanUserText(n.destination)}`);
  const why = cleanUserText(reason, 200);
  if (decision === "reject" && why) lines.push(`Motivo: ${why}`);
  if (decision === "reject") lines.push("Se precisar, faça um novo pedido ou fale com o seu gestor.");
  return lines.join("\n");
}

export async function notifyRequesterOutcome(reservationId: string, decision: "approve" | "reject", deps: NoticeDeps, extra: NoticeExtra = {}): Promise<NoticeResult> {
  const env = deps.env ?? currentNoticeEnv();
  const url = noticeUrl(env);
  if (!url || !env.secret) return { status: "skipped", reason: "not_configured" };
  try {
    const res = await deps.rpc("fm_requester_notice", { p_reservation_id: reservationId });
    if (res.error) return { status: "failed", error: "notice_error" };
    const n = res.data as Notice | null;
    if (!n || n.ok !== true || !n.phone_e164) return { status: "skipped", reason: n?.reason ?? "no_notice" };
    const body = JSON.stringify({ type: "requester_notice", reservation_id: reservationId, to: n.phone_e164, text: buildRequesterMessage(decision, n, extra) });
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

/** The name of the requester's direct manager (who decides on the e-mail / WhatsApp link), for the cases where the decision came through a token. */
export async function directManagerName(
  admin: { from: (t: string) => any }, // eslint-disable-line @typescript-eslint/no-explicit-any
  reservationId: string,
): Promise<string | null> {
  try {
    const { data: res } = await admin.from("reservations").select("trip_request:trip_requests(requester_id)").eq("id", reservationId).maybeSingle();
    const requesterId = res?.trip_request?.requester_id;
    if (!requesterId) return null;
    const { data: link } = await admin.from("fm_user_managers").select("manager:profiles!fm_user_managers_manager_id_fkey(full_name)").eq("user_id", requesterId).maybeSingle();
    const name = link?.manager?.full_name;
    return typeof name === "string" && name.trim() ? name.trim() : null;
  } catch {
    return null;
  }
}
