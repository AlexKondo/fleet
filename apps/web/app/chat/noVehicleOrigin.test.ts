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

describe("no vehicle at the person's own work location", () => {
  const work = { ...slots, origin: "São Paulo Office" };
  for (const locale of ["pt-BR", "en-US", "es", "zh-CN"] as const) {
    it(`${locale}: says only that there is no vehicle there (no list of other locations, no form link)`, () => {
      const reply = noVehicleReply(dictionaries[locale], work, ["no_vehicles_at_origin", "no_candidates_available"], undefined, "reservation", places);
      expect(reply.content).toContain("São Paulo Office");
      expect(reply.content).not.toContain("Portaria P1");
      expect(reply.content).not.toContain("{origin}");
      expect(reply.link).toBeUndefined();
    });
  }
  it("pt-BR: the exact short message", () => {
    const reply = noVehicleReply(dictionaries["pt-BR"], work, ["no_vehicles_at_origin"], undefined, "reservation", places);
    expect(reply.content).toBe("Não há veículo cadastrado ou disponível em São Paulo Office para esse horário. Peça para o administrador da frota cadastrar um veículo.");
  });
});
