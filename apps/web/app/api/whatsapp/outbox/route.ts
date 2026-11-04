import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sendWhatsAppNotice } from "@/lib/whatsapp/sendNotice";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Rpc = (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
interface OutboxRow { id: string; phone_e164: string; text: string; title: string | null; buttons: { id: string; title: string }[] | null }

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * The server's minute tick (cron on the WhatsApp server, same secret as /api/whatsapp/health): 1) the carpool takeover deadlines that passed move on to the next
 * rider (or release the vehicle); 2) the WhatsApp outbox (messages queued by the database: carpool accepted / trip cancelled, takeover invitations, approval
 * results) is sent through n8n, a few at a time, each retried up to 3 times. Changes nothing else.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.WHATSAPP_ALERT_SECRET;
  const given = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!secret || !given || !safeEqual(given, secret)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = createSupabaseAdminClient();
  const rpc = admin.rpc as unknown as Rpc;
  const expired = await rpc("fm_takeover_expire_due", {});
  const claimed = await rpc("fm_wa_outbox_claim", { p_limit: 20 });
  const rows = Array.isArray(claimed.data) ? (claimed.data as OutboxRow[]) : [];
  let sent = 0;
  let failed = 0;
  for (const row of rows) {
    const result = await sendWhatsAppNotice({ to: row.phone_e164, text: row.text, title: row.title, buttons: row.buttons });
    // "not configured" is not a delivery attempt: the message stays queued until n8n is configured
    const ok = result.status === "sent";
    await rpc("fm_wa_outbox_mark", { p_id: row.id, p_ok: ok, p_error: result.status === "sent" ? null : result.status === "failed" ? result.error : result.reason });
    if (ok) sent += 1;
    else failed += 1;
  }
  return NextResponse.json({ expired: typeof expired.data === "number" ? expired.data : 0, claimed: rows.length, sent, failed });
}
