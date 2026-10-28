import type { TypedSupabaseClient } from "@fleet/supabase-client";
import type { ChatState } from "@/app/chat/actions";
import type { ActingContext } from "@/lib/auth/actingUser";
import type { TranscribeResult } from "./transcribe";

/**
 * Reserving a vehicle by WhatsApp: turns an inbound message (text, voice note or button tap) from a member identified by their registered
 * phone into one step of the SAME assistant the web chat uses (sendChatMessage), acting as that member, and renders the answer as WhatsApp
 * messages (text, numbered options, Confirmar / Cancelar buttons). The reservation still goes through the normal approval.
 *
 * The line is a personal WhatsApp, so: unknown numbers get NO answer; a registered member is answered only inside an open session or when
 * the message starts with the trigger word ("fleet ..."); voice notes are transcribed only inside an open session.
 */
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
  | { type: "buttons"; text: string; buttons: { id: string; title: string }[] };

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
}

const SESSION_MINUTES = 30;
const TRIGGER = /^\s*@?(?:fleetmind|fleet|frota)\b[\s,.:;!\-–—]*/i;
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
    "Para começar, escreva *fleet* antes do pedido. Depois, por 30 minutos, é só continuar a conversa.",
  couldNotEnter: "Não consegui acessar a sua conta agora. Tente de novo em instantes.",
  onlyTextAudio: "Só consigo ler texto e áudio. Pode escrever ou gravar o pedido?",
  audioOff: "Ainda não consigo ouvir áudios por aqui. Escreva o pedido por texto, por favor.",
  audioFailed: "Não consegui entender o áudio. Pode gravar de novo, ou escrever o pedido?",
  audioTooLong: "O áudio ficou longo demais. Pode gravar um pedido mais curto, ou escrever?",
  cancelled: "Tudo bem, cancelei. Se precisar, é só mandar um novo pedido.",
  badOption: "Não entendi essa opção. Responda com o número de uma das opções acima.",
  chooseNumber: "Escolha uma opção respondendo com o número dela (por exemplo, *1*).",
  generic: "Não consegui processar agora. Tente de novo em instantes.",
  confirmHint: "Toque em um botão ou responda *SIM* para confirmar ou *NÃO* para cancelar.",
  confirm: "Confirmar",
  cancel: "Cancelar",
} as const;

const norm = (s: string) => s.trim().toLowerCase().replace(/[.!]+$/g, "").trim();
const clip = (s: string) => (s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT - 1)}…` : s);
const text = (t: string): Reply => ({ type: "text", text: clip(t) });

/** Button ids this channel puts on its own messages (answered back by n8n). */
export const CHAT_BUTTON = { confirm: "chat:confirm", cancel: "chat:cancel" } as const;

function buttonToText(id: string | undefined): string | null {
  if (id === CHAT_BUTTON.confirm) return "sim";
  if (id === CHAT_BUTTON.cancel) return "não";
  return null;
}

/** The assistant's new messages since the user's last one, as WhatsApp replies. */
export function renderState(state: ChatState, appUrl: string): Reply[] {
  const msgs = state.messages;
  let lastUser = -1;
  msgs.forEach((m, i) => { if (m.role === "user") lastUser = i; });
  let fresh = msgs.slice(lastUser + 1).filter((m) => m.role === "assistant");
  if (fresh.length === 0) fresh = msgs.filter((m) => m.role === "assistant").slice(-1);
  const parts = fresh.map((m) => (m.link ? `${m.content}\n${m.link.label}: ${appUrl.replace(/\/+$/, "")}${m.link.href}` : m.content));
  let body = parts.join("\n\n").trim();

  const pending = state.status === "needs_confirmation" ? state.pendingAction : undefined;
  if (!pending) return [text(body || TEXTS.generic)];

  if (pending.options?.length) {
    body += `\n\n${pending.options.map((o, i) => `*${i + 1}.* ${o.label}`).join("\n")}\n\n${TEXTS.chooseNumber}`;
    return [text(body)];
  }
  if (pending.vehicleOptions && pending.vehicleOptions.length > 1) {
    body += `\n\nVeículos disponíveis:\n${pending.vehicleOptions.map((v, i) => `*${i + 1}.* ${v.vehicleName} (${v.plate})`).join("\n")}\nPara trocar, responda com o número.`;
  }
  return [{ type: "buttons", text: clip(`${body}\n\n${TEXTS.confirmHint}`), buttons: [{ id: CHAT_BUTTON.confirm, title: TEXTS.confirm }, { id: CHAT_BUTTON.cancel, title: TEXTS.cancel }] }];
}

export async function handleInboundWhatsApp(msg: InboundMessage, deps: BridgeDeps): Promise<{ replies: Reply[] }> {
  const none = { replies: [] as Reply[] };
  const idRes = await deps.rpc("fm_whatsapp_identify", { p_phone: msg.from });
  const who = idRes.data as { ok?: boolean; user_id?: string; organization_id?: string; email?: string } | null;
  // unknown / unconsented / ambiguous numbers: no answer at all (the line is a personal WhatsApp)
  if (idRes.error || !who || who.ok !== true || !who.user_id || !who.email) return none;

  const openRes = await deps.rpc("fm_whatsapp_session_open", { p_user: who.user_id, p_minutes: SESSION_MINUTES });
  const open = openRes.data === true;

  // 1) is this message for the assistant at all?
  let input = (msg.text ?? "").trim();
  let handle = false;
  if (msg.kind === "button") {
    const t = buttonToText(msg.buttonId);
    if (t) { input = t; handle = open; }
  } else if (msg.kind === "text") {
    if (open) handle = true;
    else {
      const m = TRIGGER.exec(input);
      if (m) { handle = true; input = input.slice(m[0].length).trim(); }
    }
  } else {
    handle = open; // voice notes and other media only inside an open session
  }

  // 2) record it once (the webhook can be delivered twice); ignored messages are recorded as such
  const reg = await deps.rpc("fm_whatsapp_register_inbound", { p_message_id: msg.messageId, p_user: who.user_id, p_org: who.organization_id ?? null, p_kind: msg.kind, p_handled: handle });
  if (reg.error || reg.data === false) return none;
  if (!handle) return none;

  // 3) voice note -> text
  const prefix: Reply[] = [];
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
      if (prev.conversationId && loaded.updatedAt && now - new Date(loaded.updatedAt).getTime() > SESSION_MINUTES * 60_000) {
        await deps.abandon(client, prev.conversationId);
        prev = { status: "idle", messages: [] };
      }

      const form = new FormData();
      form.set("conversationId", prev.conversationId ?? "");
      const t = norm(input);
      const n = /^\d{1,2}$/.test(t) ? Number(t) : null;
      const pending = prev.status === "needs_confirmation" ? prev.pendingAction : undefined;

      if (pending && n !== null && (pending.options?.length || pending.vehicleOptions?.length)) {
        if (pending.options?.length) {
          const opt = pending.options[n - 1];
          if (!opt) return [text(TEXTS.badOption)];
          form.set("phase", "select_option");
          form.set("optionId", opt.id);
        } else {
          const veh = pending.vehicleOptions![n - 1];
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
      return renderState(state, deps.appUrl);
    });
    return { replies: [...prefix, ...replies] };
  } catch {
    return { replies: [...prefix, text(TEXTS.generic)] };
  }
}

