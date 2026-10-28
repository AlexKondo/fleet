import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { parseButtonId, replyForStatus, SIGNATURE_HEADER, TIMESTAMP_HEADER, verifySignature } from "@/lib/approvals/whatsappApproval";

export const dynamic = "force-dynamic";

/**
 * The manager's tap on Aprovar / Recusar, forwarded by n8n.
 *
 * Public to the session middleware on purpose (n8n has no user session); the request is authenticated here by an HMAC-SHA256
 * signature over `${timestamp}.${rawBody}` with N8N_APPROVAL_SECRET (5-minute window), and the decision is authorized inside the
 * database (single-use token, registered phone, still the requester's manager - see migration 0229). Fails closed.
 *
 * Body: { "button_id": "approve:<token>" | "reject:<token>", "from": "<sender phone>", "message_id": "<whatsapp message id>" }
 * Answer: { status, reply_text, reservation_id? } - n8n sends `reply_text` back to the manager.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.N8N_APPROVAL_SECRET;
  if (!secret) return NextResponse.json({ error: "not_configured" }, { status: 503, headers: { "Cache-Control": "no-store" } });

  const raw = await request.text();
  if (raw.length > 8_192) return NextResponse.json({ error: "too_large" }, { status: 413 });
  const ok = verifySignature({ rawBody: raw, secret, timestamp: request.headers.get(TIMESTAMP_HEADER), signature: request.headers.get(SIGNATURE_HEADER) });
  if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });

  let body: { button_id?: unknown; from?: unknown; message_id?: unknown };
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const parsed = parseButtonId(body.button_id);
  const from = typeof body.from === "string" ? body.from.slice(0, 32) : "";
  const messageId = typeof body.message_id === "string" ? body.message_id.slice(0, 200) : null;
  if (!parsed || !from) {
    return NextResponse.json({ status: "invalid", reply_text: replyForStatus("invalid") }, { status: 200, headers: { "Cache-Control": "no-store" } });
  }

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("fm_approval_decide", {
    p_token: parsed.token,
    p_decision: parsed.decision,
    p_from_phone: from,
    p_message_id: messageId,
    p_channel: "whatsapp",
  });
  if (error || !data || typeof data !== "object" || Array.isArray(data)) {
    console.error("whatsapp approval: decide failed", error?.message);
    return NextResponse.json({ error: "unavailable" }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
  const result = data as { status?: string; reservation_id?: string };
  const status = typeof result.status === "string" ? result.status : "invalid";
  return NextResponse.json(
    { status, reply_text: replyForStatus(status), reservation_id: result.reservation_id ?? null },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}
