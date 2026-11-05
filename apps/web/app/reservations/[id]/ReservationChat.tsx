"use client";

import { useActionState, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { chatTargets, type ChatSide, type MessageChannel, type MessageType } from "@/lib/domain/messages";
import { formatDateTime } from "@/lib/formatDateTime";
import { errorLabel } from "@/lib/i18n/errorLabel";
import type { Locale } from "@/lib/i18n/locales";
import type { Dictionary } from "../../../lib/i18n/dictionaries";
import { postReservationMessage, type MessageActionState } from "./actions";

export interface ReservationMessage {
  id: string;
  channel: MessageChannel;
  message_type: MessageType;
  body: string;
  created_at: string;
  sender_name: string | null;
  mine: boolean;
  from_system: boolean;
}

const initialState: MessageActionState = { status: "idle" };
/** No realtime here: while a conversation is open the page is re-read so an answer shows up by itself. */
const REFRESH_MS = 10_000;

const ChatIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 12a8 8 0 0 1-8 8H4l1.8-3.2A8 8 0 1 1 21 12Z" />
    <path d="M8.5 12h.01M12.5 12h.01M16.5 12h.01" />
  </svg>
);

/**
 * The chat of a reservation: an icon that opens a small window, where the person picks who to talk to (the two other sides of the
 * reservation) and then talks to them. Each pair has its own private conversation (reservation_messages.channel, migration 0255).
 */
export function ReservationChat({
  reservationId,
  side,
  requesterName,
  messages,
  dict,
  locale,
}: {
  reservationId: string;
  side: ChatSide;
  requesterName: string | null;
  messages: ReservationMessage[];
  dict: Dictionary;
  locale: Locale;
}) {
  const t = dict.reservations.messages;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [channel, setChannel] = useState<MessageChannel | null>(null);
  const [reportingDelay, setReportingDelay] = useState(false);
  const [state, formAction, pending] = useActionState(postReservationMessage, initialState);
  const listRef = useRef<HTMLUListElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const otherLabel: Record<ChatSide, string> = { manager: t.chatManager, requester: t.chatRequester, security: t.chatSecurity };
  const targets = chatTargets(side);
  const target = targets.find((c) => c.channel === channel) ?? null;
  const visible = channel ? messages.filter((m) => m.channel === channel) : [];

  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (!open || !channel) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [open, channel, router]);

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [visible.length, channel, open]);

  useEffect(() => {
    if (state.status === "success") setReportingDelay(false);
  }, [state]);

  function pick(next: MessageChannel | null) {
    setChannel(next);
    setReportingDelay(false);
  }

  function onComposerKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      formRef.current?.requestSubmit();
    }
  }

  return (
    <>
      <button
        type="button"
        className="rd-chat-open"
        aria-label={t.chatOpen}
        title={t.chatOpen}
        aria-expanded={open}
        data-testid="reservation-chat-open"
        onClick={() => setOpen((o) => !o)}
      >
        <ChatIcon />
        {messages.length > 0 ? <span className="rd-chat-count">{messages.length}</span> : null}
      </button>

      {open ? (
        <section className="rd-chat" role="dialog" aria-label={target ? otherLabel[target.other] : t.chatOpen} data-testid="reservation-chat">
          <header className="rd-chat-head">
            {target ? (
              <button type="button" className="rd-chat-icon" aria-label={t.chatBack} title={t.chatBack} onClick={() => pick(null)}>
                ←
              </button>
            ) : null}
            <div className="rd-chat-title">
              <strong>{target ? otherLabel[target.other] : t.chatChoose}</strong>
              {target?.other === "requester" && requesterName ? <span>{requesterName}</span> : null}
            </div>
            <button type="button" className="rd-chat-icon" aria-label={t.chatClose} title={t.chatClose} onClick={() => setOpen(false)}>
              ×
            </button>
          </header>

          {!target ? (
            <ul className="rd-chat-targets">
              {targets.map((c) => {
                const count = messages.filter((m) => m.channel === c.channel).length;
                return (
                  <li key={c.channel}>
                    <button type="button" data-testid={`chat-target-${c.other}`} onClick={() => pick(c.channel)}>
                      <span className="rd-chat-target-name">
                        <strong>{otherLabel[c.other]}</strong>
                        {c.other === "requester" && requesterName ? <small>{requesterName}</small> : null}
                      </span>
                      {count > 0 ? <span className="rd-chat-count rd-chat-count-inline">{count}</span> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <>
              <ul ref={listRef} className="rd-chat-list" aria-live="polite">
                {visible.length === 0 ? (
                  <li className="rd-chat-empty">{t.chatEmptyWith}</li>
                ) : (
                  visible.map((m) => (
                    <li key={m.id} className="rd-chat-msg" data-mine={m.mine ? "true" : "false"}>
                      <div className="rd-chat-bubble">
                        <p className="break-user-text">{m.body}</p>
                      </div>
                      <small>
                        {m.mine ? t.chatYou : m.from_system ? t.systemSender : m.sender_name ?? otherLabel[target.other]}
                        {m.message_type === "text" ? "" : ` · ${t.types[m.message_type]}`} · {formatDateTime(m.created_at, locale)}
                      </small>
                    </li>
                  ))
                )}
              </ul>

              <form ref={formRef} action={formAction} className="rd-chat-form">
                <input type="hidden" name="reservationId" value={reservationId} />
                <input type="hidden" name="channel" value={target.channel} />
                <input type="hidden" name="messageType" value={reportingDelay ? "delay" : "text"} />
                {/* the one message with a real effect: a new return time marks the vehicle's next reservation as impacted */}
                {side === "requester" && target.other === "manager" ? (
                  reportingDelay ? (
                    <label className="rd-chat-delay">
                      <span>{t.newReturnTimeLabel}</span>
                      <input type="datetime-local" name="newExpectedReturnAt" className="fm-input" />
                      <small>{t.newReturnTimeHint}</small>
                    </label>
                  ) : (
                    <button type="button" className="rv-linkbtn" onClick={() => setReportingDelay(true)}>
                      {t.chatDelay}
                    </button>
                  )
                ) : null}
                {state.status === "error" ? (
                  <p role="alert" className="rd-chat-error">
                    {errorLabel(dict, state.error)}
                  </p>
                ) : null}
                <div className="rd-chat-compose">
                  <textarea
                    name="body"
                    required
                    rows={1}
                    autoFocus
                    aria-label={t.bodyPlaceholder}
                    placeholder={t.bodyPlaceholder}
                    className="fm-input"
                    onKeyDown={onComposerKey}
                    data-testid="reservation-chat-body"
                  />
                  <button type="submit" disabled={pending} className="fm-btn fm-btn-primary">
                    {pending ? t.sending : t.send}
                  </button>
                </div>
              </form>
            </>
          )}
        </section>
      ) : null}
    </>
  );
}
