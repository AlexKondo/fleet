"use client";

import { useActionState, useState } from "react";
import { MESSAGE_TYPE_LABELS, MESSAGE_TYPE_OPTIONS, type MessageType } from "@/lib/domain/messages";
import { postReservationMessage, type MessageActionState } from "./actions";

export interface ReservationMessage {
  id: string;
  message_type: MessageType;
  body: string;
  created_at: string;
  sender_name: string | null;
}

const initialState: MessageActionState = { status: "idle" };

const TYPE_BADGE_CLASSES: Record<MessageType, string> = {
  text: "border-line-700 text-fog-400",
  delay: "border-signal-yellow/40 text-signal-yellow",
  vehicle_issue: "border-signal-red/40 text-signal-red",
  return_time_change: "border-signal-blue/40 text-signal-blue",
  vehicle_not_found: "border-signal-red/40 text-signal-red",
  system_alert: "border-signal-violet/40 text-signal-violet",
};

export function MessageThread({
  reservationId,
  messages,
}: {
  reservationId: string;
  messages: ReservationMessage[];
}) {
  const [state, formAction, pending] = useActionState(postReservationMessage, initialState);
  const [messageType, setMessageType] = useState<MessageType>("text");

  return (
    <div className="flex flex-col gap-4">
      <ul className="flex max-h-80 flex-col gap-2 overflow-y-auto">
        {messages.length === 0 ? (
          <li className="text-sm text-fog-600">Nenhuma mensagem ainda.</li>
        ) : (
          messages.map((m) => (
            <li key={m.id} className="rounded-sm border border-line-800 bg-panel-800 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-paper-50">{m.sender_name ?? "Sistema"}</span>
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded-sm border px-1.5 py-0.5 text-[10px] uppercase tracking-widest ${TYPE_BADGE_CLASSES[m.message_type]}`}
                  >
                    {MESSAGE_TYPE_LABELS[m.message_type]}
                  </span>
                  <span className="text-[11px] text-fog-600">
                    {new Date(m.created_at).toLocaleString("pt-BR")}
                  </span>
                </div>
              </div>
              <p className="mt-1 text-sm text-fog-400">{m.body}</p>
            </li>
          ))
        )}
      </ul>

      <form action={formAction} className="flex flex-col gap-2 border-t border-line-800 pt-4">
        <input type="hidden" name="reservationId" value={reservationId} />
        <div className="flex flex-wrap gap-2">
          {MESSAGE_TYPE_OPTIONS.map((opt) => (
            <label key={opt.value} className="flex items-center gap-1.5 text-xs text-fog-400">
              <input
                type="radio"
                name="messageType"
                value={opt.value}
                checked={messageType === opt.value}
                onChange={() => setMessageType(opt.value)}
                className="h-3.5 w-3.5"
              />
              {opt.label}
            </label>
          ))}
        </div>

        {messageType === "delay" ? (
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium uppercase tracking-widest text-fog-400">
              Novo horário de retorno estimado
            </span>
            <input
              type="datetime-local"
              name="newExpectedReturnAt"
              className="rounded-sm border border-line-800 bg-panel-800 px-3 py-2 font-mono text-sm text-paper-50 outline-none focus-visible:border-signal-amber"
            />
            <span className="text-xs text-fog-600">
              Se preenchido, a próxima reserva deste veículo será marcada como impactada e o
              gestor de frota e o próximo solicitante serão notificados.
            </span>
          </label>
        ) : null}

        <textarea
          name="body"
          required
          rows={2}
          placeholder="Escreva uma mensagem…"
          className="rounded-sm border border-line-800 bg-panel-800 px-3 py-2 text-sm text-paper-50 outline-none focus-visible:border-signal-amber"
        />

        {state.status === "error" ? (
          <p role="alert" className="text-sm text-signal-red">
            {state.error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={pending}
          className="w-fit rounded-sm bg-signal-amber px-4 py-2 text-xs font-semibold uppercase tracking-widest text-ink-950 transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Enviando…" : "Enviar"}
        </button>
      </form>
    </div>
  );
}
