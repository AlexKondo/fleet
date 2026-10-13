import { describe, expect, it } from "vitest";
import { parseBrasiliaLocalDateTime } from "./brasiliaLocalDateTime";
import {
  composeLocalDateTime,
  energyFilterTypes,
  filterByEnergy,
  justificationFor,
  motivoFromJustification,
  splitLocalDateTime,
  type MotivoLabels,
} from "./reservarForm";

const labels: MotivoLabels = {
  meeting: "Reunião",
  clientVisit: "Visita a cliente",
  training: "Treinamento",
  delivery: "Entrega",
  maintenance: "Manutenção/oficina",
  other: "Outro",
};

describe("date + time composition", () => {
  it("composes into the zone-less value read as Brasilia time", () => {
    const v = composeLocalDateTime("2026-09-13", "08:00");
    expect(v).toBe("2026-09-13T08:00");
    expect(parseBrasiliaLocalDateTime(v).toISOString()).toBe("2026-09-13T11:00:00.000Z");
    expect(parseBrasiliaLocalDateTime(composeLocalDateTime("2026-09-13", "23:30")).toISOString()).toBe("2026-09-14T02:30:00.000Z");
  });
  it("rejects missing / malformed parts", () => {
    expect(composeLocalDateTime("", "08:00")).toBe("");
    expect(composeLocalDateTime("2026-09-13", "")).toBe("");
    expect(composeLocalDateTime("13/09/2026", "08:00")).toBe("");
    expect(composeLocalDateTime("2026-09-13", "8:00")).toBe("");
  });
  it("splits and round-trips", () => {
    expect(splitLocalDateTime("2026-09-13T08:00")).toEqual({ date: "2026-09-13", time: "08:00" });
    expect(splitLocalDateTime("2026-09-13T08:00:30")).toEqual({ date: "2026-09-13", time: "08:00" });
    expect(splitLocalDateTime("garbage")).toEqual({ date: "", time: "" });
    const s = splitLocalDateTime("2026-12-31T17:45");
    expect(composeLocalDateTime(s.date, s.time)).toBe("2026-12-31T17:45");
  });
});

describe("motivo da viagem", () => {
  it("maps each option to its label and Outro to the custom text", () => {
    expect(justificationFor("meeting", "ignored", labels)).toBe("Reunião");
    expect(justificationFor("maintenance", "", labels)).toBe("Manutenção/oficina");
    expect(justificationFor("other", "  Levar documentos  ", labels)).toBe("Levar documentos");
    expect(justificationFor("other", "   ", labels)).toBe("");
  });
  it("restores the select from a stored justification", () => {
    expect(motivoFromJustification("Treinamento", labels)).toEqual({ key: "training", other: "" });
    expect(motivoFromJustification("Outro", labels)).toEqual({ key: "other", other: "Outro" });
    expect(motivoFromJustification("Levar documentos", labels)).toEqual({ key: "other", other: "Levar documentos" });
    expect(motivoFromJustification("", labels)).toEqual({ key: "meeting", other: "" });
  });
});

describe("vehicle energy filter", () => {
  const vs = [
    { id: "1", energyType: "PHEV" },
    { id: "2", energyType: "BEV" },
    { id: "3", energyType: "PHEV" },
  ];
  it("lists only the real types, stable order", () => {
    expect(energyFilterTypes(vs)).toEqual(["BEV", "PHEV"]);
    expect(energyFilterTypes([])).toEqual([]);
    expect(energyFilterTypes([{ energyType: "ICE" }, { energyType: "XYZ" }])).toEqual(["ICE", "XYZ"]);
  });
  it("filters, keeping order; all keeps everything", () => {
    expect(filterByEnergy(vs, "PHEV").map((v) => v.id)).toEqual(["1", "3"]);
    expect(filterByEnergy(vs, "all").map((v) => v.id)).toEqual(["1", "2", "3"]);
    expect(filterByEnergy(vs, "ICE")).toEqual([]);
  });
});
