"use client";

import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { sendChatMessage, type ChatState } from "./chat/actions";
import type { Dictionary } from "../lib/i18n/dictionaries";
import type { Locale } from "../lib/i18n/locales";

// Web Speech API's BCP-47 locale tags for the recognizer — matches this app's own locale
// codes 1:1 except zh-CN, which the API expects with an underscore-free region form it
// already shares. Previously hardcoded to "pt-BR" regardless of the user's actual
// language setting, so speaking in any other configured language transcribed badly.
const SPEECH_RECOGNITION_LANGS: Record<Locale, string> = {
  "pt-BR": "pt-BR",
  "en-US": "en-US",
  es: "es-ES",
  "zh-CN": "zh-CN",
};

// Vendor-prefixed on Safari/older Chromium builds; undefined entirely on Firefox and most
// non-Chromium mobile browsers — feature-detected once so the mic button simply doesn't
// render where it isn't supported, rather than showing a button that silently does nothing.
type SpeechRecognitionCtor = new () => {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  start: () => void;
  stop: () => void;
};

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function ChatPanel({
  dict,
  locale,
  isOpen,
  onClose,
  initialState,
}: {
  dict: Dictionary;
  locale: Locale;
  isOpen: boolean;
  onClose: () => void;
  initialState: ChatState;
}) {
  const t = dict.chat;
  const [actionState, formAction, pending] = useActionState(sendChatMessage, initialState);
  // "Alterar"/"Cancelar" only ever need to change what's on screen (drop the pending
  // confirmation, or clear the thread) — no LLM call, no dispatch, nothing that needs a
  // server round trip. Routing them through the Server Action anyway (formAction) made
  // Next.js refetch/revalidate the current route's RSC payload on every click — visible as
  // the Gantt table underneath flashing for about a second — for zero actual benefit, since
  // nothing on the page besides the chat panel changed. This local override lets those two
  // actions update the visible state directly instead; it's cleared whenever a real
  // server-driven update (a genuinely new actionState) comes in, so it never masks it.
  const [override, setOverride] = useState<ChatState | null>(null);
  const state = override ?? actionState;
  useEffect(() => {
    setOverride(null);
  }, [actionState]);
  const [draft, setDraft] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState("");
  const [micError, setMicError] = useState<string | null>(null);
  const recognitionRef = useRef<InstanceType<SpeechRecognitionCtor> | null>(null);
  const finalizedResultCountRef = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);
  const micSupported = getSpeechRecognitionCtor() !== null;

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [state.messages, state.pendingAction]);

  useEffect(() => {
    // The panel now stays mounted-but-hidden when closed (see ChatWidget.tsx) rather than
    // unmounting — without this, closing the panel mid-capture would leave the browser's
    // mic indicator on and SpeechRecognition running in the background indefinitely.
    if (!isOpen && isListening) {
      recognitionRef.current?.stop();
    }
  }, [isOpen, isListening]);

  // Sending a message, confirming/cancelling, or picking a vehicle option all end the
  // current turn of the conversation — the mic should stop with it instead of continuing to
  // capture (and show its "listening" indicator) into whatever comes next on screen.
  function stopListeningIfActive() {
    if (isListening) recognitionRef.current?.stop();
  }

  function toggleMic() {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;
    if (isListening) {
      recognitionRef.current?.stop();
      return;
    }
    setMicError(null);
    setInterimTranscript("");
    finalizedResultCountRef.current = 0;
    const recognition = new Ctor();
    recognition.lang = SPEECH_RECOGNITION_LANGS[locale];
    // `continuous: false` (the previous setting) stops listening at the FIRST pause it
    // detects — the recognizer's own silence-timeout, not the user's mic button — which
    // read as "cut me off mid-sentence" for anything longer than a short phrase.
    // `continuous: true` keeps listening across pauses until the mic button is clicked
    // again (or recognition.stop() is called for any other reason), so a normal-length
    // sentence with natural pauses no longer gets chopped off partway through.
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      // With continuous:true, `event.results` keeps growing across the whole recording
      // and each onresult event re-lists every result from index 0 — including ones
      // already marked final in a previous event. Only the results from
      // finalizedResultCountRef.current onward are new; re-summing everything from
      // scratch (the old approach, fine when there was ever only one final result) would
      // append each already-committed phrase to the draft again on every subsequent
      // pause.
      const results = Array.from(event.results);
      let liveTranscript = "";
      for (let i = finalizedResultCountRef.current; i < results.length; i++) {
        const result = results[i]!;
        const text = result[0]?.transcript ?? "";
        if (result.isFinal) {
          setDraft((prev) => `${prev}${prev ? " " : ""}${text}`.trim());
          finalizedResultCountRef.current = i + 1;
        } else {
          liveTranscript += text;
        }
      }
      setInterimTranscript(liveTranscript);
    };
    recognition.onerror = (event) => {
      setMicError(event.error === "not-allowed" ? t.micPermissionDenied : t.micGenericError);
      setIsListening(false);
    };
    recognition.onend = () => {
      // Deliberately NOT clearing interimTranscript here — it used to disappear the
      // instant recognition stopped, which read as "my words vanished" even though the
      // text had already landed safely in the draft input a moment earlier. Leaving the
      // "ouvindo" status line up (now showing the final captured phrase) until the next
      // recording starts or the message is sent makes it visibly clear nothing was lost.
      setIsListening(false);
    };
    recognitionRef.current = recognition;
    setIsListening(true);
    try {
      recognition.start();
    } catch {
      // start() throws synchronously (InvalidStateError) when the browser's single global
      // recognizer hasn't fully released from a just-stopped previous instance yet — e.g.
      // clicking the mic again right after it auto-stopped on send/confirm. Without this,
      // isListening stayed stuck true (the "ouvindo" indicator showing forever) even though
      // recognition never actually started and nothing was ever transcribed — neither
      // onerror nor onend fires for a synchronous throw here.
      recognitionRef.current = null;
      setIsListening(false);
      setMicError(t.micGenericError);
    }
  }

  function handleSend(formData: FormData) {
    stopListeningIfActive();
    formData.set("phase", "message");
    formData.set("message", draft);
    if (state.conversationId) formData.set("conversationId", state.conversationId);
    setDraft("");
    setInterimTranscript("");
    formAction(formData);
  }

  function handleConfirm() {
    stopListeningIfActive();
    const formData = new FormData();
    formData.set("phase", "confirm");
    if (state.conversationId) formData.set("conversationId", state.conversationId);
    // useActionState actions must run inside a transition (otherwise `pending` never turns true
    // and React logs an error): keeps the buttons disabled and "Pensando..." visible meanwhile.
    startTransition(() => formAction(formData));
  }

  function handleEdit() {
    stopListeningIfActive();
    // Drops only the pending confirmation — the conversation history stays, so a follow-up
    // like "muda a saída pra 7:00" still carries the already-established slots forward.
    // Previously left the driver staring at an empty input with no cue for what to type;
    // asking explicitly (destination/time/vehicle) is what actually prompts the follow-up
    // message instead of requiring them to already know the fix-up phrasing.
    setOverride({
      status: "idle",
      conversationId: state.conversationId,
      messages: [...state.messages, { role: "assistant", content: t.editPrompt }],
    });
  }

  function handleCancel() {
    stopListeningIfActive();
    const conversationId = state.conversationId;
    // Unlike Alterar, cancelling ends the whole thread — every clarifying question and
    // option shown has nothing to do with whatever's asked next.
    setOverride({ status: "idle", messages: [] });
    if (conversationId) {
      fetch("/api/chat/abandon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId }),
      }).catch(() => {});
    }
  }

  function handleSelectVehicle(vehicleId: string) {
    stopListeningIfActive();
    const formData = new FormData();
    formData.set("phase", "select_vehicle");
    formData.set("vehicleId", vehicleId);
    if (state.conversationId) formData.set("conversationId", state.conversationId);
    // useActionState actions must run inside a transition (otherwise `pending` never turns true
    // and React logs an error): keeps the buttons disabled and "Pensando..." visible meanwhile.
    startTransition(() => formAction(formData));
  }

  function handleSelectOption(optionId: string) {
    stopListeningIfActive();
    const formData = new FormData();
    formData.set("phase", "select_option");
    formData.set("optionId", optionId);
    if (state.conversationId) formData.set("conversationId", state.conversationId);
    // useActionState actions must run inside a transition (otherwise `pending` never turns true
    // and React logs an error): keeps the buttons disabled and "Pensando..." visible meanwhile.
    startTransition(() => formAction(formData));
  }

  // Numbered options (carpool offers) are answered with a button OR by typing/saying the
  // number, so the text input must stay usable while they are shown.
  const hasCarpoolOptions = Boolean(state.pendingAction?.options?.length);
  // Vehicle options accept the same bare-number reply ("2", "opção 2"), so typing/speaking stays
  // enabled for both kinds; a plain Confirmar/Cancelar card (no options) still locks the input
  // so nobody types over it by accident.
  const hasOptions = hasCarpoolOptions || Boolean(state.pendingAction?.vehicleOptions?.length);
  // While options are unresolved only Cancelar is offered (there is nothing to confirm yet);
  // choosing an option leads to its own confirmation card.
  const showConfirmButtons = !hasCarpoolOptions;

  return (
    <div
      role="dialog"
      aria-label={t.panelTitle}
      aria-hidden={!isOpen}
      className={`fixed bottom-20 right-5 z-40 flex h-[31rem] w-[24rem] max-w-[calc(100vw-2.5rem)] flex-col rounded-md border border-line-800 bg-panel-900 shadow-xl shadow-black/40 ${
        isOpen ? "" : "hidden"
      }`}
    >
      <div className="flex items-center justify-between border-b border-line-800 px-4 py-3">
        <p className="text-sm font-semibold uppercase tracking-widest text-paper-50">{t.panelTitle}</p>
        <button type="button" onClick={onClose} aria-label={dict.common.close} className="text-fog-400 hover:text-paper-50">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="h-4 w-4" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-3">
        {state.messages.length === 0 ? (
          <p className="text-sm text-fog-600">{t.emptyStateHint}</p>
        ) : null}
        <div className="flex flex-col gap-2">
          {state.messages.map((message, index) => (
            <div
              key={index}
              className={`max-w-[85%] whitespace-pre-line break-user-text rounded-sm px-3 py-2 text-sm ${
                message.role === "user"
                  ? "self-end bg-gwm-accent text-ink-950"
                  : "self-start bg-panel-800 text-paper-50"
              }`}
            >
              {message.content}
            </div>
          ))}
        </div>

        {state.status === "needs_confirmation" && state.pendingAction ? (
          <div className="mt-3 flex flex-col gap-2 rounded-sm border border-gwm-accent/40 bg-gwm-accent/10 p-3">
            <p className="whitespace-pre-line text-sm text-gwm-accent break-user-text">{state.pendingAction.summary}</p>
            {state.pendingAction.vehicleOptions ? (
              <div className="flex flex-wrap gap-1.5">
                {state.pendingAction.vehicleOptions.map((option, index) => {
                  const isChosen = option.vehicleId === state.pendingAction!.slots.preferredVehicleId;
                  return (
                    <button
                      key={option.vehicleId}
                      type="button"
                      onClick={() => handleSelectVehicle(option.vehicleId)}
                      disabled={pending || isChosen}
                      className={`rounded-sm border px-2.5 py-1 text-xs font-mono disabled:opacity-70 ${
                        isChosen
                          ? "border-gwm-accent bg-gwm-accent/20 text-gwm-accent"
                          : "border-line-700 text-fog-400 hover:border-gwm-accent hover:text-gwm-accent"
                      }`}
                    >
                      {index + 1}. {option.vehicleName}
                      <span className="ml-1 font-sans text-[10px] opacity-70">({option.plate})</span>
                    </button>
                  );
                })}
              </div>
            ) : null}
            {state.pendingAction.options ? (
              <div
                role="group"
                aria-label={t.carpool.optionsGroupLabel}
                data-testid="chat-carpool-options"
                className="flex flex-col gap-1.5"
              >
                {state.pendingAction.options.map((option, index) => (
                  <button
                    key={option.id}
                    type="button"
                    data-testid="chat-carpool-option"
                    onClick={() => handleSelectOption(option.id)}
                    disabled={pending}
                    className="rounded-sm border border-line-700 px-2.5 py-1.5 text-left text-xs text-fog-400 hover:border-gwm-accent hover:text-gwm-accent disabled:opacity-70"
                  >
                    {index + 1}. {option.label}
                  </button>
                ))}
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {showConfirmButtons ? (<>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={pending}
                className="rounded-sm bg-gwm-accent px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider sm:px-3 sm:text-xs sm:tracking-widest text-ink-950 hover:opacity-90 disabled:opacity-50"
              >
                {t.confirmYes}
              </button>
              <button
                type="button"
                onClick={handleEdit}
                disabled={pending}
                className="rounded-sm border border-line-700 px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider sm:px-3 sm:text-xs sm:tracking-widest text-fog-400 hover:border-line-600 disabled:opacity-50"
              >
                {t.confirmEdit}
              </button>
              </>) : null}
              <button
                type="button"
                onClick={handleCancel}
                disabled={pending}
                className="rounded-sm border border-line-700 px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider sm:px-3 sm:text-xs sm:tracking-widest text-fog-400 hover:border-line-600 disabled:opacity-50"
              >
                {t.confirmCancel}
              </button>
            </div>
          </div>
        ) : null}

        {state.status === "error" ? (
          <p role="alert" className="mt-3 text-xs text-signal-red">
            {t.errorGeneric}
          </p>
        ) : null}

        {pending ? <p className="mt-2 text-xs text-fog-600">{t.thinking}</p> : null}
      </div>

      <form
        action={handleSend}
        className="flex flex-col gap-2 border-t border-line-800 p-3"
      >
        {isListening ? (
          <p role="status" className="flex items-center gap-1.5 text-xs text-gwm-accent">
            <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-gwm-accent" aria-hidden="true" />
            {t.micListening}
          </p>
        ) : null}
        {micError ? (
          <p role="alert" className="text-xs text-signal-red">
            {micError}
          </p>
        ) : null}
        <div className="flex items-end gap-2">
          <textarea
            rows={3}
            // While listening, the live transcript is composited straight into the
            // textarea itself (what's already been said + what's being heard right now)
            // instead of a separate status line above the input — per feedback, the
            // transcription should appear where the message is actually being composed,
            // not off in the conversation window.
            value={isListening ? `${draft}${draft && interimTranscript ? " " : ""}${interimTranscript}` : draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t.inputPlaceholder}
            disabled={pending || (state.status === "needs_confirmation" && !hasOptions)}
            className="min-w-0 flex-1 resize-none rounded-sm border border-line-800 bg-panel-800 px-3 py-2 text-sm text-paper-50 outline-none focus-visible:border-gwm-accent disabled:opacity-50"
          />
            <div className="flex shrink-0 flex-col gap-2">
              {micSupported ? (
                <span className="relative flex h-9 w-9 shrink-0 items-center justify-center">
                  {isListening ? (
                    <span
                      className="animate-mic-pulse pointer-events-none absolute inset-0 rounded-sm bg-gwm-accent/40"
                      aria-hidden="true"
                    />
                  ) : null}
                  <button
                    type="button"
                    onClick={toggleMic}
                    disabled={pending || (state.status === "needs_confirmation" && !hasOptions)}
                    aria-pressed={isListening}
                    aria-label={isListening ? t.micStop : t.micStart}
                    title={isListening ? t.micStop : t.micStart}
                    className={`relative flex h-9 w-9 items-center justify-center rounded-sm border text-fog-400 hover:border-gwm-accent hover:text-gwm-accent disabled:opacity-50 ${
                      isListening ? "border-gwm-accent text-gwm-accent" : "border-line-800"
                    }`}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
                      <path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Z" />
                      <path d="M19 11a7 7 0 0 1-14 0M12 18v3" />
                    </svg>
                  </button>
                </span>
              ) : null}
              <button
                type="submit"
                disabled={pending || !draft.trim() || (state.status === "needs_confirmation" && !hasOptions)}
                className="shrink-0 rounded-sm bg-gwm-accent px-3 py-2 text-xs font-semibold uppercase tracking-widest text-ink-950 hover:opacity-90 disabled:opacity-50"
              >
                {t.send}
              </button>
            </div>
          </div>
      </form>
    </div>
  );
}
