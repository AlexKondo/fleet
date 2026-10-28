import { cleanUserText, formatWhen, type ApprovalPayload } from "./whatsappApproval";

/** Pure: the e-mail the direct manager receives. The link opens a CONFIRMATION page (no decision is taken by opening it). */
export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function approvalPageUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/aprovar/${token}`;
}

export interface ApprovalEmailParts {
  subject: string;
  heading: string;
  /** HTML paragraphs (every user-supplied text is escaped) */
  bodyLines: string[];
  ctaLabel: string;
  ctaUrl: string;
}

export function buildApprovalEmail(payload: ApprovalPayload, token: string, expiresAt: string, baseUrl: string): ApprovalEmailParts {
  const vehicleName = cleanUserText(payload.vehicle_name, 60);
  const plate = cleanUserText(payload.plate, 12);
  const vehicle = [vehicleName, plate && !vehicleName.toUpperCase().includes(plate.toUpperCase()) ? `(${plate})` : ""].filter(Boolean).join(" ") || plate || "—";
  const row = (label: string, value: string) => `<strong>${label}:</strong> ${escapeHtml(value)}`;
  const requester = cleanUserText(payload.requester_name, 80);
  const destination = cleanUserText(payload.destination, 80);
  return {
    subject: `Aprovação de reserva: ${requester} para ${destination}`,
    heading: "Pedido de uso de veículo",
    bodyLines: [
      `${escapeHtml(requester)} pediu um veículo e aguarda a sua aprovação.`,
      row("Veículo", vehicle),
      row("Saída", formatWhen(payload.departure_at)),
      row("Retorno", formatWhen(payload.return_at)),
      row("Origem", cleanUserText(payload.origin)),
      row("Destino", cleanUserText(payload.destination)),
      row("Objetivo", cleanUserText(payload.purpose, 240)),
      row("Passageiros", String(Number.isFinite(payload.passengers) ? payload.passengers : "—")),
      `Abra o pedido para <strong>aprovar</strong> ou <strong>recusar</strong>. O pedido vale até ${escapeHtml(formatWhen(expiresAt))}.`,
      "Se você não esperava este e-mail, ignore-o: nada é decidido ao abrir o link.",
    ],
    ctaLabel: "Analisar e decidir",
    ctaUrl: approvalPageUrl(baseUrl, token),
  };
}
