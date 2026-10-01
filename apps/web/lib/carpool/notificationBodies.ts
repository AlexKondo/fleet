/**
 * Phase C4 — pt-BR body frames written by the carpool notification subscriber
 * (`carpool_events_notify`, supabase/migrations/0058_carpool_event_notifier.sql). The SQL
 * stores pt-BR text; NotificationBell translates at render time by matching these frames and
 * re-inserting the runtime destination verbatim (same approach as the legacy carpool frames
 * in NotificationBell.tsx). Kept in a plain module so it is unit-testable without React.
 *
 * `key` indexes `dictionary.notifications.bodyTemplates`.
 */

export type CarpoolBodyKey =
  | "carpoolRequestsGrouped"
  | "carpoolRequestExpired"
  | "carpoolCancelledByRider"
  | "carpoolCancelledByManagement"
  | "carpoolInvalidatedHostCancelled"
  | "carpoolInvalidatedHostChanged"
  | "carpoolInvalidatedOfferDisabled"
  | "hostTripChangedForRider"
  | "hostTripChangedForHost"
  | "hostTripCancelledForHost"
  | "carpoolJoinedHostTrip";

interface Frame {
  key: CarpoolBodyKey;
  prefix: string;
  suffix: string;
}

const FRAMES: Frame[] = [
  { key: "carpoolRequestExpired", prefix: "Sua solicitação de carona para ", suffix: " expirou sem resposta do motorista." },
  { key: "carpoolCancelledByManagement", prefix: "Sua solicitação de carona para ", suffix: " foi cancelada pela gestão." },
  { key: "carpoolCancelledByRider", prefix: "Um colega cancelou a carona na sua viagem para ", suffix: "." },
  { key: "carpoolInvalidatedHostCancelled", prefix: "Sua carona para ", suffix: " foi invalidada porque a viagem do motorista foi cancelada." },
  { key: "carpoolInvalidatedHostChanged", prefix: "Sua carona para ", suffix: " foi invalidada porque a viagem do motorista foi alterada." },
  { key: "carpoolInvalidatedOfferDisabled", prefix: "Sua carona para ", suffix: " foi invalidada porque o motorista desativou a oferta de carona." },
  { key: "hostTripChangedForRider", prefix: "A viagem do motorista para ", suffix: " foi alterada. Confira os novos detalhes." },
  { key: "hostTripChangedForHost", prefix: "Sua viagem para ", suffix: " foi alterada. As solicitações de carona foram revalidadas." },
  { key: "hostTripCancelledForHost", prefix: "Sua viagem para ", suffix: " foi cancelada e as solicitações de carona foram encerradas." },
  { key: "carpoolJoinedHostTrip", prefix: "Um colega entrou na sua viagem para ", suffix: "." },
];

const GROUPED = /^(\d+) pessoas pediram para participar da sua viagem para ([\s\S]*)\. Acesse os detalhes da reserva para aceitar ou recusar\.$/;

export interface CarpoolBodyMatch {
  key: CarpoolBodyKey;
  destination: string;
  count?: number;
}

export function matchCarpoolBody(body: string): CarpoolBodyMatch | null {
  const grouped = GROUPED.exec(body);
  if (grouped) {
    return { key: "carpoolRequestsGrouped", destination: grouped[2]!, count: Number(grouped[1]) };
  }
  for (const frame of FRAMES) {
    if (body.startsWith(frame.prefix) && body.endsWith(frame.suffix) && body.length >= frame.prefix.length + frame.suffix.length) {
      return {
        key: frame.key,
        destination: body.slice(frame.prefix.length, body.length - frame.suffix.length),
      };
    }
  }
  return null;
}

/** Fills a dictionary template ({destination}, optional {count}). */
export function renderCarpoolBody(template: string, match: CarpoolBodyMatch): string {
  return template
    .replace("{destination}", match.destination)
    .replace("{count}", match.count === undefined ? "" : String(match.count));
}
