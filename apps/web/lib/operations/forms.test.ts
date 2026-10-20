import { describe, it, expect } from "vitest";
import { localTimestamp, operationForm, operationReturn } from "./forms";
import {
  lineTotal,
  orderCosts,
  orderActions,
  parseSnapshot,
  type WorkOrderLine,
} from "./models";
describe("operational boundary", () => {
  it("preserves the requested Brasília maintenance time without accepting invalid calendar dates", () => {
    expect(localTimestamp("2026-10-16T09:30")).toBe("2026-10-16T12:30:00.000Z");
    expect(() => localTimestamp("2026-02-31T09:30")).toThrow();
    expect(() => localTimestamp("2026-10-16")).toThrow();
  });
  it("cannot redirect an operational action to an external address", () => {
    expect(operationReturn("https://evil.invalid/maintenance")).toBe(
      "/maintenance",
    );
    expect(operationReturn("//evil.invalid/gate/history")).toBe("/maintenance");
    expect(operationReturn("/maintenance/work-orders?order=123")).toBe(
      "/maintenance/work-orders?order=123",
    );
    expect(operationReturn("http://[")).toBe("/maintenance");
  });
  it("rejects NaN and other nondecimal costs before calling the database", () => {
    const f = new FormData();
    Object.entries({
      command: "work_order.create",
      request_id: "00000000-0000-4000-8000-000000000001",
      vehicle_id: "00000000-0000-4000-8000-000000000002",
      kind: "preventive",
      description: "Revisão",
      supplier: "",
      quote_total: "NaN",
    }).forEach(([k, v]) => f.set(k, v));
    expect(() => operationForm(f)).toThrow("INVALID_INPUT");
  });
  it("calculates warranty and effective costs without including voided lines", () => {
    const line = {
      stage: "actual",
      quantity: 1,
      unit_price: 100,
      warranty: false,
      voided_at: null,
    } as WorkOrderLine;
    expect(
      orderCosts([
        line,
        { ...line, unit_price: 50, warranty: true },
        { ...line, unit_price: 1000, voided_at: "2026-01-01" },
      ]),
    ).toEqual({ gross: 150, warranty: 50, effective: 100 });
    expect(orderCosts([{ ...line, stage: "planned" }])).toEqual({
      gross: 0,
      warranty: 0,
      effective: 0,
    });
    expect(lineTotal({ ...line, quantity: 1.005, unit_price: 1 })).toBe(1.01);
    expect(lineTotal({ ...line, quantity: 0.333, unit_price: 1 })).toBe(0.33);
    // The former +500 / 1000 formula truncates negative credits one cent toward zero.
    expect(Number((-2001000n+500n)/1000n)/100).toBe(-20);
    expect(lineTotal({...line,quantity:1,unit_price:-20.01})).toBe(-20.01);
  });
  it("does not offer approval to maintenance operators or actions on terminal states", () => {
    expect(orderActions("budgeted", false)).toEqual([]);
    expect(orderActions("budgeted", true)).toContain("approved");
    expect(orderActions("completed", true)).toEqual([]);
    expect(orderActions("cancelled", true)).toEqual([]);
  });
  it("distinguishes a restricted snapshot from an invalid response", () => {
    const snapshot = parseSnapshot({ gate: [] });
    expect(snapshot.orders).toBeNull();
    expect(snapshot.gate).toEqual([]);
    expect(() =>
      parseSnapshot({
        orders: [{ id: "x", status: "invented", version: 1, vehicle_id: "v" }],
      }),
    ).toThrow();
  });
});
