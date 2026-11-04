import { signBody, SIGNATURE_HEADER, TIMESTAMP_HEADER } from "@/lib/approvals/whatsappApproval";
import { currentNoticeEnv, noticeUrl, type NoticeDeps, type NoticeResult } from "@/lib/approvals/notifyRequester";

export interface WhatsAppNotice {
  /** the member's number (E.164) */
  to: string;
  text: string;
  title?: string | null;
  /** at most 3 reply buttons; their ids come back as button taps */
  buttons?: { id: string; title: string }[] | null;
}

/**
 * Sends ONE WhatsApp message (text, or text with reply buttons) through n8n's signed "fleet-notify" webhook, the same channel the requester and
 * carpool notices use. Best effort: the caller decides what a failure means (the outbox retries it). Nothing personal is logged.
 */
export async function sendWhatsAppNotice(n: WhatsAppNotice, deps: Pick<NoticeDeps, "fetch" | "env" | "now"> = {}): Promise<NoticeResult> {
  const env = deps.env ?? currentNoticeEnv();
  const url = noticeUrl(env);
  if (!url || !env.secret) return { status: "skipped", reason: "not_configured" };
  try {
    const buttons = n.buttons && n.buttons.length > 0 ? n.buttons.slice(0, 3) : undefined;
    const body = JSON.stringify({ type: "carpool_notice", to: n.to, text: n.text, title: n.title ?? "FleetMind", ...(buttons ? { buttons } : {}) });
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
