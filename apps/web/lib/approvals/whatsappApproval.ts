import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Pure parts of the WhatsApp approval: the message the manager reads, the answer texts and the HMAC signature shared with n8n.
 * No I/O here (dispatchApproval.ts sends, app/api/whatsapp/approval receives).
 */

export interface ApprovalPayload {
  requester_name: string;
  vehicle_name: string | null;
  plate: string | null;
  departure_at: string;
  return_at: string;
  origin: string;
  destination: string;
  purpose: string;
  passengers: number;
}

export interface ApprovalButton {
  id: string;
  title: string;
}

export interface ApprovalMessage {
  body: string;
  buttons: ApprovalButton[];
}

const TZ = "America/Sao_Paulo";
const MAX_FIELD = 180;

/** WhatsApp formatting characters and control characters typed by a user must not change how the message looks. */
export function cleanUserText(value: unknown, max = MAX_FIELD): string {
  const text = String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/[*_~`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** "qui, 29/10/2026 às 08:00" in Brasília time. */
export function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const parts = new Intl.DateTimeFormat("pt-BR", {
    timeZone: TZ, weekday: "short", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const weekday = get("weekday").replace(".", "");
  return `${weekday}, ${get("day")}/${get("month")}/${get("year")} às ${get("hour")}:${get("minute")}`;
}

/** The text and the two buttons sent to the manager. The token travels only inside the button ids (answered back by n8n). */
export function buildApprovalMessage(payload: ApprovalPayload, token: string, expiresAt: string): ApprovalMessage {
  const vehicleName = cleanUserText(payload.vehicle_name, 60);
  const plate = cleanUserText(payload.plate, 12);
  // the plate is shown once: some vehicle names already contain it
  const vehicle = [vehicleName, plate && !vehicleName.toUpperCase().includes(plate.toUpperCase()) ? `(${plate})` : ""].filter(Boolean).join(" ") || plate || "—";
  const lines = [
    "*Pedido de uso de veículo*",
    "",
    `Solicitante: ${cleanUserText(payload.requester_name, 80)}`,
    `Veículo: ${vehicle}`,
    `Saída: ${formatWhen(payload.departure_at)}`,
    `Retorno: ${formatWhen(payload.return_at)}`,
    `Origem: ${cleanUserText(payload.origin)}`,
    `Destino: ${cleanUserText(payload.destination)}`,
    `Objetivo: ${cleanUserText(payload.purpose, 240)}`,
    `Passageiros: ${Number.isFinite(payload.passengers) ? payload.passengers : "—"}`,
    "",
    "Toque em *Aprovar* para liberar o veículo ou em *Recusar* para negar o pedido.",
    `Este pedido vale até ${formatWhen(expiresAt)}.`,
  ];
  return {
    body: lines.join("\n"),
    buttons: [
      { id: `approve:${token}`, title: "Aprovar" },
      { id: `reject:${token}`, title: "Recusar" },
    ],
  };
}

/** `approve:<token>` / `reject:<token>` (the button id n8n gets back) -> decision + token. */
export function parseButtonId(buttonId: unknown): { decision: "approve" | "reject"; token: string } | null {
  const m = /^(approve|reject):([0-9a-f]{32,128})$/.exec(String(buttonId ?? "").trim());
  return m ? { decision: m[1] as "approve" | "reject", token: m[2]! } : null;
}

export type DecisionStatus =
  | "approved" | "rejected" | "already_decided" | "expired" | "invalid" | "phone_mismatch" | "not_authorized" | "vehicle_unavailable" | "superseded";

/** The text n8n sends back to the manager after the tap. No internal reason is exposed. */
export function replyForStatus(status: string): string {
  switch (status) {
    case "approved": return "✅ Aprovado. O veículo foi liberado para o solicitante.";
    case "rejected": return "❌ Recusado. O solicitante foi avisado.";
    case "already_decided": return "Este pedido já foi respondido. Nada foi alterado.";
    case "superseded": return "Este pedido já foi tratado por outra pessoa no sistema. Nada foi alterado.";
    case "expired": return "Este pedido expirou. O solicitante precisa fazer um novo pedido.";
    case "vehicle_unavailable": return "Não foi possível liberar: o veículo não está disponível. Fale com a gestão da frota.";
    case "phone_mismatch":
    case "not_authorized":
    case "invalid":
    default: return "Não foi possível processar esta resposta. Se precisar, aprove pelo sistema FleetMind.";
  }
}

// ---- signature shared with n8n: HMAC-SHA256 over `${timestamp}.${rawBody}` ----
export const SIGNATURE_HEADER = "x-fleet-signature";
export const TIMESTAMP_HEADER = "x-fleet-timestamp";
export const MAX_SKEW_SECONDS = 300;

export function signBody(rawBody: string, secret: string, timestamp: string): string {
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex")}`;
}

export function verifySignature(opts: { rawBody: string; secret: string; timestamp: string | null; signature: string | null; nowSeconds?: number }): boolean {
  const { rawBody, secret, timestamp, signature } = opts;
  if (!secret || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  const now = opts.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > MAX_SKEW_SECONDS) return false;
  const expected = Buffer.from(signBody(rawBody, secret, timestamp));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
