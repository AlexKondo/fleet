import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { canShowOperationExceptionForm } from "./operationExceptionUi";

describe("who sees the denied-departure form (S3-04, mirrors fm_operation_exception 0211)", () => {
  it("security only in a gate_visual unit", () => {
    expect(canShowOperationExceptionForm({ role: "security", workflow: "gate_visual", inScope: true })).toBe(true);
    expect(canShowOperationExceptionForm({ role: "security", workflow: "key_custody", inScope: true })).toBe(false);
    expect(canShowOperationExceptionForm({ role: "security", workflow: undefined, inScope: true })).toBe(false);
  });
  it("managers and administrators only within scope, in both workflows", () => {
    for (const role of ["fleet_manager", "administrator"]) {
      for (const workflow of ["gate_visual", "key_custody"] as const) {
        expect(canShowOperationExceptionForm({ role, workflow, inScope: true })).toBe(true);
        expect(canShowOperationExceptionForm({ role, workflow, inScope: false })).toBe(false);
      }
    }
  });
  it("nobody else", () => {
    for (const role of ["employee", "maintenance_operator", null, undefined]) {
      expect(canShowOperationExceptionForm({ role, workflow: "gate_visual", inScope: true })).toBe(false);
    }
  });
});

describe("source guards for the F2 mechanical fixes", () => {
  const read = (p: string) => fs.readFileSync(path.resolve(__dirname, "../..", p), "utf8");
  it("S3-11: /analytics reads only non-archived vehicles", () => {
    expect(read("app/analytics/page.tsx")).toMatch(/from\("fm_managed_vehicles"\)[\s\S]{0,400}\.is\("archived_at", null\)/);
  });
  it("S3-04/S3-05: the reservation page uses the mirrored rule and the persistent exception notice", () => {
    const page = read("app/reservations/[id]/page.tsx");
    expect(page).toContain("canShowOperationExceptionForm(");
    expect(page).toContain('data-testid="operation-exception-notice"');
  });
  it("S3-07: the confirmation checkbox is re-synced after each action result", () => {
    expect(read("app/reservations/[id]/OperationExceptionForm.tsx")).toMatch(/ref=\{confirmRef\}/);
  });
});
