import { describe, expect, it } from "vitest";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { noVehicleReply } from "./noVehicle";

const slots = { origin: "fábrica da GWM", destination: "EZ Tower, São Paulo", departureAt: "2026-10-29T09:00:00-03:00", expectedReturnAt: "2026-12-01T20:00:00-03:00" };
const places = [{ name: "Portaria P1", count: 2 }, { name: "Estacionamento GA Shop", count: 2 }];

describe("no vehicle because the origin is not a registered location", () => {
  for (const locale of ["pt-BR", "en-US", "es", "zh-CN"] as const) {
    it(`${locale}: lists the registered locations that have a vehicle`, () => {
      const reply = noVehicleReply(dictionaries[locale], slots, ["origin_location_unknown", "no_candidates_available"], undefined, "reservation", places);
      expect(reply.content).toContain("• Portaria P1 (2)");
      expect(reply.content).toContain("• Estacionamento GA Shop (2)");
      expect(reply.content).not.toContain("{list}");
    });
  }
  it("does not claim that no vehicle exists, and keeps the form link", () => {
    const reply = noVehicleReply(dictionaries["pt-BR"], slots, ["origin_location_unknown", "no_candidates_available"], undefined, "reservation", places);
    expect(reply.content).not.toContain("Nenhum veículo cadastrado está disponível");
    expect(reply.link.href).toContain("/trips/new");
  });
  it("without any location to offer, the previous explanation is kept", () => {
    const reply = noVehicleReply(dictionaries["pt-BR"], slots, ["origin_location_unknown"], undefined, "reservation", []);
    expect(reply.content).toContain("Informe um dos locais cadastrados");
  });
});
