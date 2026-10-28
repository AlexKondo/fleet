import { buildApprovalMessage, signBody, SIGNATURE_HEADER, TIMESTAMP_HEADER, type ApprovalPayload } from "./whatsappApproval";

/**
 * Sends the approval request of a reservation to n8n (which delivers it on WhatsApp). Best effort and silent: the reservation is
 * already created and can always be approved in the app, so nothing here may fail the caller. Disabled (does nothing) until BOTH
 * N8N_APPROVAL_WEBHOOK_URL and N8N_APPROVAL_SECRET are set.
 */
export interface DispatchDeps {
  /** service-role RPC caller (functions are service_role only) */
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
  fetch?: typeof fetch;
  env?: { url?: string; secret?: string };
  now?: () => number;
}

export type DispatchResult =
  | { status: "disabled" }
  | { status: "skipped"; reason: string }
  | { status: "sent"; requestId: string }
  | { status: "failed"; requestId: string; error: string };

const TIMEOUT_MS = 8000;

export function approvalChannelConfigured(env: { url?: string; secret?: string } = { url: process.env.N8N_APPROVAL_WEBHOOK_URL, secret: process.env.N8N_APPROVAL_SECRET }): boolean {
  return Boolean(env.url && env.secret);
}

export async function dispatchApprovalRequest(reservationId: string, deps: DispatchDeps, opts: { rotate?: boolean } = {}): Promise<DispatchResult> {
  const env = deps.env ?? { url: process.env.N8N_APPROVAL_WEBHOOK_URL, secret: process.env.N8N_APPROVAL_SECRET };
  if (!env.url || !env.secret) return { status: "disabled" };
  const doFetch = deps.fetch ?? fetch;
  try {
    const prepared = await deps.rpc("fm_approval_prepare", { p_reservation_id: reservationId, p_rotate: opts.rotate === true });
    if (prepared.error) return { status: "skipped", reason: "prepare_error" };
    const r = prepared.data as { ok?: boolean; reason?: string; request_id?: string; token?: string; phone_e164?: string; expires_at?: string; payload?: ApprovalPayload } | null;
    if (!r || r.ok !== true || !r.request_id || !r.token || !r.phone_e164 || !r.payload || !r.expires_at) {
      return { status: "skipped", reason: r?.reason ?? "not_prepared" };
    }
    const message = buildApprovalMessage(r.payload, r.token, r.expires_at);
    const body = JSON.stringify({
      type: "approval_request",
      request_id: r.request_id,
      reservation_id: reservationId,
      to: r.phone_e164,
      expires_at: r.expires_at,
      message,
      data: r.payload,
    });
    const timestamp = String(Math.floor((deps.now?.() ?? Date.now()) / 1000));
    let error: string | null = null;
    try {
      const res = await doFetch(env.url, {
        method: "POST",
        headers: { "content-type": "application/json", [TIMESTAMP_HEADER]: timestamp, [SIGNATURE_HEADER]: signBody(body, env.secret, timestamp) },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) error = `http_${res.status}`;
    } catch (e) {
      error = e instanceof Error ? e.name : "network_error";
    }
    await deps.rpc("fm_approval_mark_delivery", { p_request_id: r.request_id, p_ok: error === null, p_error: error });
    return error === null ? { status: "sent", requestId: r.request_id } : { status: "failed", requestId: r.request_id, error };
  } catch {
    return { status: "skipped", reason: "unexpected_error" };
  }
}
