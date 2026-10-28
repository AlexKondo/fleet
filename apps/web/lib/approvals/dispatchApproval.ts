import { buildApprovalMessage, signBody, SIGNATURE_HEADER, TIMESTAMP_HEADER, type ApprovalPayload } from "./whatsappApproval";
import { buildApprovalEmail } from "./approvalEmail";

/**
 * Sends the approval request of a reservation to the requester's direct manager: WhatsApp (through n8n) and/or e-mail. Best effort and
 * silent: the reservation is already created and can always be approved in the app, so nothing here may fail the caller.
 * Each channel is active on its own: WhatsApp needs N8N_APPROVAL_WEBHOOK_URL + N8N_APPROVAL_SECRET; e-mail needs EMAIL_FROM_ADDRESS
 * (the existing SMTP setup) and can be switched off with FM_APPROVAL_EMAIL=off.
 */
export interface ApprovalEnv {
  n8nUrl?: string;
  n8nSecret?: string;
  emailFrom?: string;
  emailSwitch?: string;
}

export interface DispatchDeps {
  /** service-role RPC caller (functions are service_role only) */
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
  fetch?: typeof fetch;
  env?: ApprovalEnv;
  /** sends one e-mail (never throws) */
  sendEmail?: (input: { to: string; subject: string; html: string; text: string }) => Promise<{ success: boolean; error?: string }>;
  renderEmail?: (p: { heading: string; bodyLines: string[]; ctaLabel?: string; ctaUrl?: string }) => { html: string; text: string };
  appUrl?: string;
  now?: () => number;
}

export type ChannelResult = { channel: "whatsapp" | "email"; status: "sent" | "failed"; requestId: string; error?: string };
export type DispatchResult =
  | { status: "disabled" }
  | { status: "skipped"; reason: string }
  | { status: "done"; results: ChannelResult[] };

const TIMEOUT_MS = 8000;

export function currentApprovalEnv(): ApprovalEnv {
  return {
    n8nUrl: process.env.N8N_APPROVAL_WEBHOOK_URL,
    n8nSecret: process.env.N8N_APPROVAL_SECRET,
    emailFrom: process.env.EMAIL_FROM_ADDRESS,
    emailSwitch: process.env.FM_APPROVAL_EMAIL,
  };
}

export const whatsappConfigured = (env: ApprovalEnv = currentApprovalEnv()): boolean => Boolean(env.n8nUrl && env.n8nSecret);
export const emailConfigured = (env: ApprovalEnv = currentApprovalEnv()): boolean => Boolean(env.emailFrom) && env.emailSwitch !== "off";
/** true when at least one channel can deliver (the admin screen shows it) */
export const approvalChannelConfigured = (env: ApprovalEnv = currentApprovalEnv()): boolean => whatsappConfigured(env) || emailConfigured(env);

interface PreparedRequest {
  channel: "whatsapp" | "email";
  request_id: string;
  token: string;
  phone_e164?: string | null;
  email?: string | null;
  expires_at: string;
}

export async function dispatchApprovalRequest(reservationId: string, deps: DispatchDeps, opts: { rotate?: boolean } = {}): Promise<DispatchResult> {
  const env = deps.env ?? currentApprovalEnv();
  // the manager's in-app (bell) notification does not depend on any channel being configured; idempotent, best effort
  try {
    await deps.rpc("fm_approval_notify_manager", { p_reservation_id: reservationId });
  } catch {
    // never blocks the booking or the channels
  }
  const channels: string[] = [];
  if (whatsappConfigured(env)) channels.push("whatsapp");
  if (emailConfigured(env) && deps.sendEmail && deps.renderEmail && deps.appUrl) channels.push("email");
  if (channels.length === 0) return { status: "disabled" };
  const doFetch = deps.fetch ?? fetch;
  try {
    const prepared = await deps.rpc("fm_approval_prepare", { p_reservation_id: reservationId, p_rotate: opts.rotate === true, p_channels: channels });
    if (prepared.error) return { status: "skipped", reason: "prepare_error" };
    const r = prepared.data as { ok?: boolean; reason?: string; payload?: ApprovalPayload; requests?: PreparedRequest[] } | null;
    if (!r || r.ok !== true || !r.payload || !Array.isArray(r.requests) || r.requests.length === 0) {
      return { status: "skipped", reason: r?.reason ?? "not_prepared" };
    }
    const results: ChannelResult[] = [];
    for (const req of r.requests) {
      let error: string | null = null;
      if (req.channel === "whatsapp" && req.phone_e164 && env.n8nUrl && env.n8nSecret) {
        const message = buildApprovalMessage(r.payload, req.token, req.expires_at);
        const body = JSON.stringify({
          type: "approval_request",
          request_id: req.request_id,
          reservation_id: reservationId,
          to: req.phone_e164,
          expires_at: req.expires_at,
          message,
          data: r.payload,
        });
        const timestamp = String(Math.floor((deps.now?.() ?? Date.now()) / 1000));
        try {
          const res = await doFetch(env.n8nUrl, {
            method: "POST",
            headers: { "content-type": "application/json", [TIMESTAMP_HEADER]: timestamp, [SIGNATURE_HEADER]: signBody(body, env.n8nSecret, timestamp) },
            body,
            signal: AbortSignal.timeout(TIMEOUT_MS),
          });
          if (!res.ok) error = `http_${res.status}`;
        } catch (e) {
          error = e instanceof Error ? e.name : "network_error";
        }
      } else if (req.channel === "email" && req.email && deps.sendEmail && deps.renderEmail && deps.appUrl) {
        const parts = buildApprovalEmail(r.payload, req.token, req.expires_at, deps.appUrl);
        const { html, text } = deps.renderEmail({ heading: parts.heading, bodyLines: parts.bodyLines, ctaLabel: parts.ctaLabel, ctaUrl: parts.ctaUrl });
        const sent = await deps.sendEmail({ to: req.email, subject: parts.subject, html, text });
        if (!sent.success) error = sent.error ?? "email_failed";
      } else {
        continue;
      }
      await deps.rpc("fm_approval_mark_delivery", { p_request_id: req.request_id, p_ok: error === null, p_error: error });
      results.push(error === null ? { channel: req.channel, status: "sent", requestId: req.request_id } : { channel: req.channel, status: "failed", requestId: req.request_id, error });
    }
    return { status: "done", results };
  } catch {
    return { status: "skipped", reason: "unexpected_error" };
  }
}
