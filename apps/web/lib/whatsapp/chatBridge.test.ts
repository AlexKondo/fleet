import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TypedSupabaseClient } from "@fleet/supabase-client";
import type { ChatState } from "@/app/chat/actions";
import { runAsUser, getActingContext } from "@/lib/auth/actingUser";
import { CHAT_BUTTON, handleInboundWhatsApp, renderState, TEXTS, type BridgeDeps, type InboundMessage } from "./chatBridge";

const USER = { ok: true, user_id: "u1", organization_id: "o1", email: "ana@example.invalid", full_name: "Ana" };
const CLIENT = { tag: "client" } as unknown as TypedSupabaseClient;
const idle: ChatState = { status: "idle", messages: [] };
const reply = (content: string, extra: Partial<ChatState> = {}): ChatState => ({ status: "idle", conversationId: "c1", messages: [{ role: "user", content: "x" }, { role: "assistant", content }], ...extra });

interface World { identify: unknown; open: boolean; registerNew: boolean; state: ChatState; updatedAt: string | null; mint: TypedSupabaseClient | null; next: ChatState | Error; transcribe: unknown }
let w: World;
const calls = { send: [] as { prev: ChatState; form: Record<string, string> }[], abandon: [] as string[], register: [] as Record<string, unknown>[], actedAs: [] as (string | undefined)[], transcribe: [] as string[], mint: 0 };

function deps(over: Partial<BridgeDeps> = {}): BridgeDeps {
  return {
    rpc: async (name, args) => {
      if (name === "fm_whatsapp_identify") return { data: w.identify, error: null };
      if (name === "fm_whatsapp_session_open") return { data: w.open, error: null };
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
  w = { identify: USER, open: false, registerNew: true, state: idle, updatedAt: null, mint: CLIENT, next: reply("Para quando?"), transcribe: { ok: true, text: "fleet quero um carro amanhã" } };
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
  it("a registered member writing without the trigger word and without an open session is ignored (and recorded as ignored)", async () => {
    const r = await run(msg({ text: "bom dia, tudo bem? me liga depois" }));
    expect(r.replies).toEqual([]);
    expect(calls.register[0]).toMatchObject({ p_handled: false, p_user: "u1" });
    expect(calls.send).toHaveLength(0);
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
  it("outside an open session a voice note is ignored and NOT sent for transcription (privacy)", async () => {
    expect((await run(msg(audio))).replies).toEqual([]);
    expect(calls.transcribe).toHaveLength(0);
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
  it("other media (image, document) inside a session gets a polite note; outside, nothing", async () => {
    expect((await run(msg({ kind: "other", text: undefined }))).replies).toEqual([]);
    w.open = true;
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
    w.state = summary({ vehicleOptions: [{ vehicleId: "v1", plate: "AAA1A11", vehicleName: "Haval" }, { vehicleId: "v2", plate: "BBB2B22", vehicleName: "Ora" }] });
    await run(msg({ text: "2" }));
    expect(calls.send[0]!.form).toMatchObject({ phase: "select_vehicle", vehicleId: "v2" });
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
  it("a confirmation left hanging for more than 30 minutes is dropped: a late SIM never confirms it", async () => {
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
    const veh = renderState({ status: "needs_confirmation", messages: [{ role: "assistant", content: "Haval H6" }], pendingAction: { intent: "CREATE_RESERVATION", slots: {}, summary: "x", vehicleOptions: [{ vehicleId: "1", plate: "AAA1A11", vehicleName: "Haval" }, { vehicleId: "2", plate: "BBB2B22", vehicleName: "Ora" }] } }, url);
    expect((veh[0] as { text: string }).text).toContain("*2.* Ora (BBB2B22)");
    expect(veh[0]!.type).toBe("buttons");
  });
  it("never exceeds the WhatsApp message size and never returns an empty reply", () => {
    const long = renderState({ status: "idle", messages: [{ role: "assistant", content: "x".repeat(9000) }] }, url);
    expect((long[0] as { text: string }).text.length).toBeLessThanOrEqual(3800);
    expect(renderState({ status: "idle", messages: [] }, url)).toEqual([{ type: "text", text: TEXTS.generic }]);
  });
});
