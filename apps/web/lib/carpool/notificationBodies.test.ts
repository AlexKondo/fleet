import { describe, expect, it } from "vitest";
import { matchCarpoolBody, renderCarpoolBody } from "./notificationBodies";
import { dictionaries } from "@/lib/i18n/dictionaries";

// Literal bodies copied from supabase/migrations/0058_carpool_event_notifier.sql.
const SQL_BODIES: Array<[string, string]> = [
  ["3 pessoas pediram para participar da sua viagem para Centro. Acesse os detalhes da reserva para aceitar ou recusar.", "carpoolRequestsGrouped"],
  ["Sua solicitação de carona para Centro expirou sem resposta do motorista.", "carpoolRequestExpired"],
  ["Um colega cancelou a carona na sua viagem para Centro.", "carpoolCancelledByRider"],
  ["Sua solicitação de carona para Centro foi cancelada pela gestão.", "carpoolCancelledByManagement"],
  ["Sua carona para Centro foi invalidada porque a viagem do motorista foi cancelada.", "carpoolInvalidatedHostCancelled"],
  ["Sua carona para Centro foi invalidada porque a viagem do motorista foi alterada.", "carpoolInvalidatedHostChanged"],
  ["Sua carona para Centro foi invalidada porque o motorista desativou a oferta de carona.", "carpoolInvalidatedOfferDisabled"],
  ["A viagem do motorista para Centro foi alterada. Confira os novos detalhes.", "hostTripChangedForRider"],
  ["Sua viagem para Centro foi alterada. As solicitações de carona foram revalidadas.", "hostTripChangedForHost"],
  ["Sua viagem para Centro foi cancelada e as solicitações de carona foram encerradas.", "hostTripCancelledForHost"],
  ["Um colega entrou na sua viagem para Centro.", "carpoolJoinedHostTrip"],
];

const SQL_TITLES = [
  "Solicitação de carona expirada",
  "Carona cancelada",
  "Carona invalidada",
  "Viagem do motorista alterada",
  "Viagem com carona cancelada",
  "Carona confirmada na sua viagem",
];

describe("carpool notification bodies", () => {
  it.each(SQL_BODIES)("matches %s", (body, key) => {
    const match = matchCarpoolBody(body);
    expect(match?.key).toBe(key);
    expect(match?.destination).toBe("Centro");
  });

  it("extracts the count and a destination containing punctuation", () => {
    const match = matchCarpoolBody(
      "2 pessoas pediram para participar da sua viagem para Rua A, 10. Sala 2. Acesse os detalhes da reserva para aceitar ou recusar.",
    );
    expect(match).toEqual({ key: "carpoolRequestsGrouped", destination: "Rua A, 10. Sala 2", count: 2 });
  });

  it("does not match unrelated or legacy bodies (they keep their existing handling)", () => {
    expect(matchCarpoolBody("Sua reserva foi cancelada.")).toBeNull();
    expect(matchCarpoolBody("Sua solicitação de carona para Centro foi aceita pelo motorista.")).toBeNull();
  });

  it("every locale has a template for every key and a translation for every new title", () => {
    for (const [locale, dict] of Object.entries(dictionaries)) {
      for (const [body, key] of SQL_BODIES) {
        const match = matchCarpoolBody(body)!;
        const template = (dict.notifications.bodyTemplates as Record<string, string>)[key];
        expect(template, `${locale}.${key}`).toBeTruthy();
        const rendered = renderCarpoolBody(template!, match);
        expect(rendered).toContain("Centro");
        expect(rendered).not.toContain("{");
      }
      for (const title of SQL_TITLES) {
        expect((dict.notifications.knownTitles as Record<string, string>)[title], `${locale}:${title}`).toBeTruthy();
      }
    }
  });
});
