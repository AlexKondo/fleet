import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TypedSupabaseClient } from "@fleet/supabase-client";
import type { ChatState } from "@/app/chat/actions";
import { runAsUser, getActingContext } from "@/lib/auth/actingUser";
import { CHAT_BUTTON, handleInboundWhatsApp, parseChoice, renderState, TEXTS, type BridgeDeps, type InboundMessage } from "./chatBridge";

const USER = { ok: true, user_id: "u1", organization_id: "o1", email: "ana@example.invalid", full_name: "Ana" };
const CLIENT = { tag: "client" } as unknown as TypedSupabaseClient;
const idle: ChatState = { status: "idle", messages: [] };
const reply = (content: string, extra: Partial<ChatState> = {}): ChatState => ({ status: "idle", conversationId: "c1", messages: [{ role: "user", content: "x" }, { role: "assistant", content }], ...extra });

interface World { cpPending: unknown; cpResolve: unknown; pick: { picked_user_id: string | null; asked: boolean; pending_text?: string | null }; pickWrites: { phone: string; user: string | null; pending?: string }[]; identify: unknown; open: boolean; registerNew: boolean; state: ChatState; updatedAt: string | null; mint: TypedSupabaseClient | null; next: ChatState | Error; transcribe: unknown }
let w: World;
const cp = { resolve: [] as Record<string, unknown>[], marks: [] as { status: string; reason: string | null }[], rpcCalls: [] as { name: string; args: Record<string, unknown> }[], rider: [] as { id: string; reason?: string }[], rpcError: false };
const calls = { send: [] as { prev: ChatState; form: Record<string, string> }[], abandon: [] as string[], register: [] as Record<string, unknown>[], actedAs: [] as (string | undefined)[], transcribe: [] as string[], mint: 0 };

function deps(over: Partial<BridgeDeps> = {}): BridgeDeps {
  return {
    rpc: async (name, args) => {
      if (name === "fm_whatsapp_identify") return { data: w.identify, error: null };
      if (name === "fm_whatsapp_session_open") return { data: w.open, error: null };
      if (name === "fm_carpool_pending_reason") return { data: w.cpPending, error: null };
      if (name === "fm_carpool_token_resolve") { cp.resolve.push(args); return { data: w.cpResolve, error: null }; }
      if (name === "fm_carpool_token_mark") { cp.marks.push({ status: String(args.p_status), reason: (args.p_reason as string | null) ?? null }); return { data: true, error: null }; }
      if (name === "fm_whatsapp_pick_state") return { data: w.pick, error: null };
      if (name === "fm_whatsapp_pick_write") { w.pickWrites.push({ phone: String(args.p_phone_norm), user: (args.p_user as string | null) ?? null, ...(args.p_pending ? { pending: String(args.p_pending) } : {}) }); return { data: true, error: null }; }
      if (name === "fm_whatsapp_register_inbound") { calls.register.push(args); return { data: w.registerNew, error: null }; }
      return { data: null, error: { message: "unexpected" } };
    },
    mintClient: async () => { calls.mint++; return w.mint; },
    runAsUser,
    loadState: async () => ({ state: w.state, updatedAt: w.updatedAt }),
    abandon: async (_c, id) => { calls.abandon.push(id); },
    send: async (prev, form) => {
      calls.actedAs.push(getActingContext()?.user.id);
      calls.send.push({ prev, form: Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)])) });
      if (w.next instanceof Error) throw w.next;
      return w.next;
    },
    transcribe: async (b64) => { calls.transcribe.push(b64); return w.transcribe as never; },
    appUrl: "https://fleet.example.invalid/",
    now: () => Date.parse("2026-10-28T20:00:00Z"),
    ...over,
  };
}
const msg = (over: Partial<InboundMessage> = {}): InboundMessage => ({ from: "5511987654321", messageId: "m1", kind: "text", text: "fleet quero um carro", ...over });
const run = (m: InboundMessage, d = deps()) => handleInboundWhatsApp(m, d);
const texts = (r: { replies: { type: string; text: string }[] }) => r.replies.map((x) => x.text);

beforeEach(() => {
  w = { cpPending: { ok: false }, cpResolve: { ok: false, reason: "invalid" }, pick: { picked_user_id: null, asked: false }, pickWrites: [], identify: USER, open: false, registerNew: true, state: idle, updatedAt: null, mint: CLIENT, next: reply("Para quando?"), transcribe: { ok: true, text: "fleet quero um carro amanhã" } };
  cp.resolve.length = 0; cp.marks.length = 0; cp.rpcCalls.length = 0; cp.rider.length = 0; cp.rpcError = false;
  calls.send.length = 0; calls.abandon.length = 0; calls.register.length = 0; calls.actedAs.length = 0; calls.transcribe.length = 0; calls.mint = 0;
});

describe("who is answered", () => {
  it("an unknown, unconsented or ambiguous number gets no answer and nothing is run", async () => {
    for (const identify of [{ ok: false, reason: "unknown" }, { ok: false, reason: "ambiguous" }, null]) {
      w.identify = identify;
      expect((await run(msg())).replies).toEqual([]);
    }
    expect(calls.mint).toBe(0);
    expect(calls.send).toHaveLength(0);
    expect(calls.register).toHaveLength(0);
  });
  it("the first message of a registered member can be anything: it is answered, with no trigger word and no open session", async () => {
    const r = await run(msg({ text: "quero um carro amanhã às 8h" }));
    expect(calls.register[0]).toMatchObject({ p_handled: true, p_user: "u1" });
    expect(calls.send[0]!.form).toMatchObject({ phase: "message", message: "quero um carro amanhã às 8h" });
    expect(texts(r)).toEqual(["Para quando?"]);
  });
  it("the trigger word starts a session: it is removed from what the assistant reads", async () => {
    const r = await run(msg({ text: "Fleet, quero um carro amanhã às 8h" }));
    expect(calls.register[0]).toMatchObject({ p_handled: true });
    expect(calls.send[0]!.form).toMatchObject({ phase: "message", message: "quero um carro amanhã às 8h" });
    expect(texts(r)).toEqual(["Para quando?"]);
    expect(calls.actedAs).toEqual(["u1"]);
  });
  it("inside an open session any text is handled, with no trigger", async () => {
    w.open = true;
    await run(msg({ text: "amanhã às 8h" }));
    expect(calls.send[0]!.form.message).toBe("amanhã às 8h");
  });
  it("a repeated delivery of the same message does nothing", async () => {
    w.registerNew = false;
    expect((await run(msg())).replies).toEqual([]);
    expect(calls.send).toHaveLength(0);
  });
  it("a greeting or just the trigger word shows the help without calling the assistant", async () => {
    for (const text of ["fleet", "fleet oi", "fleet ajuda"]) {
      const r = await run(msg({ text }));
      expect(texts(r)[0]).toContain("assistente do *FleetMind*");
    }
    expect(calls.send).toHaveLength(0);
    expect(calls.mint).toBe(0);
  });
  it("when the sign-in for the member cannot be made nothing runs and the person is told", async () => {
    w.mint = null;
    expect(texts(await run(msg()))).toEqual([TEXTS.couldNotEnter]);
    expect(calls.send).toHaveLength(0);
  });
  it("an assistant failure becomes a plain message, never an error", async () => {
    w.next = new Error("boom");
    expect(texts(await run(msg()))).toEqual([TEXTS.generic]);
  });
});

describe("voice notes", () => {
  const audio = { kind: "audio" as const, audioBase64: "QUJD", mimeType: "audio/ogg", text: undefined };
  it("a voice note as the very first message is transcribed and answered", async () => {
    const r = await run(msg(audio));
    expect(calls.transcribe).toEqual(["QUJD"]);
    expect(texts(r)).toEqual(["🎙️ Entendi: “fleet quero um carro amanhã”", "Para quando?"]);
  });
  it("inside an open session it is transcribed, the transcription is shown and the assistant gets the text", async () => {
    w.open = true;
    const r = await run(msg(audio));
    expect(calls.transcribe).toEqual(["QUJD"]);
    expect(texts(r)).toEqual(["🎙️ Entendi: “fleet quero um carro amanhã”", "Para quando?"]);
    expect(calls.send[0]!.form.message).toBe("quero um carro amanhã");
  });
  it("tells the person plainly when the audio cannot be used", async () => {
    w.open = true;
    for (const [reason, text] of [["not_configured", TEXTS.audioOff], ["too_large", TEXTS.audioTooLong], ["failed", TEXTS.audioFailed], ["empty", TEXTS.audioFailed]] as const) {
      w.transcribe = { ok: false, reason };
      expect(texts(await run(msg({ ...audio, messageId: reason })))).toEqual([text]);
    }
    expect(calls.send).toHaveLength(0);
  });
  it("other media (image, document) gets a polite note", async () => {
    expect(texts(await run(msg({ kind: "other", text: undefined })))).toEqual([TEXTS.onlyTextAudio]);
  });
});

describe("confirmation and choices", () => {
  const summary = (extra: Partial<NonNullable<ChatState["pendingAction"]>> = {}): ChatState => ({
    status: "needs_confirmation", conversationId: "c1",
    messages: [{ role: "assistant", content: "Reservar o Haval para amanhã?" }],
    pendingAction: { intent: "CREATE_RESERVATION", slots: {}, summary: "Reservar o Haval para amanhã?", ...extra },
  });
  beforeEach(() => { w.open = true; });

  it("SIM confirms the pending action (phase confirm), a button tap does the same", async () => {
    w.state = summary();
    for (const m of [msg({ text: "Sim" }), msg({ kind: "button", buttonId: CHAT_BUTTON.confirm, text: undefined, messageId: "b1" })]) {
      calls.send.length = 0;
      await run(m);
      expect(calls.send[0]!.form).toMatchObject({ phase: "confirm", conversationId: "c1" });
    }
  });
  it("NÃO / cancelar drops the pending action and answers without calling the assistant", async () => {
    w.state = summary();
    for (const text of ["não", "Cancelar", "nao."]) {
      calls.abandon.length = 0;
      expect(texts(await run(msg({ text, messageId: text })))).toEqual([TEXTS.cancelled]);
      expect(calls.abandon).toEqual(["c1"]);
    }
    expect(calls.send).toHaveLength(0);
  });
  it("a bare number picks a vehicle option (select_vehicle) or a carpool option (select_option)", async () => {
    // the numbers count the OTHER vehicles: v1 is the one on offer, so "1" is v2 and "2" is v3
    w.state = summary({ slots: { preferredVehicleId: "v1" }, vehicleOptions: [{ vehicleId: "v1", plate: "AAA1A11", vehicleName: "Haval" }, { vehicleId: "v2", plate: "BBB2B22", vehicleName: "Ora" }, { vehicleId: "v3", plate: "CCC3C33", vehicleName: "Pick-up" }] });
    await run(msg({ text: "2" }));
    expect(calls.send[0]!.form).toMatchObject({ phase: "select_vehicle", vehicleId: "v3" });
    calls.send.length = 0;
    w.state = summary({ options: [{ id: "o1", label: "Carona com Maria" }, { id: "vehicle", label: "Usar um veículo" }] });
    await run(msg({ text: "1", messageId: "n2" }));
    expect(calls.send[0]!.form).toMatchObject({ phase: "select_option", optionId: "o1" });
  });
  it("an out-of-range number, or SIM when a choice is still needed, asks again without calling the assistant", async () => {
    w.state = summary({ options: [{ id: "o1", label: "Carona com Maria" }] });
    expect(texts(await run(msg({ text: "7" })))).toEqual([TEXTS.badOption]);
    expect(texts(await run(msg({ text: "sim", messageId: "m2" })))).toEqual([TEXTS.chooseNumber]);
    expect(calls.send).toHaveLength(0);
  });
  it("any other text while a confirmation is pending goes to the assistant as a message (the person may be changing the request)", async () => {
    w.state = summary();
    await run(msg({ text: "na verdade às 9h" }));
    expect(calls.send[0]!.form).toMatchObject({ phase: "message", message: "na verdade às 9h" });
  });
  it("a conversation left for more than 15 minutes is not resumed: a late SIM never confirms it, and old trip data never leaks into a new request: a late SIM never confirms it", async () => {
    w.state = summary();
    w.updatedAt = "2026-10-28T19:00:00Z";
    await run(msg({ text: "sim" }));
    expect(calls.abandon).toEqual(["c1"]);
    expect(calls.send[0]!.prev).toEqual({ status: "idle", messages: [] });
    expect(calls.send[0]!.form.phase).toBe("message");
  });
  it("a button of another message or a number with nothing pending is not a command", async () => {
    w.state = idle;
    expect((await run(msg({ kind: "button", buttonId: "approve:abc", text: undefined }))).replies).toEqual([]);
    await run(msg({ text: "2", messageId: "n9" }));
    expect(calls.send[0]!.form).toMatchObject({ phase: "message", message: "2" });
  });
});

describe("rendering the assistant's answer for WhatsApp", () => {
  const url = "https://fleet.example.invalid/";
  it("only the assistant's new messages, with absolute links", () => {
    const r = renderState({ status: "idle", messages: [{ role: "user", content: "a" }, { role: "assistant", content: "velho" }, { role: "user", content: "b" }, { role: "assistant", content: "Sem veículo livre.", link: { href: "/trips/new?x=1", label: "Abrir" } }] }, url);
    expect(r).toEqual([{ type: "text", text: "Sem veículo livre.\nAbrir: https://fleet.example.invalid/trips/new?x=1" }]);
  });
  it("a confirmation card gets Confirmar / Cancelar buttons and the SIM / NÃO hint", () => {
    const r = renderState({ status: "needs_confirmation", messages: [{ role: "assistant", content: "Reservar?" }], pendingAction: { intent: "CREATE_RESERVATION", slots: {}, summary: "Reservar?" } }, url);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ type: "buttons", buttons: [{ id: "chat:confirm", title: "Confirmar" }, { id: "chat:cancel", title: "Cancelar" }] });
    expect((r[0] as { text: string }).text).toContain("SIM");
  });
  it("carpool options are a numbered list (no buttons); alternative vehicles are listed with their plates", () => {
    const opts = renderState({ status: "needs_confirmation", messages: [{ role: "assistant", content: "Achei caronas:" }], pendingAction: { intent: "REQUEST_CARPOOL", slots: {}, summary: "x", options: [{ id: "a", label: "Maria, 08:00" }, { id: "vehicle", label: "Usar um veículo" }] } }, url);
    expect(opts).toEqual([{ type: "text", text: `Achei caronas:\n\n*1.* Maria, 08:00\n*2.* Usar um veículo\n\n${TEXTS.chooseNumber}` }]);
    const veh = renderState({ status: "needs_confirmation", messages: [{ role: "assistant", content: "Haval H6" }], pendingAction: { intent: "CREATE_RESERVATION", slots: { preferredVehicleId: "1" }, summary: "x", vehicleOptions: [{ vehicleId: "1", plate: "AAA1A11", vehicleName: "Haval" }, { vehicleId: "2", plate: "BBB2B22", vehicleName: "Ora" }] } }, url);
    // first the card (Confirmar / Cancelar), then ONLY the other vehicles as buttons: the one on offer is not listed again
    expect(veh).toHaveLength(2);
    expect(veh[0]).toMatchObject({ type: "buttons", buttons: [{ id: CHAT_BUTTON.confirm }, { id: CHAT_BUTTON.cancel }] });
    expect(veh[1]).toMatchObject({ type: "buttons", buttons: [{ id: "chat:veh:2" }] });
    expect((veh[1] as { text: string }).text).toContain("*1.* Ora (BBB2B22)");
    expect((veh[1] as { text: string }).text).not.toContain("Haval");
  });
  it("never exceeds the WhatsApp message size and never returns an empty reply", () => {
    const long = renderState({ status: "idle", messages: [{ role: "assistant", content: "x".repeat(9000) }] }, url);
    expect((long[0] as { text: string }).text.length).toBeLessThanOrEqual(3800);
    expect(renderState({ status: "idle", messages: [] }, url)).toEqual([{ type: "text", text: TEXTS.generic }]);
  });
});

describe("one number registered on several profiles", () => {
  const CANDS = [
    { user_id: "a1", organization_id: "o1", full_name: "Alexandre Kondo", role: "administrator", email: "a@example.invalid" },
    { user_id: "a2", organization_id: "o1", full_name: "Alexandre Massahiro Kondo", role: "employee", email: "b@example.invalid" },
  ];
  beforeEach(() => { w.identify = { ok: false, reason: "ambiguous", phone_norm: "5511982593096", candidates: CANDS }; });

  it("asks which profile to speak as, listing name and role, and remembers that it asked", async () => {
    const r = await run(msg({ text: "oi, quero um carro" }));
    expect(texts(r)[0]).toContain(TEXTS.pickIntro);
    expect(texts(r)[0]).toContain("*1.* Alexandre Kondo — Administrador");
    expect(texts(r)[0]).toContain("*2.* Alexandre Massahiro Kondo — Colaborador");
    expect(w.pickWrites).toEqual([{ phone: "5511982593096", user: null, pending: "oi, quero um carro" }]);
    expect(calls.send).toHaveLength(0);
    expect(calls.mint).toBe(0);
  });
  it("the number answered after the question picks that profile, and the assistant is not run on the number itself", async () => {
    w.pick = { picked_user_id: null, asked: true };
    const r = await run(msg({ text: "2" }));
    expect(w.pickWrites).toEqual([{ phone: "5511982593096", user: "a2" }]);
    expect(texts(r)[0]).toContain("Alexandre Massahiro Kondo");
    expect(calls.send).toHaveLength(0);
  });
  it("an out-of-range number is refused with the list again", async () => {
    w.pick = { picked_user_id: null, asked: true };
    expect(texts(await run(msg({ text: "7" })))[0]).toContain(TEXTS.pickBad);
    expect(w.pickWrites).toEqual([]);
  });
  it("with a profile picked, the assistant runs as THAT profile", async () => {
    w.pick = { picked_user_id: "a2", asked: true };
    await run(msg({ text: "quero um carro amanhã" }));
    expect(calls.actedAs).toEqual(["a2"]);
    expect(calls.send[0]!.form.message).toBe("quero um carro amanhã");
  });
  it("'trocar perfil' asks again", async () => {
    w.pick = { picked_user_id: "a2", asked: true };
    const r = await run(msg({ text: "trocar perfil" }));
    expect(texts(r)[0]).toContain(TEXTS.pickIntro);
    expect(calls.send).toHaveLength(0);
  });
  it("a picked profile that is no longer registered with the number is never used", async () => {
    w.pick = { picked_user_id: "someone-else", asked: false };
    const r = await run(msg({ text: "quero um carro" }));
    expect(texts(r)[0]).toContain(TEXTS.pickIntro);
    expect(calls.send).toHaveLength(0);
  });
  it("the same webhook delivered twice asks only once", async () => {
    w.registerNew = false;
    expect((await run(msg({ text: "oi" }))).replies).toEqual([]);
  });
});

describe("choosing an option inside a sentence (spoken or written)", () => {
  it("understands the phrases people actually say", () => {
    for (const [text, n] of [["Reserve a opção 6 pra mim.", 6], ["quero o número dois", 2], ["pode ser o terceiro", 3], ["escolho a 4", 4], ["opção 1", 1], ["fico com o veículo 5", 5]] as const) expect(parseChoice(text, 7), text).toBe(n);
  });
  it("never mistakes a time, a date, a quantity or an out-of-range number for a choice", () => {
    for (const text of ["quero sair às 9h", "volto dia 5/12", "preciso de 4 vagas", "opção 9", "bom dia", "quero um carro amanhã"]) expect(parseChoice(text, 7), text).toBeNull();
  });
  const seven = (preferred = "v1") => ({ status: "needs_confirmation", conversationId: "c1", messages: [{ role: "assistant", content: "Vou reservar" }], pendingAction: { intent: "CREATE_RESERVATION", slots: { preferredVehicleId: preferred }, summary: "Vou reservar", vehicleOptions: [1, 2, 3, 4, 5, 6, 7].map((i) => ({ vehicleId: `v${i}`, plate: `P${i}`, vehicleName: `Carro ${i}`, locationName: i % 2 ? "Portaria P1" : "Carregador" })) } }) as ChatState;
  it("a vehicle chosen by voice (\"reserve a opção 6\") selects the 6th of the OTHER vehicles", async () => {
    w.state = seven();
    w.updatedAt = "2026-10-28T19:59:00Z";
    await run(msg({ text: "Reserve a opção 6 pra mim." }));
    expect(calls.send[0]!.form).toMatchObject({ phase: "select_vehicle", vehicleId: "v7" });
  });
  it("tapping a vehicle button selects that vehicle; a tap with nothing pending is answered, never sent to the assistant as a message", async () => {
    w.state = seven();
    await run(msg({ kind: "button", buttonId: "chat:veh:v4", text: undefined }));
    expect(calls.send[0]!.form).toMatchObject({ phase: "select_vehicle", vehicleId: "v4" });
    calls.send.length = 0;
    expect(texts(await run(msg({ kind: "button", buttonId: "chat:veh:zzz", text: undefined, messageId: "b2" })))).toEqual([TEXTS.badOption]);
    w.state = idle;
    expect(texts(await run(msg({ kind: "button", buttonId: "chat:veh:v4", text: undefined, messageId: "b3" })))).toEqual([TEXTS.staleChoice]);
    expect(calls.send).toHaveLength(0);
  });
  it("shows the offered vehicle once (in the card) and at most 3 vehicle buttons; the rest are chosen by number", () => {
    const r = renderState(seven("v3"), "https://x.invalid");
    expect(r).toHaveLength(2);
    const pick = r[1] as { text: string; buttons: { id: string; title: string }[] };
    expect(pick.buttons.map((b) => b.id)).toEqual(["chat:veh:v1", "chat:veh:v2", "chat:veh:v4"]);
    expect(pick.buttons.every((b) => b.title.length <= 20)).toBe(true);
    expect(pick.text).not.toContain("Carro 3");
    expect(pick.text).toContain("*6.* Carro 7");
    expect(pick.text).toContain("Para os demais, responda com o número");
  });
});

describe("one number registered on several profiles", () => {
  const CANDS = [
    { user_id: "a1", organization_id: "o1", full_name: "Alexandre Kondo", role: "administrator", email: "a@example.invalid" },
    { user_id: "a2", organization_id: "o1", full_name: "Alexandre Massahiro Kondo", role: "employee", email: "b@example.invalid" },
  ];
  beforeEach(() => { w.identify = { ok: false, reason: "ambiguous", phone_norm: "5511982593096", candidates: CANDS }; });

  it("asks which profile to speak as, listing name and role, and remembers that it asked", async () => {
    const r = await run(msg({ text: "oi, quero um carro" }));
    expect(texts(r)[0]).toContain(TEXTS.pickIntro);
    expect(texts(r)[0]).toContain("*1.* Alexandre Kondo — Administrador");
    expect(texts(r)[0]).toContain("*2.* Alexandre Massahiro Kondo — Colaborador");
    expect(w.pickWrites).toEqual([{ phone: "5511982593096", user: null, pending: "oi, quero um carro" }]);
    expect(calls.send).toHaveLength(0);
    expect(calls.mint).toBe(0);
  });
  it("the number answered after the question picks that profile, and the assistant is not run on the number itself", async () => {
    w.pick = { picked_user_id: null, asked: true };
    const r = await run(msg({ text: "2" }));
    expect(w.pickWrites).toEqual([{ phone: "5511982593096", user: "a2" }]);
    expect(texts(r)[0]).toContain("Alexandre Massahiro Kondo");
    expect(calls.send).toHaveLength(0);
  });
  it("an out-of-range number is refused with the list again", async () => {
    w.pick = { picked_user_id: null, asked: true };
    expect(texts(await run(msg({ text: "7" })))[0]).toContain(TEXTS.pickBad);
    expect(w.pickWrites).toEqual([]);
  });
  it("with a profile picked, the assistant runs as THAT profile", async () => {
    w.pick = { picked_user_id: "a2", asked: true };
    await run(msg({ text: "quero um carro amanhã" }));
    expect(calls.actedAs).toEqual(["a2"]);
    expect(calls.send[0]!.form.message).toBe("quero um carro amanhã");
  });
  it("'trocar perfil' asks again", async () => {
    w.pick = { picked_user_id: "a2", asked: true };
    const r = await run(msg({ text: "trocar perfil" }));
    expect(texts(r)[0]).toContain(TEXTS.pickIntro);
    expect(calls.send).toHaveLength(0);
  });
  it("a picked profile that is no longer registered with the number is never used", async () => {
    w.pick = { picked_user_id: "someone-else", asked: false };
    const r = await run(msg({ text: "quero um carro" }));
    expect(texts(r)[0]).toContain(TEXTS.pickIntro);
    expect(calls.send).toHaveLength(0);
  });
  it("the same webhook delivered twice asks only once", async () => {
    w.registerNew = false;
    expect((await run(msg({ text: "oi" }))).replies).toEqual([]);
  });
});

describe("the host answers a carpool request on WhatsApp", () => {
  const TOKEN = "b".repeat(64);
  const RESOLVED = { ok: true, request_id: "req-1", host_id: "h1", host_email: "host@example.invalid", rider_name: "Maria Silva" };
  const hostClient = () => ({ rpc: async (name: string, args: Record<string, unknown>) => { cp.rpcCalls.push({ name, args }); return { data: null, error: cp.rpcError ? { message: "x" } : null }; } }) as unknown as TypedSupabaseClient;
  const hostDeps = () => deps({ mintClient: async () => hostClient(), notifyRider: async (id, reason) => { cp.rider.push({ id, reason }); } });
  const tap = (kind: "yes" | "no", over: Partial<InboundMessage> = {}) => msg({ kind: "button", buttonId: `cp:${kind}:${TOKEN}`, text: undefined, from: "5511982593096", messageId: `t-${kind}`, ...over });

  it("Aceitar: accepts as the host through the normal rule, closes the token, tells the rider and answers the host", async () => {
    w.cpResolve = RESOLVED;
    const r = await run(tap("yes"), hostDeps());
    expect(cp.resolve[0]).toMatchObject({ p_token: TOKEN, p_from_phone: "5511982593096" });
    expect(cp.rpcCalls).toEqual([{ name: "accept_carpool_ride_request", args: { p_request_id: "req-1" } }]);
    expect(cp.marks).toEqual([{ status: "done", reason: null }]);
    expect(cp.rider).toEqual([{ id: "req-1", reason: undefined }]);
    expect(texts(r)[0]).toContain("aceitou a carona de *Maria Silva*");
    expect(calls.send).toHaveLength(0);
  });
  it("Recusar: nothing is rejected yet; the host is asked for the justification", async () => {
    w.cpResolve = RESOLVED;
    const r = await run(tap("no"), hostDeps());
    expect(cp.rpcCalls).toHaveLength(0);
    expect(cp.marks).toEqual([{ status: "awaiting_reason", reason: null }]);
    expect(texts(r)[0]).toContain("me diga em uma mensagem (texto ou áudio) o motivo");
    expect(cp.rider).toHaveLength(0);
  });
  it("the next text of that number is the justification: rejects with it, tells the rider with it", async () => {
    w.cpPending = { ok: true, request_id: "req-1", host_id: "h1", host_email: "host@example.invalid", rider_name: "Maria Silva" };
    const r = await run(msg({ from: "5511982593096", text: "Vou   sair mais cedo\ne o carro já estará cheio", messageId: "r1" }), hostDeps());
    expect(cp.rpcCalls).toEqual([{ name: "reject_carpool_ride_request", args: { p_request_id: "req-1", p_reason: "Vou sair mais cedo e o carro já estará cheio" } }]);
    expect(cp.marks).toEqual([{ status: "done", reason: "Vou sair mais cedo e o carro já estará cheio" }]);
    expect(cp.rider).toEqual([{ id: "req-1", reason: "Vou sair mais cedo e o carro já estará cheio" }]);
    expect(texts(r)[0]).toContain("avisei *Maria Silva* com o seu motivo");
    expect(calls.send).toHaveLength(0); // it never reaches the reservation assistant
  });
  it("the justification can be a voice note: it is transcribed and shown", async () => {
    w.cpPending = { ok: true, request_id: "req-1", host_id: "h1", host_email: "host@example.invalid", rider_name: "Maria Silva" };
    w.transcribe = { ok: true, text: "Estou sem espaço no carro" };
    const r = await run(msg({ kind: "audio", text: undefined, audioBase64: "QUJD", mimeType: "audio/ogg", from: "5511982593096", messageId: "r2" }), hostDeps());
    expect(cp.rpcCalls[0]).toMatchObject({ name: "reject_carpool_ride_request", args: { p_reason: "Estou sem espaço no carro" } });
    expect(texts(r)[0]).toContain("Entendi: “Estou sem espaço no carro”");
  });
  it("an audio that cannot be understood keeps the question open", async () => {
    w.cpPending = { ok: true, request_id: "req-1", host_id: "h1", host_email: "host@example.invalid", rider_name: "Maria Silva" };
    w.transcribe = { ok: false, reason: "failed" };
    const r = await run(msg({ kind: "audio", text: undefined, audioBase64: "QUJD", from: "5511982593096", messageId: "r3" }), hostDeps());
    expect(texts(r)).toEqual([TEXTS.cpReasonAgain]);
    expect(cp.rpcCalls).toHaveLength(0);
    expect(cp.marks).toHaveLength(0);
  });
  it("a tap from another number, an unknown token or an answered request does nothing / is explained, and never acts", async () => {
    for (const reason of ["phone_mismatch", "invalid"]) {
      w.cpResolve = { ok: false, reason };
      expect((await run(tap("yes", { messageId: `m-${reason}` }), hostDeps())).replies).toEqual([]);
    }
    for (const reason of ["already_done", "expired", "not_pending"]) {
      w.cpResolve = { ok: false, reason };
      expect(texts(await run(tap("yes", { messageId: `m-${reason}` }), hostDeps()))).toEqual([TEXTS.cpGone]);
    }
    expect(cp.rpcCalls).toHaveLength(0);
    expect(cp.marks).toHaveLength(0);
  });
  it("the same tap delivered twice acts once", async () => {
    w.cpResolve = RESOLVED;
    w.registerNew = false;
    expect((await run(tap("yes"), hostDeps())).replies).toEqual([]);
    expect(cp.rpcCalls).toHaveLength(0);
  });
  it("when the database refuses (no seat left), the host is told and nobody is notified", async () => {
    w.cpResolve = RESOLVED;
    cp.rpcError = true;
    expect(texts(await run(tap("yes"), hostDeps()))).toEqual([TEXTS.cpFailed]);
    expect(cp.marks).toHaveLength(0);
    expect(cp.rider).toHaveLength(0);
  });
  it("a normal message from a number with no refusal waiting goes to the assistant as before", async () => {
    await run(msg({ text: "quero um carro amanhã" }));
    expect(calls.send).toHaveLength(1);
  });
});

describe("the request said before choosing the profile is not asked again", () => {
  const CANDS = [
    { user_id: "a1", organization_id: "o1", full_name: "Alexandre Kondo", role: "administrator", email: "a@example.invalid" },
    { user_id: "a2", organization_id: "o1", full_name: "Alexandre Massahiro Kondo", role: "employee", email: "b@example.invalid" },
  ];
  beforeEach(() => { w.identify = { ok: false, reason: "ambiguous", phone_norm: "5511982593096", candidates: CANDS }; });

  it("a voice note as the first message is transcribed, kept, and the person is asked only which profile", async () => {
    w.transcribe = { ok: true, text: "Quero reservar um carro amanhã às nove para a EZ Tower" };
    const r = await run(msg({ kind: "audio", text: undefined, audioBase64: "QUJD", mimeType: "audio/ogg" }));
    expect(texts(r)[0]).toBe("🎙️ Entendi: “Quero reservar um carro amanhã às nove para a EZ Tower”");
    expect(texts(r)[1]).toContain(TEXTS.pickIntro);
    expect(texts(r)[1]).toContain(TEXTS.pickKeep);
    expect(w.pickWrites).toEqual([{ phone: "5511982593096", user: null, pending: "Quero reservar um carro amanhã às nove para a EZ Tower" }]);
    expect(calls.send).toHaveLength(0);
  });
  it("after the choice the assistant continues with the kept request, as the chosen profile", async () => {
    w.pick = { picked_user_id: null, asked: true, pending_text: "Quero reservar um carro amanhã às nove para a EZ Tower" };
    const r = await run(msg({ text: "2", messageId: "pick-1" }));
    expect(w.pickWrites).toEqual([{ phone: "5511982593096", user: "a2" }]);
    expect(calls.actedAs).toEqual(["a2"]);
    expect(calls.send[0]!.form).toMatchObject({ phase: "message", message: "Quero reservar um carro amanhã às nove para a EZ Tower" });
    expect(texts(r)[0]).toContain("Continuando com o seu pedido: “Quero reservar um carro amanhã às nove para a EZ Tower”");
    expect(texts(r)[1]).toBe("Para quando?");
  });
  it("a bare number, a greeting or nothing useful is not kept; the old short confirmation stays", async () => {
    await run(msg({ text: "oi", messageId: "g1" }));
    expect(w.pickWrites[0]).toEqual({ phone: "5511982593096", user: null });
    w.pickWrites.length = 0;
    w.pick = { picked_user_id: null, asked: true, pending_text: null };
    const r = await run(msg({ text: "1", messageId: "g2" }));
    expect(texts(r)[0]).toContain(TEXTS.pickRetry);
    expect(calls.send).toHaveLength(0);
  });
  it("a voice note that cannot be understood is not kept (the person will say it again after choosing)", async () => {
    w.transcribe = { ok: false, reason: "failed" };
    const r = await run(msg({ kind: "audio", text: undefined, audioBase64: "QUJD", messageId: "a-bad" }));
    expect(texts(r)).toHaveLength(1);
    expect(texts(r)[0]).toContain(TEXTS.pickIntro);
    expect(texts(r)[0]).not.toContain(TEXTS.pickKeep);
  });
});

describe("choosing the place of a name that fits several buildings (WhatsApp)", () => {
  const OPT = [{ id: "11111111-1111-4111-8111-111111111111", label: "EZ TOWERS - Torre A - Av. Dr. Chucri Zaidan, 1649" }, { id: "22222222-2222-4222-8222-222222222222", label: "Edifício EZ Towers - Bloco B - Rua Arquiteto Olavo Redig de Campos, 105" }];
  const pendingPlaces = (): ChatState => ({ status: "needs_confirmation", conversationId: "c1", messages: [{ role: "assistant", content: "Encontrei mais de um local" }], pendingAction: { intent: "CREATE_RESERVATION", slots: { placeChoices: JSON.stringify(OPT) }, summary: "Encontrei mais de um local", options: OPT } });

  it("the options come as buttons with the full addresses listed in the text", () => {
    const [r] = renderState(pendingPlaces(), "https://x.invalid");
    expect(r).toMatchObject({ type: "buttons", buttons: [{ id: `chat:opt:${OPT[0]!.id}` }, { id: `chat:opt:${OPT[1]!.id}` }] });
    expect((r as { text: string }).text).toContain("*2.* Edifício EZ Towers - Bloco B");
    expect((r as { buttons: { title: string }[] }).buttons.every((b) => b.title.length <= 20)).toBe(true);
  });
  it("a tap selects that option; a tap on an option that is not offered is refused; with nothing pending it is answered as stale", async () => {
    w.state = pendingPlaces();
    await run(msg({ kind: "button", buttonId: `chat:opt:${OPT[1]!.id}`, text: undefined, messageId: "o1" }));
    expect(calls.send[0]!.form).toMatchObject({ phase: "select_option", optionId: OPT[1]!.id });
    calls.send.length = 0;
    expect(texts(await run(msg({ kind: "button", buttonId: "chat:opt:nope", text: undefined, messageId: "o2" })))).toEqual([TEXTS.badOption]);
    w.state = idle;
    expect(texts(await run(msg({ kind: "button", buttonId: `chat:opt:${OPT[0]!.id}`, text: undefined, messageId: "o3" })))).toEqual([TEXTS.staleChoice]);
    expect(calls.send).toHaveLength(0);
  });
  it("the number (typed or spoken) picks the same option", async () => {
    w.state = pendingPlaces();
    await run(msg({ text: "2", messageId: "o4" }));
    expect(calls.send[0]!.form).toMatchObject({ phase: "select_option", optionId: OPT[1]!.id });
  });
});

describe("route map picture", () => {
  const proposal = (slots: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ status: "needs_confirmation", conversationId: "c1", messages: [{ role: "assistant", content: "Vou reservar" }], pendingAction: { intent: "CREATE_RESERVATION", slots, summary: "Vou reservar", ...extra } }) as ChatState;
  const map = { imageBase64: "AAAA", caption: "Rota: A → B\n10 km · 20 min" };

  it("the vehicle proposal is sent with the map first, then the card", async () => {
    w.next = proposal({ origin: "Av. Paulista 1000", destination: "Aeroporto de Guarulhos" });
    const seen: string[][] = [];
    const r = await run(msg(), deps({ routeMap: async (o, d) => { seen.push([o, d]); return map; } }));
    expect(seen).toEqual([["Av. Paulista 1000", "Aeroporto de Guarulhos"]]);
    expect(r.replies.map((x) => x.type)).toEqual(["image", "buttons"]);
    expect(r.replies[0]).toMatchObject({ type: "image", imageBase64: "AAAA", text: "Rota: A → B\n10 km · 20 min" });
  });
  it("no map when it is unavailable or throws: the card still goes", async () => {
    w.next = proposal({ origin: "A", destination: "B" });
    for (const routeMap of [async () => null, async () => { throw new Error("boom"); }]) {
      const r = await run(msg(), deps({ routeMap }));
      expect(r.replies.map((x) => x.type)).toEqual(["buttons"]);
    }
  });
  it("no map without both places, nor on a plain answer", async () => {
    const routeMap = vi.fn(async () => map);
    w.next = proposal({ origin: "A" });
    expect((await run(msg(), deps({ routeMap }))).replies.map((x) => x.type)).toEqual(["buttons"]);
    w.next = reply("Para quando?");
    expect((await run(msg(), deps({ routeMap }))).replies.map((x) => x.type)).toEqual(["text"]);
    expect(routeMap).not.toHaveBeenCalled();
  });
});
