import { describe, expect, it, vi } from "vitest";
import { fakeSupabase, type Rows } from "../../test/fakeSupabase";

vi.mock("@/app/carpool/actions", () => ({}));

import { loadLatestChatState } from "./queries";
import { OPTIONS_SLOT_KEY, VEHICLE_OPTION_ID, packSlots, parseOptions, unpackSlots } from "./persistedPending";
import { shortPlaceLabel } from "./carpoolChat";

const OFFER_A = "00000000-0000-4000-8000-0000000000e1";
const OFFER_B = "00000000-0000-4000-8000-0000000000e2";
const options = [
  { id: OFFER_A, label: "Saída 10:00 · desvio +2.2 km / +6 min · 2 vagas" },
  { id: VEHICLE_OPTION_ID, label: "Usar um veículo" },
];

function load(msgs: Record<string, unknown>[]) {
  const rows: Rows = {
    chat_conversations: [{ id: "conv-1", user_id: "u1", status: "active" }],
    chat_messages: msgs.map((m) => ({ conversation_id: "conv-1", ...m })),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return loadLatestChatState(fakeSupabase(rows) as any, "u1");
}

describe("loadLatestChatState restores numbered options after a reload (F1)", () => {
  it("FIND_CARPOOL options come back: buttons + bare-number reply work, no Confirmar-only card", async () => {
    const slots = { origin: "A", destination: "B", departureAt: "2026-10-02T08:00:00-03:00" };
    const state = await load([
      { role: "user", content: "tem carona?" },
      { role: "assistant", content: "Encontrei caronas compatíveis.", intent: "FIND_CARPOOL", slots: packSlots(slots, options) },
    ]);
    expect(state.status).toBe("needs_confirmation");
    expect(state.pendingAction?.intent).toBe("FIND_CARPOOL");
    expect(state.pendingAction?.options).toEqual(options);
    // the reserved key never leaks into the slots that reach dispatch / the confirm guard
    expect(state.pendingAction?.slots).toEqual(slots);
    expect(OPTIONS_SLOT_KEY in (state.pendingAction?.slots ?? {})).toBe(false);
  });

  it("a carpool-first chat reservation restores WITH its options (never as a plain Confirmar card)", async () => {
    const slots = { departureAt: "2026-10-02T08:00:00-03:00", expectedReturnAt: "2026-10-02T18:00:00-03:00", destination: "X", origin: "Y", allowCarpool: "false" };
    const state = await load([
      { role: "assistant", content: "Antes de reservar um veículo...", intent: "CREATE_RESERVATION", slots: packSlots(slots, options) },
    ]);
    expect(state.status).toBe("needs_confirmation");
    expect(state.pendingAction?.intent).toBe("CREATE_RESERVATION");
    expect(state.pendingAction?.options?.map((o) => o.id)).toEqual([OFFER_A, VEHICLE_OPTION_ID]);
  });

  it("a REQUEST_CARPOOL confirmation card (no options) restores as before", async () => {
    const slots = { offerId: OFFER_A, clientRequestId: "c", origin: "A", destination: "B", departureAt: "2026-10-02T08:00:00-03:00" };
    const state = await load([{ role: "assistant", content: "Vou solicitar 1 vaga...", intent: "REQUEST_CARPOOL", slots }]);
    expect(state.pendingAction).toMatchObject({ intent: "REQUEST_CARPOOL", slots });
    expect(state.pendingAction?.options).toBeUndefined();
  });

  it("OLD-format rows (no options) are unchanged: mutating card restores, read-only FIND row does not", async () => {
    const card = await load([{ role: "assistant", content: "Vou reservar...", intent: "CREATE_RESERVATION", slots: { destination: "X" } }]);
    expect(card.status).toBe("needs_confirmation");
    expect(card.pendingAction?.options).toBeUndefined();
    const find = await load([{ role: "assistant", content: "Encontrei", intent: "FIND_CARPOOL", slots: { destination: "X" } }]);
    expect(find.status).toBe("idle");
    const plain = await load([{ role: "assistant", content: "oi" }]);
    expect(plain.status).toBe("idle");
  });

  it("tampered / malformed persisted options are dropped (ids must be uuids or the vehicle choice)", () => {
    expect(parseOptions(JSON.stringify([{ id: "not-a-uuid", label: "x" }]))).toBeUndefined();
    expect(parseOptions(JSON.stringify([{ id: OFFER_B }]))).toBeUndefined();
    expect(parseOptions("{oops")).toBeUndefined();
    expect(parseOptions(undefined)).toBeUndefined();
    expect(unpackSlots({ a: "1", [OPTIONS_SLOT_KEY]: "garbage" })).toEqual({ slots: { a: "1" }, options: undefined });
  });
});

describe("shortPlaceLabel (F5, display only)", () => {
  it("drops postal code and country, keeps the rest", () => {
    expect(shortPlaceLabel("Av. Paulista, 1578 - Bela Vista, São Paulo - SP, 01310-200, Brazil")).toBe("Av. Paulista, 1578 - Bela Vista, São Paulo - SP");
    expect(shortPlaceLabel("Aeroporto - SP, 04626-911, Brasil")).toBe("Aeroporto - SP");
    expect(shortPlaceLabel("Ponto Sede - Rua X, 10")).toBe("Ponto Sede - Rua X, 10");
  });
});
