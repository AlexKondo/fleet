"use client";

import { useActionState, useEffect, useRef, useState } from "react";
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
  const [state, formAction, pending] = useActionState(sendChatMessage, initialState);
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
  }, [state.messages]);

  useEffect(() => {
    // The panel now stays mounted-but-hidden when closed (see ChatWidget.tsx) rather than
    // unmounting — without this, closing the panel mid-capture would leave the browser's
    // mic indicator on and SpeechRecognition running in the background indefinitely.
    if (!isOpen && isListening) {
      recognitionRef.current?.stop();
    }
  }, [isOpen, isListening]);

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
    recognition.start();
  }

  function handleSend(formData: FormData) {
    formData.set("phase", "message");
    formData.set("message", draft);
    if (state.conversationId) formData.set("conversationId", state.conversationId);
    setDraft("");
    setInterimTranscript("");
    formAction(formData);
  }

  function handleConfirm(confirm: boolean) {
    const formData = new FormData();
    formData.set("phase", confirm ? "confirm" : "cancel");
    if (state.conversationId) formData.set("conversationId", state.conversationId);
    formAction(formData);
  }

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
              className={`max-w-[85%] rounded-sm px-3 py-2 text-sm ${
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
            <p className="text-sm text-gwm-accent">{state.pendingAction.summary}</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => handleConfirm(true)}
                disabled={pending}
                className="rounded-sm bg-gwm-accent px-3 py-1.5 text-xs font-semibold uppercase tracking-widest text-ink-950 hover:opacity-90 disabled:opacity-50"
              >
                {t.confirmYes}
              </button>
              <button
                type="button"
                onClick={() => handleConfirm(false)}
                disabled={pending}
                className="rounded-sm border border-line-700 px-3 py-1.5 text-xs font-semibold uppercase tracking-widest text-fog-400 hover:border-line-600 disabled:opacity-50"
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
            disabled={pending || state.status === "needs_confirmation"}
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
                    disabled={pending || state.status === "needs_confirmation"}
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
                disabled={pending || !draft.trim() || state.status === "needs_confirmation"}
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
