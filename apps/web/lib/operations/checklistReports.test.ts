import { describe, expect, it } from "vitest";
import { checklistReportItems, hasChecklistReport } from "./checklistReports";

const clean = { has_new_damage: false, damage_notes: null, missing_safety_equipment: [], is_dirty_exterior: false, is_dirty_interior: false };
const labels = { damage: "Dano", equipment: "Equipamento", cleaning: "Limpeza", exterior: "Externa", interior: "Interna" };

describe("checklist reports", () => {
  it("a clean checklist reports nothing, also with the fields a gate check leaves empty", () => {
    expect(hasChecklistReport(clean)).toBe(false);
    expect(hasChecklistReport({ has_new_damage: false, missing_safety_equipment: null, is_dirty_exterior: null, is_dirty_interior: null })).toBe(false);
    expect(checklistReportItems(clean, labels)).toEqual([]);
  });
  it("each kind of report is one item, in words", () => {
    const row = { has_new_damage: true, damage_notes: " Risco na porta ", missing_safety_equipment: ["Triângulo", "Macaco"], is_dirty_exterior: true, is_dirty_interior: true };
    expect(hasChecklistReport(row)).toBe(true);
    expect(checklistReportItems(row, labels)).toEqual(["Dano: Risco na porta", "Equipamento: Triângulo, Macaco", "Limpeza: Externa / Interna"]);
  });
  it("damage without a description still shows", () => {
    expect(checklistReportItems({ ...clean, has_new_damage: true }, labels)).toEqual(["Dano"]);
  });
  it("dirt alone counts as a report", () => {
    expect(hasChecklistReport({ ...clean, is_dirty_interior: true })).toBe(true);
    expect(checklistReportItems({ ...clean, is_dirty_interior: true }, labels)).toEqual(["Limpeza: Interna"]);
  });
});
