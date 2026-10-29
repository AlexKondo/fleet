import type { TypedSupabaseClient } from "@fleet/supabase-client";
import type { ChatState } from "@/app/chat/actions";
import type { ActingContext } from "@/lib/auth/actingUser";
import type { TranscribeResult } from "./transcribe";
import { parseChoice, vehicleAlternatives } from "@/lib/chat/vehicleChoice";

export { parseChoice };

/**
 * Reserving a vehicle by WhatsApp: turns an inbound message (text, voice note or button tap) from a member identified by their registered
 * phone into one step of the SAME assistant the web chat uses (sendChatMessage), acting as that member, and renders the answer as WhatsApp
 * messages (text, numbered options, Confirmar / Cancelar buttons). The reservation still goes through the normal approval.
 *
 * Unknown numbers get NO answer (the line is a WhatsApp number); any message from a registered number is answered, so the first message can
 * be anything. When one number belongs to several profiles, the assistant asks which one the person is speaking as and remembers it.
 */
/** A person registered with the sender's number (the same number can belong to several profiles). */
interface Candidate {
  user_id: string;
  organization_id: string | null;
  full_name: string | null;
  role: string | null;
  email: string;
}

export interface InboundMessage {
  from: string;
  messageId: string | null;
  kind: "text" | "audio" | "button" | "other";
  text?: string;
  buttonId?: string;
  audioBase64?: string;
  mimeType?: string;
}

export type Reply =
  | { type: "text"; text: string }
  | { type: "buttons"; text: string; buttons: { id: string; title: string }[] }
  /** The route map picture (PNG, base64 without the data: prefix) with a caption; n8n sends it with Evolution's /send/media. */
  | { type: "image"; text: string; imageBase64: string };

type Rpc = (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;

export interface BridgeDeps {
  /** service-role RPC caller */
  rpc: Rpc;
  mintClient: (email: string, userId: string) => Promise<TypedSupabaseClient | null>;
  runAsUser: <T>(ctx: ActingContext, fn: () => Promise<T>) => Promise<T>;
  /** the member's latest active conversation (state + when it was last touched) */
  loadState: (client: TypedSupabaseClient, userId: string) => Promise<{ state: ChatState; updatedAt: string | null }>;
  abandon: (client: TypedSupabaseClient, conversationId: string) => Promise<void>;
  /** one step of the assistant (sendChatMessage) */
  send: (prev: ChatState, form: FormData) => Promise<ChatState>;
  transcribe: (audioBase64: string, mimeType: string) => Promise<TranscribeResult>;
  appUrl: string;
  now?: () => number;
  /** tells the carpool rider what the host answered (WhatsApp, best effort, never throws) */
  notifyRider?: (requestId: string, justification?: string) => Promise<void>;
  /** the same route map the screen shows (runs as the member); null when it is not available - the card is then sent without it */
  routeMap?: (origin: string, destination: string) => Promise<{ imageBase64: string; caption: string } | null>;
}

const SESSION_MINUTES = 30;
/** A conversation untouched for this long is not resumed by WhatsApp (it could carry old trip data from the web chat into a new request). */
const CONVERSATION_FRESH_MINUTES = 15;
const TRIGGER = /^\s*@?(?:fleetmind|fleet|frota)\b[\s,.:;!\-–—]*/i;
const SWITCH = /^(?:trocar|mudar|alterar)\s+(?:de\s+)?(?:perfil|usu[aá]rio|pessoa)$/i;
const ROLE_LABEL: Record<string, string> = { employee: "Colaborador", fleet_manager: "Gestor de Frota", administrator: "Administrador", security: "Segurança / Portaria", driver: "Motorista" };
const YES = /^(?:sim|s|ok|okay|confirmo|confirmar|confirma|pode|pode sim|isso|certo|positivo|beleza|blz|👍)$/i;
const NO = /^(?:n[aã]o|nao|n|cancela|cancelar|cancele|desisti|desistir|negativo|deixa|esquece)$/i;
const GREETING = /^(?:oi|ol[aá]|opa|e a[ií]|bom dia|boa tarde|boa noite|menu|ajuda|help|\?)$/i;
const MAX_TEXT = 3800;

export const TEXTS = {
  help:
    "Olá! Sou o assistente do *FleetMind*. Peça por texto ou por áudio, por exemplo:\n" +
    "• _Quero um carro amanhã às 8h, de São Paulo para Campinas, volto às 18h_\n" +
    "• _Tem carona para Campinas amanhã?_\n" +
    "• _Cancelar minha reserva_\n\n" +
    "É só continuar a conversa por aqui. Para trocar de perfil (se o seu número tem mais de um), escreva *trocar perfil*.",
  cpGone: "Este pedido de carona já foi respondido ou não está mais disponível.",
  cpFailed: "Não consegui registrar sua resposta agora (talvez não haja mais lugar no veículo). Abra o FleetMind em Minhas Caronas para responder.",
  cpReasonAgain: "Não consegui entender o motivo. Escreva em uma mensagem curta, ou grave outro áudio.",
  couldNotEnter: "Não consegui acessar a sua conta agora. Tente de novo em instantes.",
  onlyTextAudio: "Só consigo ler texto e áudio. Pode escrever ou gravar o pedido?",
  audioOff: "Ainda não consigo ouvir áudios por aqui. Escreva o pedido por texto, por favor.",
  audioFailed: "Não consegui entender o áudio. Pode gravar de novo, ou escrever o pedido?",
  audioTooLong: "O áudio ficou longo demais. Pode gravar um pedido mais curto, ou escrever?",
  cancelled: "Tudo bem, cancelei. Se precisar, é só mandar um novo pedido.",
  staleChoice: "Essa escolha já não está mais valendo. Me diga de novo o que você precisa, por exemplo: reservar um carro amanhã às 8h.",
  badOption: "Não entendi essa opção. Responda com o número de uma das opções acima.",
  chooseNumber: "Escolha uma opção respondendo com o número dela (por exemplo, *1*).",
  generic: "Não consegui processar agora. Tente de novo em instantes.",
  confirmHint: "Toque em um botão ou responda *SIM* para confirmar ou *NÃO* para cancelar.",
  pickIntro: "Este número está cadastrado em mais de um perfil. Com qual deles você quer falar? Responda com o número:",
  pickRetry: "Depois de escolher, me diga o que você precisa.",
  pickKeep: "Já guardei o seu pedido: assim que você escolher, eu continuo com ele.",
  pickBad: "Não entendi. Responda com o número do perfil.",
  confirm: "Confirmar",
  cancel: "Cancelar",
} as const;

const CARPOOL_TAP = /^cp:(yes|no):([0-9a-f]{32,128})$/;
const MAX_REASON = 300;

const norm = (s: string) => s.trim().toLowerCase().replace(/[.!]+$/g, "").trim();
const clip = (s: string) => (s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT - 1)}…` : s);
const text = (t: string): Reply => ({ type: "text", text: clip(t) });

/** Button ids this channel puts on its own messages (answered back by n8n). */
export const CHAT_BUTTON = { confirm: "chat:confirm", cancel: "chat:cancel" } as const;
/** A tap on a vehicle button carries "chat:veh:<vehicleId>" (re-validated against the pending options before it is used). */
export const VEHICLE_BUTTON_PREFIX = "chat:veh:";
/** A tap on a place option ("EZ Tower" fits several buildings) carries "chat:opt:<optionId>". */
export const OPTION_BUTTON_PREFIX = "chat:opt:";
/** WhatsApp shows at most 3 reply buttons per message. */
const MAX_VEHICLE_BUTTONS = 3;

function buttonToText(id: string | undefined): string | null {
  if (id === CHAT_BUTTON.confirm) return "sim";
  if (id === CHAT_BUTTON.cancel) return "não";
  return null;
}

/**
 * The assistant's new messages since the user's last one, as WhatsApp replies.
 * `lastOnly`: a tap on a vehicle / place button is not stored as a user message, so "since the user's last one" would stack the
 * earlier proposals (the Ora, then the HEV...) into the new card: only the assistant's newest message is shown.
 */
export function renderState(state: ChatState, appUrl: string, lastOnly = false): Reply[] {
  const msgs = state.messages;
  let lastUser = -1;
  msgs.forEach((m, i) => { if (m.role === "user") lastUser = i; });
  let fresh = msgs.slice(lastUser + 1).filter((m) => m.role === "assistant");
  if (lastOnly) fresh = fresh.slice(-1);
  if (fresh.length === 0) fresh = msgs.filter((m) => m.role === "assistant").slice(-1);
  const parts = fresh.map((m) => (m.link ? `${m.content}\n${m.link.label}: ${appUrl.replace(/\/+$/, "")}${m.link.href}` : m.content));
  let body = parts.join("\n\n").trim();

  const pending = state.status === "needs_confirmation" ? state.pendingAction : undefined;
  if (!pending) return [text(body || TEXTS.generic)];

  if (pending.options?.length) {
    body += `\n\n${pending.options.map((o, i) => `*${i + 1}.* ${o.label}`).join("\n")}\n\n${TEXTS.chooseNumber}`;
    // the places that fit a name are offered as buttons (at most 3 fit in a WhatsApp message); carpool options stay a numbered list
    if (pending.slots.placeChoices && pending.options.length <= MAX_VEHICLE_BUTTONS) {
      return [{ type: "buttons", text: clip(body), buttons: pending.options.map((o, i) => ({ id: `${OPTION_BUTTON_PREFIX}${o.id}`, title: `${i + 1} · ${o.label.split(" - ")[0]}`.slice(0, 20) })) }];
    }
    return [text(body)];
  }
  const card: Reply = { type: "buttons", text: clip(`${body}\n\n${TEXTS.confirmHint}`), buttons: [{ id: CHAT_BUTTON.confirm, title: TEXTS.confirm }, { id: CHAT_BUTTON.cancel, title: TEXTS.cancel }] };
  const others = vehicleAlternatives(pending.vehicleOptions, pending.slots.preferredVehicleId);
  if (others.length === 0) return [card];
  // the offered vehicle is never listed again: only the others, as tappable buttons (the first three) and, for the rest, by number
  const lines = others.map((v, i) => `*${i + 1}.* ${v.vehicleName} (${v.plate})${v.locationName ? ` — ${v.locationName}` : ""}`).join("\n");
  const tail = others.length > MAX_VEHICLE_BUTTONS ? `\n\nPara os demais, responda com o número (por exemplo, *${MAX_VEHICLE_BUTTONS + 1}*), por texto ou áudio.` : "";
  const pick: Reply = {
    type: "buttons",
    text: clip(`Se não quiser o veículo recomendado, escolha outro:\n${lines}${tail}`),
    buttons: others.slice(0, MAX_VEHICLE_BUTTONS).map((v, i) => ({ id: `${VEHICLE_BUTTON_PREFIX}${v.vehicleId}`, title: `${i + 1} · ${v.vehicleName}`.slice(0, 20) })),
  };
  return [card, pick];
}

/**
 * The route map (the same picture as the screen) goes right AFTER the reservation is confirmed, not with the proposal: the person
 * confirms, then gets the map of the trip. Best effort: no map, no problem. `before` is the proposal that was just confirmed.
 */
async function withRouteMap(before: ChatState["pendingAction"], phase: string | null, state: ChatState, rendered: Reply[], deps: BridgeDeps): Promise<Reply[]> {
  if (!deps.routeMap || phase !== "confirm" || before?.intent !== "CREATE_RESERVATION" || state.status !== "idle") return rendered;
  const origin = before.slots.origin?.trim();
  const destination = before.slots.destination?.trim();
  if (!origin || !destination) return rendered;
  try {
    const map = await deps.routeMap(origin, destination);
    if (!map?.imageBase64) return rendered;
    return [...rendered, { type: "image", text: clip(map.caption).slice(0, 900), imageBase64: map.imageBase64 }];
  } catch {
    return rendered;
  }
}

type Resolved = { ok?: boolean; reason?: string; request_id?: string; host_id?: string; host_email?: string; rider_name?: string };

/** The host tapped Aceitar / Recusar on a carpool request. The token binds the tap to that request, that host and the host's registered number. */
async function handleCarpoolTap(decision: "accept" | "reject", token: string, msg: InboundMessage, deps: BridgeDeps): Promise<{ replies: Reply[] }> {
  const none = { replies: [] as Reply[] };
  const res = await deps.rpc("fm_carpool_token_resolve", { p_token: token, p_from_phone: msg.from });
  const r = res.data as Resolved | null;
  if (res.error || !r) return none;
  if (r.ok !== true || !r.request_id || !r.host_id || !r.host_email) {
    // a tap from somebody else's number is never answered; an old or already answered request is explained
    return r?.reason === "phone_mismatch" || r?.reason === "invalid" ? none : { replies: [text(TEXTS.cpGone)] };
  }
  const reg = await deps.rpc("fm_whatsapp_register_inbound", { p_message_id: msg.messageId, p_user: r.host_id, p_org: null, p_kind: "button", p_handled: true });
  if (reg.error || reg.data === false) return none;
  const rider = r.rider_name ?? "o passageiro";
  if (decision === "reject") {
    await deps.rpc("fm_carpool_token_mark", { p_request_id: r.request_id, p_status: "awaiting_reason", p_reason: null });
    return { replies: [text(`Entendido. Para eu avisar *${rider}*, me diga em uma mensagem (texto ou áudio) o motivo de não poder levar.`)] };
  }
  const client = await deps.mintClient(r.host_email, r.host_id);
  if (!client) return { replies: [text(TEXTS.couldNotEnter)] };
  const done = await client.rpc("accept_carpool_ride_request", { p_request_id: r.request_id });
  if (done.error) return { replies: [text(TEXTS.cpFailed)] };
  await deps.rpc("fm_carpool_token_mark", { p_request_id: r.request_id, p_status: "done", p_reason: null });
  await deps.notifyRider?.(r.request_id).catch(() => undefined);
  return { replies: [text(`✅ Pronto! Você aceitou a carona de *${rider}*. Avisei ${rider}.`)] };
}

/** After Recusar: the next message of the host's number (text or voice) is the justification that goes to the rider. */
async function handleCarpoolReason(p: { request_id: string; host_id: string; host_email: string; rider_name?: string }, msg: InboundMessage, deps: BridgeDeps): Promise<{ replies: Reply[] }> {
  const none = { replies: [] as Reply[] };
  const reg = await deps.rpc("fm_whatsapp_register_inbound", { p_message_id: msg.messageId, p_user: p.host_id, p_org: null, p_kind: msg.kind, p_handled: true });
  if (reg.error || reg.data === false) return none;
  let reason = (msg.text ?? "").trim();
  const prefix: Reply[] = [];
  if (msg.kind === "audio") {
    const tr = await deps.transcribe(msg.audioBase64 ?? "", msg.mimeType ?? "audio/ogg");
    if (!tr.ok) return { replies: [text(TEXTS.cpReasonAgain)] };
    reason = tr.text.trim();
    prefix.push(text(`🎙️ Entendi: “${tr.text}”`));
  }
  reason = reason.replace(/\s+/g, " ").slice(0, MAX_REASON);
  if (reason.length < 2) return { replies: [text(TEXTS.cpReasonAgain)] };
  const client = await deps.mintClient(p.host_email, p.host_id);
  if (!client) return { replies: [...prefix, text(TEXTS.couldNotEnter)] };
  const done = await client.rpc("reject_carpool_ride_request", { p_request_id: p.request_id, p_reason: reason });
  if (done.error) return { replies: [...prefix, text(TEXTS.cpFailed)] };
  await deps.rpc("fm_carpool_token_mark", { p_request_id: p.request_id, p_status: "done", p_reason: reason });
  await deps.notifyRider?.(p.request_id, reason).catch(() => undefined);
  return { replies: [...prefix, text(`Pronto, avisei *${p.rider_name ?? "o passageiro"}* com o seu motivo.`)] };
}

export async function handleInboundWhatsApp(msg: InboundMessage, deps: BridgeDeps): Promise<{ replies: Reply[] }> {
  const none = { replies: [] as Reply[] };
  // said before the person chose their profile: continued, never asked again
  let resumedNotice: Reply[] = [];
  if (msg.kind === "button") {
    const tap = CARPOOL_TAP.exec(msg.buttonId ?? "");
    if (tap) return handleCarpoolTap(tap[1] === "yes" ? "accept" : "reject", tap[2]!, msg, deps);
  }
  if (msg.kind === "text" || msg.kind === "audio") {
    const pr = await deps.rpc("fm_carpool_pending_reason", { p_phone: msg.from });
    const pending = pr.data as { ok?: boolean; request_id?: string; host_id?: string; host_email?: string; rider_name?: string } | null;
    if (!pr.error && pending?.ok === true && pending.request_id && pending.host_id && pending.host_email) return handleCarpoolReason({ request_id: pending.request_id, host_id: pending.host_id, host_email: pending.host_email, rider_name: pending.rider_name }, msg, deps);
  }
  const idRes = await deps.rpc("fm_whatsapp_identify", { p_phone: msg.from });
  let who = idRes.data as { ok?: boolean; reason?: string; user_id?: string; organization_id?: string; email?: string; phone_norm?: string; candidates?: Candidate[] } | null;
  // unknown / unconsented numbers: no answer at all
  if (idRes.error || !who) return none;

  let handledPick = false;
  if (who.ok !== true && who.reason === "ambiguous" && who.phone_norm && who.candidates?.length) {
    const cands = who.candidates;
    const phone = who.phone_norm;
    const stateRes = await deps.rpc("fm_whatsapp_pick_state", { p_phone_norm: phone, p_minutes: SESSION_MINUTES });
    const st = (stateRes.data ?? {}) as { picked_user_id?: string | null; asked?: boolean; pending_text?: string | null };
    const typed = msg.kind === "text" ? norm(msg.text ?? "") : "";
    const wantsSwitch = SWITCH.test(typed);
    const picked = !wantsSwitch && st.picked_user_id ? cands.find((c) => c.user_id === st.picked_user_id) : undefined;
    // the first candidate only serves to record the message once (webhook redeliveries)
    const dedupe = async (handled: boolean) => {
      const r = await deps.rpc("fm_whatsapp_register_inbound", { p_message_id: msg.messageId, p_user: cands[0]!.user_id, p_org: cands[0]!.organization_id, p_kind: msg.kind, p_handled: handled });
      return !(r.error || r.data === false);
    };
    const list = () => cands.map((c, i) => `*${i + 1}.* ${c.full_name ?? ""} — ${ROLE_LABEL[c.role ?? ""] ?? c.role ?? ""}`).join("\n");
    if (picked) {
      await deps.rpc("fm_whatsapp_pick_write", { p_phone_norm: phone, p_user: picked.user_id }); // keeps the 30 minutes alive
      who = { ok: true, user_id: picked.user_id, organization_id: picked.organization_id ?? undefined, email: picked.email };
    } else {
      const n = /^\d{1,2}$/.test(typed) ? Number(typed) : null;
      const choice = st.asked && !wantsSwitch && n !== null ? cands[n - 1] : undefined;
      if (!(await dedupe(true))) return none;
      if (choice) {
        const w = await deps.rpc("fm_whatsapp_pick_write", { p_phone_norm: phone, p_user: choice.user_id });
        if (w.data === true) {
          const who2 = `*${choice.full_name ?? ""}* (${ROLE_LABEL[choice.role ?? ""] ?? choice.role ?? ""})`;
          const kept = (st.pending_text ?? "").trim();
          if (!kept) return { replies: [text(`Certo, você está falando como ${who2}. ${TEXTS.pickRetry}`)] };
          // the request said before choosing (text, or a voice note already transcribed) goes on as if it had just arrived
          resumedNotice = [text(`Certo, você está falando como ${who2}. Continuando com o seu pedido: “${kept.length > 200 ? `${kept.slice(0, 199)}…` : kept}”`)];
          who = { ok: true, user_id: choice.user_id, organization_id: choice.organization_id ?? undefined, email: choice.email };
          msg = { ...msg, kind: "text", text: kept, audioBase64: undefined };
        }
      }
      if (!who || who.ok !== true) {
        if (st.asked && !wantsSwitch && n !== null) return { replies: [text(`${TEXTS.pickBad}\n\n${list()}`)] };
        // keep what was said (a voice note is transcribed now) so it is not asked again after the choice
        const prefix0: Reply[] = [];
        let keep: string | null = null;
        if (!wantsSwitch && (msg.kind === "text" || msg.kind === "audio")) {
          let said = msg.kind === "text" ? (msg.text ?? "").trim() : "";
          if (msg.kind === "audio") {
            const tr = await deps.transcribe(msg.audioBase64 ?? "", msg.mimeType ?? "audio/ogg");
            if (tr.ok) { said = tr.text.trim(); prefix0.push(text(`🎙️ Entendi: “${tr.text}”`)); }
          }
          said = said.replace(TRIGGER, "").trim();
          if (said.length >= 3 && !/^\d{1,2}$/.test(said) && !GREETING.test(norm(said))) keep = said;
        }
        await deps.rpc("fm_whatsapp_pick_write", { p_phone_norm: phone, p_user: null, p_pending: keep });
        return { replies: [...prefix0, text(`${TEXTS.pickIntro}\n\n${list()}${keep ? `\n\n${TEXTS.pickKeep}` : ""}`)] };
      }
    }
    handledPick = true;
  }
  if (!who || who.ok !== true || !who.user_id || !who.email) return none;

  // 1) what kind of message is it
  let input = (msg.text ?? "").trim();
  let handle = true;
  if (msg.kind === "button") {
    const t = buttonToText(msg.buttonId);
    if (t) input = t;
    else if (msg.buttonId?.startsWith(VEHICLE_BUTTON_PREFIX) || msg.buttonId?.startsWith(OPTION_BUTTON_PREFIX)) input = msg.buttonId; // handled below, against the pending options
    else handle = false;
  } else if (msg.kind === "text") {
    const m = TRIGGER.exec(input);
    if (m) input = input.slice(m[0].length).trim(); // "fleet ..." still works, it is just not needed
  }

  // 2) record it once (the webhook can be delivered twice); ignored messages are recorded as such
  if (!handledPick) {
    const reg = await deps.rpc("fm_whatsapp_register_inbound", { p_message_id: msg.messageId, p_user: who.user_id, p_org: who.organization_id ?? null, p_kind: msg.kind, p_handled: handle });
    if (reg.error || reg.data === false) return none;
  }
  if (!handle) return none;

  // 3) voice note -> text
  const prefix: Reply[] = [...resumedNotice];
  if (msg.kind === "audio") {
    const tr = await deps.transcribe(msg.audioBase64 ?? "", msg.mimeType ?? "audio/ogg");
    if (!tr.ok) {
      return { replies: [text(tr.reason === "not_configured" ? TEXTS.audioOff : tr.reason === "too_large" ? TEXTS.audioTooLong : TEXTS.audioFailed)] };
    }
    input = tr.text;
    prefix.push(text(`🎙️ Entendi: “${tr.text}”`));
    const m = TRIGGER.exec(input);
    if (m) input = input.slice(m[0].length).trim();
  } else if (msg.kind === "other") {
    return { replies: [text(TEXTS.onlyTextAudio)] };
  }

  if (!input || GREETING.test(norm(input))) return { replies: [...prefix, text(TEXTS.help)] };

  // 4) act as the member and run one step of the assistant
  const client = await deps.mintClient(who.email, who.user_id);
  if (!client) return { replies: [...prefix, text(TEXTS.couldNotEnter)] };
  const ctx: ActingContext = { user: { id: who.user_id, email: who.email }, client };
  try {
    const replies = await deps.runAsUser(ctx, async () => {
      const loaded = await deps.loadState(client, who.user_id!);
      let prev = loaded.state;
      const now = deps.now?.() ?? Date.now();
      // a confirmation left hanging for a long time must never be answered by an accidental "sim" later
      if (prev.conversationId && loaded.updatedAt && now - new Date(loaded.updatedAt).getTime() > CONVERSATION_FRESH_MINUTES * 60_000) {
        await deps.abandon(client, prev.conversationId);
        prev = { status: "idle", messages: [] };
      }

      const form = new FormData();
      form.set("conversationId", prev.conversationId ?? "");
      const t = norm(input);
      const pending = prev.status === "needs_confirmation" ? prev.pendingAction : undefined;
      // the numbers the person sees: carpool options as listed, vehicles = the alternatives to the offered one
      const alternatives = vehicleAlternatives(pending?.vehicleOptions, pending?.slots.preferredVehicleId);
      const optionCount = pending?.options?.length ?? alternatives.length;
      const n = /^\d{1,2}$/.test(t) ? Number(t) : optionCount > 0 ? parseChoice(input, optionCount) : null;

      if (pending && input.startsWith(VEHICLE_BUTTON_PREFIX)) {
        const vehicleId = input.slice(VEHICLE_BUTTON_PREFIX.length);
        const veh = pending.vehicleOptions?.find((v) => v.vehicleId === vehicleId);
        if (!veh) return [text(TEXTS.badOption)];
        form.set("phase", "select_vehicle");
        form.set("vehicleId", veh.vehicleId);
      } else if (pending && input.startsWith(OPTION_BUTTON_PREFIX)) {
        const optionId = input.slice(OPTION_BUTTON_PREFIX.length);
        const opt = pending.options?.find((o) => o.id === optionId);
        if (!opt) return [text(TEXTS.badOption)];
        form.set("phase", "select_option");
        form.set("optionId", opt.id);
      } else if (!pending && (input.startsWith(VEHICLE_BUTTON_PREFIX) || input.startsWith(OPTION_BUTTON_PREFIX))) {
        return [text(TEXTS.staleChoice)];
      } else if (pending && n !== null && (pending.options?.length || alternatives.length)) {
        if (pending.options?.length) {
          const opt = pending.options[n - 1];
          if (!opt) return [text(TEXTS.badOption)];
          form.set("phase", "select_option");
          form.set("optionId", opt.id);
        } else {
          const veh = alternatives[n - 1];
          if (!veh) return [text(TEXTS.badOption)];
          form.set("phase", "select_vehicle");
          form.set("vehicleId", veh.vehicleId);
        }
      } else if (pending && YES.test(t)) {
        if (pending.options?.length) return [text(TEXTS.chooseNumber)];
        form.set("phase", "confirm");
      } else if (pending && NO.test(t)) {
        if (prev.conversationId) await deps.abandon(client, prev.conversationId);
        return [text(TEXTS.cancelled)];
      } else {
        form.set("phase", "message");
        form.set("message", input);
      }
      const state = await deps.send(prev, form);
      const rendered = renderState(state, deps.appUrl, form.get("phase") === "select_vehicle" || form.get("phase") === "select_option");
      return await withRouteMap(pending, String(form.get("phase") ?? ""), state, rendered, deps);
    });
    return { replies: [...prefix, ...replies] };
  } catch {
    return { replies: [...prefix, text(TEXTS.generic)] };
  }
}

