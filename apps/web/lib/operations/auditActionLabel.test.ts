import { describe, expect, it } from "vitest";
import { auditActionLabel } from "../i18n/auditActionLabel";
import ptBR from "../i18n/dictionaries/pt-BR";
import enUS from "../i18n/dictionaries/en-US";
import es from "../i18n/dictionaries/es";
import zhCN from "../i18n/dictionaries/zh-CN";

// S3-10: the raw codes seen on /admin and /admin/audit in the local homologation database.
const SEEN = [
  "fleet.lifecycle", "photo.linked", "operation.exception", "keys.delivered", "keys.received", "vehicle.created",
  "vehicle.damage_hold_released", "carpool_ride_accepted", "carpool_ride_rejected", "equipment.checklist_contract",
  "gate.departure", "gate.record", "member.update_role", "pickup_inspection_recorded", "reservation_approved",
  "reservation_cancelled", "reservation.approve", "reservation.cancel", "reservation.no_show_released",
  "return_inspection_recorded", "vehicle_blocked", "vehicle_unblocked", "vehicle.block", "work_order.create",
  "workflow_task_completed",
];
const DICTS = [["pt-BR", ptBR], ["en-US", enUS], ["es", es], ["zh-CN", zhCN]] as const;

describe("audit action labels (S3-10)", () => {
  it.each(DICTS)("%s has a plain label for every code seen in the audit log", (_l, dict) => {
    for (const code of SEEN) {
      const label = auditActionLabel(dict, code);
      expect(label, code).not.toBe(code);
      expect(dict.auditActions.labels[code], code).toBeTruthy();
    }
  });

  it("all languages translate the same set of codes", () => {
    const keys = Object.keys(ptBR.auditActions.labels).sort();
    for (const [, dict] of DICTS) expect(Object.keys(dict.auditActions.labels).sort()).toEqual(keys);
  });

  it("an unknown code gets the translated fallback with a readable code, never the bare key", () => {
    expect(auditActionLabel(ptBR, "incident.resolve_case")).toBe("Outro evento (incident resolve case)");
    expect(auditActionLabel(enUS, "order.adjustment.approved")).toBe("Other event (order adjustment approved)");
  });
});
