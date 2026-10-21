import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, type Rows } from "../../test/fakeSupabase";

/**
 * FIX-VENCIDAS / Assistente: stakeholder report "trip today 15:00-22:00, GWM factory -> EZ Tower,
 * offering carpool seats" answered with the raw code `no_candidates_available` followed by the
 * generic error. Wired end to end with the REAL chat action (actions.ts), the REAL dispatch
 * (dispatch.ts), the REAL planTrip (trips/new/actions.ts) and the REAL Mobility Decision Engine
 * (@fleet/domain); only the Supabase clients (in-memory fakes), the LLM orchestrator (no Claude API
 * locally) and e-mail/geospatial adapters are mocked.
 */
const m = vi.hoisted(() => ({
  db: null as unknown as ReturnType<typeof import("../../test/fakeSupabase").fakeSupabase>,
  admin: null as unknown as ReturnType<typeof import("../../test/fakeSupabase").fakeSupabase>,
  interpret: vi.fn(),
  release: vi.fn(),
  busyError: false,
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => m.db }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => m.admin }));
vi.mock("@/lib/auth/currentUser", () => ({ getCurrentUser: async () => ({ id: USER, email: "u@x" }) }));
vi.mock("@/lib/i18n/getLocale", () => ({ getLocale: async () => "pt-BR" }));
vi.mock("@/lib/domain/chatOrchestrator", () => ({ interpretMessage: (...a: unknown[]) => m.interpret(...a) }));
vi.mock("@/lib/operations/aiPolicy", () => ({ assistantPolicy: async () => ({ enabled: true, available: true, legacy: false }) }));
vi.mock("@/lib/email/recipients", () => ({ getFleetManagerEmails: async () => [] }));
vi.mock("@/lib/email/renderEmail", () => ({ renderEmail: () => ({ html: "", text: "" }) }));
vi.mock("@/lib/email/sendEmail", () => ({ sendEmail: async () => undefined }));
vi.mock("@/lib/getAppUrl", () => ({ getAppUrl: () => "http://localhost" }));
vi.mock("@/app/reservations/[id]/actions", () => ({ postReservationMessage: vi.fn() }));
// Carpool-first runs (default policy) and finds no compatible carpool, so the vehicle path is exercised.
vi.mock("@/app/carpool/actions", () => ({
  searchCompatibleCarpool: async () => ({ status: "matches", matches: [] }),
  searchCompatibleCarpoolForChat: async () => ({ status: "matches", matches: [] }),
}));
vi.mock("@/lib/carpool/resolveLocationText", () => ({
  resolveLocationText: async (t: string) => ({ status: "resolved", place: { label: t, coordinates: { lat: -23.5, lng: -46.6 }, source: "geocoding_provider" } }),
}));
vi.mock("@/app/carpool/requestActions", () => ({ enableCarpoolOffer: vi.fn() }));
vi.mock("@/lib/geospatial/googlePlacesProvider", () => ({ createGooglePlacesProvider: () => ({}) }));
vi.mock("@/lib/geospatial/corporateMobilityPoints", () => ({ listCorporateMobilityPoints: async () => ({ status: "ok", data: [] }) }));
vi.mock("@/lib/carpool/offerCardRows", () => ({ loadOfferCardRows: async () => [] }));
vi.mock("./queries", () => ({ findActiveReservations: vi.fn(async () => []), resolveReservationId: vi.fn() }));

import { sendChatMessage, type ChatState } from "./actions";

const USER = "00000000-0000-4000-8000-0000000000a1";
const ORG = "org-1";
const category = { id: "cat-1", name: "SUV", passenger_capacity: 5, supports_cargo: true, energy_type: "ICE" };
const vehicle = (id: string, plate: string, status: string) => ({
  id, organization_id: ORG, plate, name: `Carro ${plate}`, category_id: "cat-1", status, archived_at: null,
  odometer_km: 10_000, fuel_level_percent: 90, battery_level_percent: null, estimated_range_km: 700,
  next_service_odometer_km: 50_000, home_location_id: null, current_location_id: null, has_blocking_damage: false,
  missing_safety_equipment: [], documentation_valid: true, is_clean_exterior: true, is_clean_interior: true, category,
});

// "today 15:00, return 22:00" (Brasília), kept in the future so nothing depends on the clock.
const day = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
const slots = {
  departureAt: `${day}T15:00:00-03:00`,
  expectedReturnAt: `${day}T22:00:00-03:00`,
  origin: "Fábrica GWM Iracemápolis",
  destination: "EZ Tower, São Paulo",
  distanceKm: "160",
  passengerCount: "1",
  requiresCargo: "false",
  allowCarpool: "true",
  offerSeats: "2",
  justification: "Reunião",
};

function setup(vehicles: Record<string, unknown>[]) {
  const rows: Rows = { profiles: [{ id: USER, organization_id: ORG, organization: { name: "Org" } }], vehicles };
  m.db = fakeSupabase(rows);
  m.db.rpc.mockImplementation(async (name: string) => {
    if (name === "fm_availability_windows") return m.busyError ? { data: null, error: { message: "boom" } } : { data: [], error: null };
    if (name === "create_vehicle_reservation") return { data: "new-reservation", error: null };
    return { data: null, error: null };
  });
  m.admin = fakeSupabase({});
  // fm_release_expired_reservations (0209): default = the function is not there yet / fails (before R3).
  m.admin.rpc.mockImplementation(async (name: string, args: unknown) => m.release(name, args));
  m.release.mockResolvedValue({ data: null, error: { message: "function fm_release_expired_reservations does not exist" } });
  return rows;
}
const form = (f: Record<string, string>) => {
  const d = new FormData();
  for (const [k, v] of Object.entries(f)) d.set(k, v);
  return d;
};
const empty: ChatState = { status: "idle", conversationId: "conv-1", messages: [] };
const ask = (state: ChatState = empty) =>
  sendChatMessage(state, form({ phase: "message", message: "viagem hoje 15h fábrica -> EZ Tower, ofereço carona", conversationId: "conv-1" }));
const created = () => m.db.rpc.mock.calls.filter(([n]) => n === "create_vehicle_reservation");
const lastAssistantRow = () => m.admin.inserted.filter((i) => i.table === "chat_messages" && i.row.role === "assistant").at(-1)?.row;

let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  m.interpret.mockReset().mockResolvedValue({ status: "ok", intent: "CREATE_RESERVATION", slots, summary: "Resumo do LLM" });
  m.release.mockReset();
  m.busyError = false;
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => errorSpy.mockRestore());

function expectNoVehicleAnswer(state: ChatState) {
  const last = state.messages.at(-1)!;
  expect(state.status).toBe("idle"); // not an error: ChatPanel shows no generic error line
  expect(state.error).toBeUndefined();
  expect(state.pendingAction).toBeUndefined();
  expect(last.content).not.toMatch(/no_candidates_available|no_eligible_vehicle/);
  expect(last.content).toContain("Nenhuma reserva foi criada");
  expect(last.content).toContain("Minhas Viagens");
  expect(last.content).toContain("gestor da frota");
  expect(last.content).toContain("oferecer vagas de carona não foi perdida");
  const href = new URL(last.link!.href, "http://x");
  expect(href.pathname).toBe("/trips/new");
  expect(Object.fromEntries(href.searchParams)).toEqual({
    origin: slots.origin,
    destination: slots.destination,
    departureAt: `${day}T15:00`,
    expectedReturnAt: `${day}T22:00`,
    passengerCount: "1",
    distanceKm: "160",
    allowCarpool: "on",
    offerSeats: "2",
  });
  expect(last.link!.label).toBe("Abrir o formulário com os dados preenchidos");
  expect(created()).toHaveLength(0);
  // the trip data survives in the persisted chat row, without an intent (never restored as a card)
  const row = lastAssistantRow()!;
  expect(row.intent).toBeUndefined();
  expect(row.slots).toMatchObject({ origin: slots.origin, destination: slots.destination, allowCarpool: "true", offerSeats: "2" });
  expect(row.content).toBe(last.content);
}

describe("Assistente: no vehicle for the window", () => {
  it("available vehicle: card -> confirm creates the reservation with the carpool offer preserved", async () => {
    setup([vehicle("v1", "GWM1H61", "available")]);
    const card = await ask();
    expect(card.status).toBe("needs_confirmation");
    expect(card.pendingAction?.slots).toMatchObject({ allowCarpool: "true", offerSeats: "2", preferredVehicleId: "v1" });
    const done = await sendChatMessage(card, form({ phase: "confirm", conversationId: "conv-1" }));
    expect(done.status).toBe("idle");
    expect(done.messages.at(-1)!.content).toContain("Reserva criada");
    expect(created()).toHaveLength(1);
    expect(created()[0]![1]).toMatchObject({ p_vehicle_id: "v1", p_allow_carpool: true });
  });

  it("all vehicles stuck 'reserved' by expired reservations (before R3): explanation + alternatives + data preserved", async () => {
    setup([vehicle("v1", "GWM1H61", "reserved"), vehicle("v2", "GWM2H62", "reserved"), vehicle("v3", "GWM2M51", "maintenance")]);
    const state = await ask();
    expectNoVehicleAnswer(state);
    expect(state.messages.at(-1)!.content).toContain("Nenhum veículo cadastrado está disponível no momento.");
    expect(m.release).toHaveBeenCalledWith("fm_release_expired_reservations", { p_organization_id: ORG });
  });

  it("after the release function frees the no-show vehicles, candidates appear again (same request)", async () => {
    const rows = setup([vehicle("v1", "GWM1H61", "reserved"), vehicle("v2", "GWM2H62", "reserved")]);
    m.release.mockImplementation(async () => {
      for (const v of rows.vehicles!) if (v.status === "reserved") v.status = "available"; // what 0209 does for expired no-shows
      return { data: { released: 2, vehicles_released: 2, skipped_with_activity: 0, skipped_locked: 0 }, error: null };
    });
    const state = await ask();
    expect(state.status).toBe("needs_confirmation");
    expect(state.pendingAction?.slots.preferredVehicleId).toMatch(/^v[12]$/);
    expect(created()).toHaveLength(0); // still only a card until the user confirms
  });

  it("only a vehicle in maintenance: same explanation (never the raw code)", async () => {
    setup([vehicle("v3", "GWM2M51", "maintenance")]);
    expectNoVehicleAnswer(await ask());
  });

  it("only blocked vehicles: same explanation (never the raw code)", async () => {
    setup([vehicle("v4", "GWM3B52", "blocked"), vehicle("v5", "GWM3B53", "blocked")]);
    expectNoVehicleAnswer(await ask());
  });

  it("vehicles become unavailable between the card and the confirmation: explanation, conversation kept active", async () => {
    const rows = setup([vehicle("v1", "GWM1H61", "available")]);
    const card = await ask();
    expect(card.status).toBe("needs_confirmation");
    rows.vehicles![0]!.status = "reserved";
    const state = await sendChatMessage(card, form({ phase: "confirm", conversationId: "conv-1" }));
    expectNoVehicleAnswer(state);
    expect(state.conversationId).toBe("conv-1");
    expect(m.admin.updated.filter((u) => u.table === "chat_conversations")).toHaveLength(0);
  });

  it("without the carpool offer the explanation does not mention it and the link says allowCarpool=off", async () => {
    setup([vehicle("v1", "GWM1H61", "reserved")]);
    m.interpret.mockResolvedValue({ status: "ok", intent: "CREATE_RESERVATION", slots: { ...slots, allowCarpool: "false", offerSeats: "" }, summary: "x" });
    const state = await ask();
    const last = state.messages.at(-1)!;
    expect(last.content).not.toContain("carona");
    expect(new URL(last.link!.href, "http://x").searchParams.get("allowCarpool")).toBe("off");
    expect(new URL(last.link!.href, "http://x").searchParams.has("offerSeats")).toBe(false);
  });

  it("CHECK_AVAILABILITY with no vehicle: translated explanation, not the raw code", async () => {
    setup([vehicle("v1", "GWM1H61", "reserved")]);
    m.interpret.mockResolvedValue({ status: "ok", intent: "CHECK_AVAILABILITY", slots, summary: "x" });
    const state = await ask();
    expect(state.status).toBe("idle");
    expect(state.messages.at(-1)!.content).toContain("Nenhum veículo cadastrado está disponível no momento.");
    expect(state.messages.at(-1)!.content).not.toMatch(/no_candidates_available/);
    expect(state.messages.at(-1)!.link?.href).toMatch(/^\/trips\/new\?/);
  });

  it("an unexpected failure (availability read error) is the ONLY case with the generic error, and it is logged", async () => {
    setup([vehicle("v1", "GWM1H61", "available")]);
    m.busyError = true;
    const state = await ask();
    expect(state.status).toBe("error");
    expect(state.messages.at(-1)!.content).toContain("Não consegui processar");
    expect(state.messages.at(-1)!.link).toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith("chat CREATE_RESERVATION planTrip failed:", "availability_unavailable");
  });

  it("the LLM unavailable locally (no Claude API key) is a genuine error, logged with its cause", async () => {
    setup([vehicle("v1", "GWM1H61", "available")]);
    m.interpret.mockResolvedValue({ status: "error", message: "missing_api_key" });
    const state = await ask();
    expect(state.status).toBe("error");
    expect(errorSpy).toHaveBeenCalledWith("chat interpretMessage failed:", "missing_api_key");
  });
});
