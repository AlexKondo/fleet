import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { sendEmail } from "@/lib/email/sendEmail";

export const dynamic = "force-dynamic";

const DEFAULT_TO = "alexandre.kondo@gmail.com";
const STATES = ["down", "stuck", "ok"] as const;
type State = (typeof STATES)[number];

const TEXTS: Record<State, { subject: string; heading: string; line: string }> = {
  down: {
    subject: "Fleet: o WhatsApp caiu",
    heading: "O WhatsApp do Fleet caiu",
    line: "O servidor do WhatsApp (Evolution) está desconectado ou fora do ar. Ninguém consegue falar com o assistente por lá.",
  },
  stuck: {
    subject: "Fleet: o WhatsApp está conectado, mas não recebe mensagens",
    heading: "O WhatsApp conectou, mas não entrega mensagens",
    line: "A conexão voltou sem terminar a sincronização de mensagens: as mensagens recebidas não chegam ao assistente. Pode ser preciso reiniciar o Evolution ou parear de novo (QR code).",
  },
  ok: {
    subject: "Fleet: o WhatsApp voltou",
    heading: "O WhatsApp voltou ao normal",
    line: "A conexão e a sincronização estão normais de novo.",
  },
};

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * The monitor on the WhatsApp server (cron, every minute) calls this when the connection state changes: down, stuck (connected but the
 * message sync never finished: nothing is delivered) or ok (back to normal). It only e-mails the alert address; it changes no data.
 * Authorized by the shared secret WHATSAPP_ALERT_SECRET.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.WHATSAPP_ALERT_SECRET;
  const given = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!secret || !given || !safeEqual(given, secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as { state?: unknown; detail?: unknown } | null;
  const state = STATES.find((s) => s === body?.state);
  if (!state) return NextResponse.json({ error: "invalid_state" }, { status: 400 });
  const detail = typeof body?.detail === "string" ? body.detail.replace(/\s+/g, " ").trim().slice(0, 300) : "";

  const when = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "medium" });
  const t = TEXTS[state];
  const text = `${t.heading}\n\n${t.line}\n\nHorário (Brasília): ${when}${detail ? `\nDetalhe: ${detail}` : ""}`;
  const html = `<h2>${t.heading}</h2><p>${t.line}</p><p>Horário (Brasília): <strong>${when}</strong>${detail ? `<br/>Detalhe: ${escapeHtml(detail)}` : ""}</p>`;
  const result = await sendEmail({ to: process.env.WHATSAPP_ALERT_TO || DEFAULT_TO, subject: t.subject, html, text });
  return NextResponse.json({ sent: result.success }, { status: result.success ? 200 : 502 });
}
