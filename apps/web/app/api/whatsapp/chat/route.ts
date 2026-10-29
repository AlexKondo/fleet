import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, verifySignature } from "@/lib/approvals/whatsappApproval";
import { handleInboundWhatsApp, type BridgeDeps, type InboundMessage } from "@/lib/whatsapp/chatBridge";
import { transcribeAudio } from "@/lib/whatsapp/transcribe";
import { runAsUser } from "@/lib/auth/actingUser";
import { mintUserClient } from "@/lib/auth/mintUserClient";
import { getAppUrl } from "@/lib/getAppUrl";
import { notifyRiderOfDecision } from "@/lib/carpool/notifyRider";
import { loadLatestChatState } from "@/app/chat/queries";
import { sendChatMessage } from "@/app/chat/actions";
import { getTripRouteMap } from "@/app/carpool/routeMapActions";

export const dynamic = "force-dynamic";
// the assistant (language model + route/vehicle search) and a voice-note transcription can take a while
export const maxDuration = 60;

const MAX_BODY = 4_400_000; // Vercel's request limit is 4.5 MB: a voice note arrives as base64 inside the JSON

/**
 * A WhatsApp message to the assistant, forwarded by n8n (the Evolution webhook). Authenticated by the same HMAC-SHA256 signature as
 * /api/whatsapp/approval (N8N_APPROVAL_SECRET, 5-minute window). Fails closed. The sender is identified by the phone registered in
 * /settings/approvals; unknown numbers get an empty answer. See lib/whatsapp/chatBridge.ts.
 *
 * Body: { from, message_id, kind: "text"|"audio"|"button"|"other", text?, button_id?, audio_base64?, mime_type? }
 * Answer: { replies: [{ type: "text", text } | { type: "buttons", text, buttons: [{ id, title }] } | { type: "image", text, imageBase64 }] } - n8n sends them in order.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.N8N_APPROVAL_SECRET;
  if (!secret) return NextResponse.json({ error: "not_configured" }, { status: 503, headers: { "Cache-Control": "no-store" } });

  const raw = await request.text();
  if (raw.length > MAX_BODY) return NextResponse.json({ error: "too_large" }, { status: 413 });
  const ok = verifySignature({ rawBody: raw, secret, timestamp: request.headers.get(TIMESTAMP_HEADER), signature: request.headers.get(SIGNATURE_HEADER) });
  if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const kinds = ["text", "audio", "button", "other"] as const;
  const kind = kinds.find((k) => k === body.kind);
  const from = typeof body.from === "string" ? body.from.slice(0, 32) : "";
  if (!kind || !from) return NextResponse.json({ replies: [] }, { headers: { "Cache-Control": "no-store" } });

  const message: InboundMessage = {
    from,
    messageId: typeof body.message_id === "string" ? body.message_id.slice(0, 200) : null,
    kind,
    text: typeof body.text === "string" ? body.text.slice(0, 2000) : undefined,
    buttonId: typeof body.button_id === "string" ? body.button_id.slice(0, 200) : undefined,
    audioBase64: typeof body.audio_base64 === "string" ? body.audio_base64 : undefined,
    mimeType: typeof body.mime_type === "string" ? body.mime_type.slice(0, 100) : undefined,
  };

  const admin = createSupabaseAdminClient();
  const deps: BridgeDeps = {
    rpc: (name, args) => (admin.rpc as unknown as (n: string, a: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>)(name, args),
    mintClient: mintUserClient,
    runAsUser,
    loadState: async (client, userId) => {
      const state = await loadLatestChatState(client, userId);
      let lastActivity: string | null = null;
      if (state.conversationId) {
        // the conversation row's updated_at does not move with new messages: the last message's time is the real activity
        const { data } = await client.from("chat_messages").select("created_at").eq("conversation_id", state.conversationId).order("created_at", { ascending: false }).limit(1).maybeSingle();
        lastActivity = data?.created_at ?? null;
      }
      return { state, updatedAt: lastActivity };
    },
    abandon: async (client, conversationId) => {
      await client.from("chat_conversations").update({ status: "abandoned", updated_at: new Date().toISOString() }).eq("id", conversationId);
    },
    send: sendChatMessage,
    transcribe: (audio, mime) => transcribeAudio(audio, mime),
    appUrl: getAppUrl(),
    routeMap: async (origin, destination) => {
      const r = await getTripRouteMap({ originText: origin, destinationText: destination });
      if (r.status !== "ok") return null;
      const lines = [`Rota: ${r.originLabel} → ${r.destinationLabel}`, `${r.distanceKm.toLocaleString("pt-BR")} km · ${r.durationMin} min`];
      if (r.approximate) lines.push("(aproximado: um dos endereços é só uma região)");
      return { imageBase64: r.imageDataUrl.replace(/^data:image\/png;base64,/, ""), caption: lines.join("\n") };
    },
    notifyRider: async (requestId, justification) => { await notifyRiderOfDecision(requestId, justification, { rpc: (n, a) => admin.rpc(n as never, a as never) as never }); },
  };

  try {
    const result = await handleInboundWhatsApp(message, deps);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("whatsapp chat: unexpected failure", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "unavailable" }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
