import { describe, expect, it, vi } from "vitest";
import { fakeSupabase, type Rows } from "../../test/fakeSupabase";

vi.mock("@/app/carpool/actions", () => ({}));

import { loadLatestChatState } from "./queries";
import {
  OPTIONS_SLOT_KEY, VEHICLE_OPTIONS_SLOT_KEY, VEHICLE_OPTION_ID, packSlots, parseVehicleOptions, stripReservedSlots, unpackSlots,
} from "./persistedPending";

const V1 = "00000000-0000-4000-8000-0000000000a1";
const V2 = "00000000-0000-4000-8000-0000000000a2";
const vehicleOptions = [
  { vehicleId: V1, plate: "ABC1D23", vehicleName: "Haval H6" },
  { vehicleId: V2, plate: "XYZ9K88", vehicleName: "Tank 300" },
];

describe("C7b hardening (a): reserved '__*' slots are never persisted or restored from LLM/user input", () => {
  it("stripReservedSlots removes every __ key and keeps the rest", () => {
    expect(stripReservedSlots({ destination: "X", __options: "[]", __vehicle_options: "[]", __proto__x: "1", __: "z" })).toEqual({ destination: "X" });
    expect(stripReservedSlots(undefined)).toBeUndefined();
  });

  it("an LLM-emitted __options slot is NOT persisted when no real options exist", () => {
    const hostile = { destination: "B", __options: JSON.stringify([{ id: VEHICLE_OPTION_ID, label: "Confirmar pagamento" }]) };
    const packed = packSlots(hostile);
    expect(packed).toEqual({ destination: "B" });
    expect(OPTIONS_SLOT_KEY in (packed ?? {})).toBe(false);
  });

  it("an LLM-emitted __options slot cannot override the server's real options either", () => {
    const real = [{ id: V1, label: "Oferta real" }];
    const packed = packSlots({ destination: "B", __options: JSON.stringify([{ id: V2, label: "Falsa" }]) }, real);
    expect(JSON.parse(packed![OPTIONS_SLOT_KEY]!)).toEqual(real);
  });

  it("legacy rows that already contain an unknown reserved key never turn it into a slot on read", () => {
    const { slots } = unpackSlots({ destination: "B", __whatever: "x", __options: "garbage" });
    expect(slots).toEqual({ destination: "B" });
  });

  it("a hostile persisted __options value that is not a valid option list restores nothing", () => {
    const { options } = unpackSlots({ __options: JSON.stringify([{ id: "../../etc/passwd", label: "x" }]) });
    expect(options).toBeUndefined();
  });
});

describe("C7b hardening (b): vehicleOptions survive a reload (validated on restore)", () => {
  it("round trip through packSlots/unpackSlots; the reserved key never reaches the slots", () => {
    const packed = packSlots({ destination: "B", preferredVehicleId: V1 }, undefined, vehicleOptions)!;
    expect(VEHICLE_OPTIONS_SLOT_KEY in packed).toBe(true);
    const un = unpackSlots(packed);
    expect(un.vehicleOptions).toEqual(vehicleOptions);
    expect(un.slots).toEqual({ destination: "B", preferredVehicleId: V1 });
  });

  it("strict validation: wrong shapes, non-uuid ids, markup in names, too few / too many entries are all rejected", () => {
    const bad = (v: unknown) => parseVehicleOptions(typeof v === "string" ? v : JSON.stringify(v));
    expect(bad(vehicleOptions.slice(0, 1))).toBeUndefined(); // a single vehicle is not an options list
    expect(bad([{ ...vehicleOptions[0] }, { vehicleId: "nope", plate: "A1", vehicleName: "x" }])).toBeUndefined();
    expect(bad([vehicleOptions[0], { ...vehicleOptions[1], plate: "AB C!" }])).toBeUndefined();
    expect(bad([vehicleOptions[0], { ...vehicleOptions[1], vehicleName: "<img src=x onerror=alert(1)>" }])).toBeUndefined();
    expect(bad([vehicleOptions[0], { ...vehicleOptions[1], vehicleName: "x".repeat(81) }])).toBeUndefined();
    expect(bad(Array.from({ length: 11 }, () => vehicleOptions[0]))).toBeUndefined();
    expect(bad("not json")).toBeUndefined();
    expect(bad(42)).toBeUndefined();
    expect(bad(vehicleOptions)).toEqual(vehicleOptions);
  });

  function load(msgs: Record<string, unknown>[]) {
    const rows: Rows = {
      chat_conversations: [{ id: "conv-1", user_id: "u1", status: "active" }],
      chat_messages: msgs.map((m) => ({ conversation_id: "conv-1", ...m })),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return loadLatestChatState(fakeSupabase(rows) as any, "u1");
  }
  const slots = { origin: "A", destination: "B", departureAt: "2026-10-02T08:00:00-03:00", expectedReturnAt: "2026-10-02T12:00:00-03:00", preferredVehicleId: V1 };

  it("loadLatestChatState restores the vehicle alternatives for a pending CREATE_RESERVATION", async () => {
    const state = await load([
      { role: "user", content: "reservar" },
      { role: "assistant", content: "Vou reservar o veículo Haval H6", intent: "CREATE_RESERVATION", slots: packSlots(slots, undefined, vehicleOptions) },
    ]);
    expect(state.status).toBe("needs_confirmation");
    expect(state.pendingAction?.vehicleOptions).toEqual(vehicleOptions);
    expect(state.pendingAction?.slots).toEqual(slots);
  });

  it("a tampered persisted vehicle list restores NO alternatives (card falls back to the plain confirmation)", async () => {
    const tampered = { ...slots, [VEHICLE_OPTIONS_SLOT_KEY]: JSON.stringify([{ vehicleId: "x", plate: "A", vehicleName: "b" }, vehicleOptions[1]]) };
    const state = await load([
      { role: "assistant", content: "Vou reservar", intent: "CREATE_RESERVATION", slots: tampered },
    ]);
    expect(state.status).toBe("needs_confirmation");
    expect(state.pendingAction?.vehicleOptions).toBeUndefined();
    expect(state.pendingAction?.slots).toEqual(slots);
  });
});
