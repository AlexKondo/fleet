"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { sendChatMessage, initialChatState, type ChatState } from "./chat/actions";
import type { Dictionary } from "../lib/i18n/dictionaries";

// Vendor-prefixed on Safari/older Chromium builds; undefined entirely on Firefox and most
// non-Chromium mobile browsers — feature-detected once so the mic button simply doesn't
// render where it isn't supported, rather than showing a button that silently does nothing.
type SpeechRecognitionCtor = new () => {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
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

export function ChatPanel({ dict, onClose }: { dict: Dictionary; onClose: () => void }) {
  const t = dict.chat;
  const [state, formAction, pending] = useActionState(sendChatMessage, initialChatState);
  const [draft, setDraft] = useState("");
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<InstanceType<SpeechRecognitionCtor> | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const micSupported = getSpeechRecognitionCtor() !== null;

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [state.messages]);

  function toggleMic() {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;
    if (isListening) {
      recognitionRef.current?.stop();
      return;
    }
    const recognition = new Ctor();
    recognition.lang = "pt-BR";
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((r) => r[0]?.transcript ?? "")
        .join(" ");
      setDraft(transcript);
    };
    recognition.onend = () => setIsListening(false);
    recognitionRef.current = recognition;
    setIsListening(true);
    recognition.start();
  }

  function handleSend(formData: FormData) {
    formData.set("phase", "message");
    formData.set("message", draft);
    if (state.conversationId) formData.set("conversationId", state.conversationId);
    setDraft("");
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
      className="fixed bottom-20 right-5 z-40 flex h-[28rem] w-[22rem] max-w-[calc(100vw-2.5rem)] flex-col rounded-md border border-line-800 bg-panel-900 shadow-xl shadow-black/40"
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
        className="flex items-center gap-2 border-t border-line-800 p-3"
      >
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t.inputPlaceholder}
          disabled={pending || state.status === "needs_confirmation"}
          className="min-w-0 flex-1 rounded-sm border border-line-800 bg-panel-800 px-3 py-2 text-sm text-paper-50 outline-none focus-visible:border-gwm-accent disabled:opacity-50"
        />
        {micSupported ? (
          <button
            type="button"
            onClick={toggleMic}
            disabled={pending || state.status === "needs_confirmation"}
            aria-pressed={isListening}
            aria-label={isListening ? t.micStop : t.micStart}
            title={isListening ? t.micStop : t.micStart}
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-sm border text-fog-400 hover:border-gwm-accent hover:text-gwm-accent disabled:opacity-50 ${
              isListening ? "border-gwm-accent text-gwm-accent" : "border-line-800"
            }`}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
              <path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Z" />
              <path d="M19 11a7 7 0 0 1-14 0M12 18v3" />
            </svg>
          </button>
        ) : null}
        <button
          type="submit"
          disabled={pending || !draft.trim() || state.status === "needs_confirmation"}
          className="shrink-0 rounded-sm bg-gwm-accent px-3 py-2 text-xs font-semibold uppercase tracking-widest text-ink-950 hover:opacity-90 disabled:opacity-50"
        >
          {t.send}
        </button>
      </form>
    </div>
  );
}
