import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, type Rows } from "../../test/fakeSupabase";
import { dictionaries, type Dictionary } from "@/lib/i18n/dictionaries";

/**
 * FIX-VENCIDAS / Assistente — "padrão de linguagem simples", tested end to end with the REAL chat
 * action (actions.ts), the REAL dispatch (dispatch.ts), the REAL planTrip (trips/new/actions.ts),
 * the REAL Mobility Decision Engine (@fleet/domain) and the REAL carpool chat glue. Only the
 * Supabase clients (in-memory fakes with controllable RPC errors), the LLM orchestrator (there is
 * no Claude API locally), geocoding/search adapters and e-mail are mocked.
 *
 * Every scenario runs in the 4 languages and asserts, on the text the user actually reads:
 *  - no technical tokens (codes, snake_case/UPPER_SNAKE identifiers, rpc/function names, SQLSTATE,
 *    database messages, stack traces, JSON braces);
 *  - no generic "errorGeneric" line for a known business situation (ChatPanel shows it only when
 *    `status === "error" && !explained`);
 *  - failures carry the 4 elements: what happened / why (when known) / alternatives / how to continue;
 *  - honesty: "the data is already in the form" appears IFF a prefilled /trips/new link is produced,
 *    "your carpool offer was not lost" IFF the user asked to offer seats and that link exists.
 */
const m = vi.hoisted(() => ({
  db: null as unknown as ReturnType<typeof import("../../test/fakeSupabase").fakeSupabase>,
  admin: null as unknown as ReturnType<typeof import("../../test/fakeSupabase").fakeSupabase>,
  locale: "pt-BR" as "pt-BR" | "en-US" | "es" | "zh-CN",
  interpret: vi.fn(),
  release: vi.fn(),
  rpcError: {} as Record<string, { code: string; message: string } | undefined>,
  busyError: false,
  resolve: vi.fn(),
  search: vi.fn(),
  post: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => m.db }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => m.admin }));
vi.mock("@/lib/auth/currentUser", () => ({ getCurrentUser: async () => ({ id: USER, email: "u@x" }) }));
vi.mock("@/lib/i18n/getLocale", () => ({ getLocale: async () => m.locale }));
vi.mock("@/lib/domain/chatOrchestrator", () => ({ interpretMessage: (...a: unknown[]) => m.interpret(...a) }));
vi.mock("@/lib/operations/aiPolicy", () => ({ assistantPolicy: async () => ({ enabled: true, available: true, legacy: false }) }));
vi.mock("@/lib/email/recipients", () => ({ getFleetManagerEmails: async () => [] }));
vi.mock("@/lib/email/renderEmail", () => ({ renderEmail: () => ({ html: "", text: "" }) }));
vi.mock("@/lib/email/sendEmail", () => ({ sendEmail: async () => undefined }));
vi.mock("@/lib/getAppUrl", () => ({ getAppUrl: () => "http://localhost" }));
vi.mock("@/app/reservations/[id]/actions", () => ({ postReservationMessage: (...a: unknown[]) => m.post(...a) }));
vi.mock("@/app/carpool/actions", () => ({
  searchCompatibleCarpool: (...a: unknown[]) => m.search(...a),
  searchCompatibleCarpoolForChat: (...a: unknown[]) => m.search(...a),
}));
vi.mock("@/lib/carpool/resolveLocationText", () => ({ resolveLocationText: (t: string) => m.resolve(t) }));
vi.mock("@/app/carpool/requestActions", () => ({ enableCarpoolOffer: vi.fn() }));
vi.mock("@/lib/geospatial/googlePlacesProvider", () => ({ createGooglePlacesProvider: () => ({}) }));
vi.mock("@/lib/geospatial/corporateMobilityPoints", () => ({ listCorporateMobilityPoints: async () => ({ status: "ok", data: [] }) }));
vi.mock("@/lib/carpool/offerCardRows", () => ({ loadOfferCardRows: async () => [] }));
vi.mock("./queries", () => ({
  findActiveReservations: vi.fn(async () => [
    { reservationId: "res-1", status: "confirmed", vehiclePlate: "GWM1H61", destination: "Campinas", departureAt: "2026-10-22T11:00:00Z", expectedReturnAt: "2026-10-22T20:00:00Z" },
  ]),
  resolveReservationId: vi.fn(() => "res-1"),
}));

import { sendChatMessage, type ChatState } from "./actions";
import { buildTripPrefillHref } from "@/lib/trips/tripPrefill";

const USER = "00000000-0000-4000-8000-0000000000a1";
const ORG = "org-1";
const LOCALES = ["pt-BR", "en-US", "es", "zh-CN"] as const;
const category = { id: "cat-1", name: "SUV", passenger_capacity: 5, supports_cargo: false, energy_type: "ICE" };
const vehicle = (id: string, plate: string, status: string) => ({
  id, organization_id: ORG, plate, name: `Carro ${plate}`, category_id: "cat-1", status, archived_at: null,
  odometer_km: 10_000, fuel_level_percent: 90, battery_level_percent: null, estimated_range_km: 700,
  next_service_odometer_km: 50_000, home_location_id: null, current_location_id: null, has_blocking_damage: false,
  missing_safety_equipment: [], documentation_valid: true, is_clean_exterior: true, is_clean_interior: true, category,
});
const fleet = (statuses: string[]) => statuses.map((s, i) => vehicle(`v${i + 1}`, `GWM${i + 1}A0${i}`, s));

// The stakeholder's example: "today 15:00, return 22:00, GWM factory -> EZ Tower, offering seats".
const day = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
const tripSlots = {
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
    const err = m.rpcError[name];
    if (err) return { data: null, error: err };
    if (name === "create_vehicle_reservation") return { data: "new-reservation", error: null };
    return { data: null, error: null };
  });
  m.admin = fakeSupabase({});
  m.admin.rpc.mockImplementation(async (name: string, args: unknown) => m.release(name, args));
  return rows;
}
const form = (f: Record<string, string>) => {
  const d = new FormData();
  for (const [k, v] of Object.entries(f)) d.set(k, v);
  return d;
};
const history: ChatState["messages"] = [{ role: "user", content: "oi" }, { role: "assistant", content: "Olá!" }];
const start: ChatState = { status: "idle", conversationId: "conv-1", messages: history };
const say = (state: ChatState = start) => sendChatMessage(state, form({ phase: "message", message: "pedido", conversationId: "conv-1" }));
const confirm = (state: ChatState) => sendChatMessage(state, form({ phase: "confirm", conversationId: "conv-1" }));
const interpretAs = (intent: string, slots: Record<string, string> = tripSlots) =>
  m.interpret.mockResolvedValue({ status: "ok", intent, slots, summary: "Resumo do LLM" });
const created = () => m.db.rpc.mock.calls.filter(([n]) => n === "create_vehicle_reservation");
const last = (s: ChatState) => s.messages.at(-1)!;

// ------------------------------------------------------------------------------------------
// assertions

const TECHNICAL = [
  /\b[A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+\b/, // UPPER_SNAKE codes (NO_SHOW, RESERVATION_CONFLICT...)
  /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/, // snake_case identifiers (no_candidates_available, cancel_reservation...)
  /\brpc\b/i,
  /\bfunction\b/i,
  /SQLSTATE/i,
  /violates/i,
  /null value/i,
  /\bat\s+\S+\s*\(?[^\s)]+:\d+:\d+\)?/, // stack frames
  /[{}]/, // JSON / unfilled templates
  /\b(?:undefined|NaN|null)\b/,
  /permission denied for/i,
  /\b(?:23P01|42501|P0001|XX000)\b/,
];
function expectPlain(text: string) {
  expect(text.trim().length).toBeGreaterThan(0);
  for (const re of TECHNICAL) expect(text, `technical token ${re} in: ${text}`).not.toMatch(re);
}

type Action = keyof Dictionary["chat"]["replies"]["what"];
type Kind = keyof Dictionary["chat"]["replies"]["why"];
function expectFailure(
  state: ChatState,
  dict: Dictionary,
  action: Action,
  why: { kind: Kind } | { text: string },
  cont: "form" | "chat" | "reenter",
  slots: Record<string, string> = tripSlots,
) {
  const msg = last(state);
  const text = msg.content;
  const r = dict.chat.replies;
  expectPlain(text);
  // (1) what happened
  expect(text).toContain(r.what[action]);
  // (2) why
  expect(text).toContain("kind" in why ? r.why[why.kind] : why.text);
  // (3) alternatives
  expect(text).toContain(r.alternatives[action]);
  // (4) how to continue — and HONESTY about what was really preserved
  const claimsForm = text.includes(r.keptInForm);
  const claimsChat = text.includes(r.keptInChat);
  expect(claimsForm).toBe(cont === "form");
  expect(claimsChat).toBe(cont === "chat");
  expect(text.includes(r.reenter)).toBe(cont === "reenter");
  expect(Boolean(msg.link)).toBe(cont === "form"); // the "already filled in" claim is backed by a real link
  if (cont === "form") {
    expect(msg.link!.href).toBe(buildTripPrefillHref(slots));
    expect(msg.link!.label).toBe(dict.chat.noVehicle.openForm);
    expect(text.includes(dict.chat.noVehicle.carpoolKept)).toBe(slots.allowCarpool === "true");
    if (slots.allowCarpool === "true") expect(msg.link!.href).toContain("allowCarpool=on");
  }
  if (cont === "chat") expect(state.messages.slice(0, history.length)).toEqual(history); // the conversation really is kept
  // never the generic line for a known business situation
  expect(text).not.toContain(dict.chat.errorGeneric);
  if (state.status === "error") expect(state.explained).toBe(true);
}

let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.stubEnv("FM_ENABLE_AUTO_RESERVATION_RELEASE","false");
  m.interpret.mockReset();
  interpretAs("CREATE_RESERVATION");
  m.release.mockReset().mockResolvedValue({ data: null, error: { message: "function fm_release_expired_reservations does not exist" } });
  m.rpcError = {};
  m.busyError = false;
  m.resolve.mockReset().mockImplementation(async (t: string) => ({ status: "resolved", place: { label: t, coordinates: { lat: -23.5, lng: -46.6 }, source: "geocoding_provider" } }));
  m.search.mockReset().mockResolvedValue({ status: "matches", matches: [] });
  m.post.mockReset().mockResolvedValue({ status: "success" });
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  errorSpy.mockRestore();
  m.locale = "pt-BR";
});

// ------------------------------------------------------------------------------------------

describe.each(LOCALES)("Assistente — linguagem simples [%s]", (locale) => {
  const dict = dictionaries[locale];
  const r = dict.chat.replies;
  beforeEach(() => {
    m.locale = locale;
  });

  it("available vehicle: card -> confirm creates the reservation (carpool offer kept in the request)", async () => {
    setup(fleet(["available"]));
    const card = await say();
    expect(card.status).toBe("needs_confirmation");
    expectPlain(card.pendingAction!.summary);
    expect(card.pendingAction?.slots).toMatchObject({ allowCarpool: "true", offerSeats: "2", preferredVehicleId: "v1" });
    const done = await confirm(card);
    expect(done.status).toBe("idle");
    expect(last(done).content.startsWith(r.success.reservationCreated.replace("{plate}", "GWM1A00"))).toBe(true);
    expectPlain(last(done).content);
    expect(created()).toHaveLength(1);
    expect(created()[0]![1]).toMatchObject({ p_vehicle_id: "v1", p_allow_carpool: true });
  });

  it("all vehicles 'reserved' by expired reservations: real cause (counts), alternatives, data in the form", async () => {
    setup(fleet(["reserved", "reserved", "reserved"]));
    const state = await say();
    expect(state.status).toBe("idle");
    expectFailure(state, dict, "reservation", { text: r.fleet.reservedOther.replace("{count}", "3") }, "form");
    expect(created()).toHaveLength(0); // nothing is created by the explanation
    expect(m.release).not.toHaveBeenCalled();
  });

  it("only maintenance", async () => {
    setup(fleet(["maintenance"]));
    expectFailure(await say(), dict, "reservation", { text: r.fleet.maintenanceOne.replace("{count}", "1") }, "form");
  });

  it("EZ Tower case — 6 reserved + 1 in maintenance: the exact explanation", async () => {
    setup(fleet(["reserved", "reserved", "reserved", "reserved", "reserved", "reserved", "maintenance"]));
    const state = await say();
    const why = `${r.fleet.intro} ${r.fleet.summary
      .replace("{total}", "7")
      .replace("{parts}", `${r.fleet.reservedOther.replace("{count}", "6")}${r.and}${r.fleet.maintenanceOne.replace("{count}", "1")}`)}`;
    expectFailure(state, dict, "reservation", { text: why }, "form");
    if (locale === "pt-BR") {
      expect(last(state).content).toBe(
        "Não consegui reservar um veículo para essa viagem. Não encontrei nenhum veículo disponível para esse horário. " +
          "Dos 7 veículos da frota, 6 estão registrados como reservados e 1 está em manutenção. " +
          "Você pode tentar outro horário, conferir suas reservas em Minhas Viagens, falar com o gestor da frota ou usar o formulário de reserva. " +
          "Sua intenção de oferecer vagas de carona não foi perdida: ela segue marcada no formulário. " +
          "Os dados que você me passou já vão preenchidos no formulário — é só abrir o link abaixo.",
      );
    }
  });

  it("only blocked vehicles", async () => {
    setup(fleet(["blocked", "blocked"]));
    expectFailure(await say(), dict, "reservation", { text: r.fleet.blockedOther.replace("{count}", "2") }, "form");
  });

  it("not enough seats / no cargo", async () => {
    setup(fleet(["available", "available"]));
    interpretAs("CREATE_RESERVATION", { ...tripSlots, passengerCount: "9" });
    expectFailure(await say(), dict, "reservation", { text: r.fleet.seatsOther.replace("{count}", "2") }, "form", { ...tripSlots, passengerCount: "9" });
    interpretAs("CREATE_RESERVATION", { ...tripSlots, requiresCargo: "true" });
    expectFailure(await say(), dict, "reservation", { text: r.fleet.cargoOther.replace("{count}", "2") }, "form", { ...tripSlots, requiresCargo: "true" });
  });

  const rpcFailures: [string, { code: string; message: string }, Kind][] = [
    ["CNH invalid/expired", { code: "P0001", message: "DRIVER_NOT_AUTHORIZED" }, "license"],
    ["outside the allowed window", { code: "P0001", message: "OUTSIDE_RESERVATION_WINDOW" }, "outsideWindow"],
    ["double booking", { code: "23P01", message: "conflicting key value violates exclusion constraint \"reservations_vehicle_id_tstzrange_excl\"" }, "reservationConflict"],
    ["maintenance conflict", { code: "P0001", message: "MAINTENANCE_CONFLICT" }, "maintenanceConflict"],
    ["scope denied", { code: "P0001", message: "MANAGEMENT_SCOPE_DENIED" }, "scopeDenied"],
    ["permission denied", { code: "42501", message: "permission denied for function create_vehicle_reservation" }, "permissionDenied"],
    ["validation error", { code: "23514", message: "new row for relation \"reservations\" violates check constraint \"reservations_check\"" }, "invalidData"],
    ["unexpected exception", { code: "XX000", message: "null value in column \"x\" violates not-null constraint" }, "unexpected"],
  ];
  for (const [name, error, kind] of rpcFailures) {
    it(`reservation refused at confirmation — ${name}: plain reason, carpool offer kept in the form, cause only in the log`, async () => {
      setup(fleet(["available"]));
      const card = await say();
      m.rpcError.create_vehicle_reservation = error;
      const state = await confirm(card);
      expect(state.status).toBe("error");
      expectFailure(state, dict, "reservation", { kind }, "form");
      expect(errorSpy.mock.calls.flat().join(" ")).toContain(error.message); // real cause in the server log
    });
  }

  it("availability check with no vehicle (a query, not an error)", async () => {
    setup(fleet(["reserved", "maintenance"]));
    interpretAs("CHECK_AVAILABILITY");
    const state = await say();
    expect(state.status).toBe("idle");
    expectFailure(state, dict, "availability", { text: r.fleet.reservedOne.replace("{count}", "1") }, "form");
    expect(last(state).content).not.toContain(r.fleet.intro); // "what" already says it
  });

  it("availability check with a vehicle: plain success", async () => {
    setup(fleet(["available"]));
    interpretAs("CHECK_AVAILABILITY");
    const state = await say();
    expect(last(state).content).toBe(r.success.vehicleAvailable.replace("{plate}", "GWM1A00"));
  });

  it("carpool search with no matches", async () => {
    setup(fleet(["available"]));
    interpretAs("FIND_CARPOOL", { destination: "EZ Tower", origin: "Fábrica GWM", departureAt: tripSlots.departureAt });
    expectFailure(await say(), dict, "carpoolFind", { text: dict.chat.carpool.findNone }, "chat");
  });

  it("maps provider outage (quota / Cost Guard / Google down)", async () => {
    setup(fleet(["available"]));
    m.resolve.mockResolvedValue({ status: "unavailable", reason: "quota_exceeded" });
    interpretAs("FIND_CARPOOL", { destination: "EZ Tower", origin: "Fábrica GWM", departureAt: tripSlots.departureAt });
    expectFailure(await say(), dict, "carpoolFind", { kind: "providerOutage" }, "chat");
  });

  it("validation — ambiguous destination is a clarification in plain words (no code, nothing guessed)", async () => {
    setup(fleet(["available"]));
    m.resolve.mockImplementation(async (t: string) =>
      t === "São Paulo" ? { status: "needs_precision", reason: "city_level" } : { status: "resolved", place: { label: t, coordinates: { lat: -23.5, lng: -46.6 }, source: "geocoding_provider" } },
    );
    interpretAs("FIND_CARPOOL", { destination: "São Paulo", origin: "Fábrica GWM", departureAt: tripSlots.departureAt });
    const state = await say();
    expectPlain(last(state).content);
    expect(last(state).content).toContain("São Paulo");
    expect(m.search).not.toHaveBeenCalled();
  });

  it("validation — a required field missing at confirmation", async () => {
    setup(fleet(["available"]));
    const card = await say();
    const { destination: _d, ...rest } = card.pendingAction!.slots;
    void _d;
    const state = await confirm({ ...card, pendingAction: { ...card.pendingAction!, slots: rest } });
    expectFailure(state, dict, "generic", { kind: "missingInfo" }, "chat");
  });

  it("cancel refused: permission denied / trip already started", async () => {
    setup(fleet(["available"]));
    interpretAs("CANCEL_RESERVATION", { reservationId: "res-1" });
    const card = await say();
    m.rpcError.cancel_reservation = { code: "42501", message: "permission denied for function cancel_reservation" };
    expectFailure(await confirm(card), dict, "cancel", { kind: "permissionDenied" }, "chat");
    m.rpcError.cancel_reservation = { code: "P0001", message: "CANCEL_BLOCKED_OPERATION_STARTED" };
    expectFailure(await confirm(card), dict, "cancel", { kind: "tripStarted" }, "chat");
  });

  it("post-message failure: a database message is never shown; a translated validation text is used as the reason", async () => {
    setup(fleet(["available"]));
    interpretAs("REPORT_DELAY", { reservationId: "res-1", delayNotes: "trânsito" });
    const card = await say();
    m.post.mockResolvedValue({ status: "error", error: "Not authorized to message on this reservation" });
    expectFailure(await confirm(card), dict, "message", { kind: "permissionDenied" }, "chat");
    m.post.mockResolvedValue({ status: "error", error: dictionaries["pt-BR"].errors.reservations.messageRequired });
    const state = await confirm(card);
    expectFailure(state, dict, "message", { text: dictionaries["pt-BR"].errors.reservations.messageRequired }, "chat");
  });

  it("unexpected exception while planning (availability read error) — friendly, not the user's fault, logged", async () => {
    setup(fleet(["available"]));
    m.busyError = true;
    const state = await say();
    expect(state.status).toBe("error");
    expectFailure(state, dict, "reservation", { kind: "unexpected" }, "form");
    expect(errorSpy).toHaveBeenCalledWith("chat CREATE_RESERVATION planTrip failed:", "availability_unavailable");
  });

  it("LLM unavailable (no Claude API locally): friendly unexpected reply, cause only in the log", async () => {
    setup(fleet(["available"]));
    m.interpret.mockResolvedValue({ status: "error", message: "missing_api_key" });
    const state = await say();
    expect(state.status).toBe("error");
    expectFailure(state, dict, "generic", { kind: "unexpected" }, "chat");
    expect(errorSpy).toHaveBeenCalledWith("chat interpretMessage failed:", "missing_api_key");
  });

  it("informational replies are plain and translated (not understood, not automated, reservation info)", async () => {
    setup(fleet(["available"]));
    m.interpret.mockResolvedValue({ status: "low_confidence" });
    expect(last(await say()).content).toBe(r.notUnderstood);
    interpretAs("START_TRIP", { reservationId: "res-1" });
    expect(last(await say()).content).toBe(r.notAutomated.startTrip);
    interpretAs("VIEW_RESERVATION", {});
    const info = last(await say()).content;
    expectPlain(info);
    expect(info).toContain("GWM1H61");
    expect(info).not.toContain("2026-10-22T11:00:00Z");
  });
});

describe("Assistente — after the R3 release the same request finds vehicles", () => {
  it("vehicles freed by fm_release_expired_reservations give a card instead of the explanation", async () => {
    vi.stubEnv("FM_ENABLE_AUTO_RESERVATION_RELEASE","true");
    const rows = setup(fleet(["reserved", "reserved"]));
    m.release.mockImplementation(async () => {
      for (const v of rows.vehicles!) if (v.status === "reserved") v.status = "available"; // what 0209 does for expired no-shows
      return { data: { released: 2, vehicles_released: 2, skipped_with_activity: 0, skipped_locked: 0 }, error: null };
    });
    const state = await say();
    expect(state.status).toBe("needs_confirmation");
    expect(state.pendingAction?.slots.preferredVehicleId).toMatch(/^v[12]$/);
    expect(created()).toHaveLength(0);
  });

  it("the no-vehicle answer keeps the conversation active and persists the trip data without an intent", async () => {
    setup(fleet(["reserved"]));
    const state = await say();
    expect(state.conversationId).toBe("conv-1");
    const row = m.admin.inserted.filter((i) => i.table === "chat_messages" && i.row.role === "assistant").at(-1)!.row;
    expect(row.intent).toBeUndefined();
    expect(row.slots).toMatchObject({ origin: tripSlots.origin, destination: tripSlots.destination, allowCarpool: "true", offerSeats: "2" });
    expect(row.content).toBe(last(state).content);
    expect(m.admin.updated.filter((u) => u.table === "chat_conversations")).toHaveLength(0);
  });

  it("without the carpool offer the reply does not mention it and the link says allowCarpool=off", async () => {
    setup(fleet(["reserved"]));
    const slots = { ...tripSlots, allowCarpool: "false", offerSeats: "" };
    interpretAs("CREATE_RESERVATION", slots);
    const state = await say();
    expectFailure(state, dictionaries["pt-BR"], "reservation", { text: "1 está registrado como reservado" }, "form", slots);
    expect(new URL(last(state).link!.href, "http://x").searchParams.get("allowCarpool")).toBe("off");
  });

  it("rate limit: the message was not kept, so the reply asks to send it again (no false 'kept' claim)", async () => {
    setup(fleet(["available"]));
    m.admin = fakeSupabase({ chat_messages: Array.from({ length: 10 }, (_, i) => ({ id: `m${i}`, role: "user", chat_conversations: { user_id: USER } })) });
    const state = await say();
    expectFailure(state, dictionaries["pt-BR"], "generic", { kind: "rateLimited" }, "reenter");
  });
});
