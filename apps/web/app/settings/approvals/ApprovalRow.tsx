"use client";

import { useEffect, useRef, useState } from "react";
import { saveApprovalChannel } from "./actions";

export interface ApprovalRowProps {
  person: { id: string; name: string; roleLabel: string };
  managerId: string;
  phone: string;
  consent: boolean;
  managedCount: number;
  /** the person's account e-mail (shown when they are somebody's manager: where the e-mail request goes) */
  email: string;
  managerOptions: { id: string; name: string }[];
  /** resolved texts (area `approvals`) */
  T: Record<string, string>;
  statusKey: "statusReady" | "statusNoManager" | "statusManagerNoPhone";
}

type Field = "manager" | "phone" | "consent";
/** The number is saved this long after the person stops typing; the manager and the consent box are saved as soon as they are changed. */
const TYPING_PAUSE_MS = 2000;
const NOTE_MS = 4000;

/** Every field saves by itself. What the person typed is never cleared: the fields are controlled and the server answer only adds a note. */
export function ApprovalRow({ person, managerId, phone, consent, managedCount, email, managerOptions, T, statusKey }: ApprovalRowProps) {
  const [manager, setManager] = useState(managerId);
  const [number, setNumber] = useState(phone);
  const [agreed, setAgreed] = useState(consent);
  const [note, setNote] = useState<{ field: Field; kind: "saved" | "error"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  // what the server already has: the action writes only what differs from it
  const saved = useRef({ manager: managerId, phone });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); if (noteTimer.current) clearTimeout(noteTimer.current); }, []);

  async function save(field: Field, values: { manager: string; phone: string; consent: boolean }) {
    // the number cannot be stored without the person's consent: say so under the field instead of failing silently
    setSaving(true);
    const form = new FormData();
    form.set("userId", person.id);
    form.set("managerId", values.manager);
    form.set("phone", values.phone);
    if (values.consent) form.set("consent", "on");
    form.set("hadManager", saved.current.manager);
    form.set("hadPhone", saved.current.phone.trim() ? "1" : "0");
    let result: Awaited<ReturnType<typeof saveApprovalChannel>>;
    try {
      result = await saveApprovalChannel({ status: "idle" }, form);
    } catch {
      result = { status: "error", errorKey: "errUnknown" };
    }
    setSaving(false);
    if (noteTimer.current) clearTimeout(noteTimer.current);
    if (result.status === "success") {
      saved.current = { manager: values.manager, phone: values.phone };
      setNote({ field, kind: "saved", text: T.fieldSaved ?? "" });
      noteTimer.current = setTimeout(() => setNote(null), NOTE_MS);
    } else {
      setNote({ field, kind: "error", text: T[result.errorKey ?? "errUnknown"] ?? T.errUnknown ?? "" });
    }
  }

  const noteFor = (field: Field) =>
    note?.field === field ? (
      note.kind === "saved"
        ? <p role="status" className="mt-1 text-xs text-signal-teal" data-testid={`approval-saved-${field}-${person.id}`}>{note.text}</p>
        : <p role="alert" className="mt-1 text-xs text-signal-red">{note.text}</p>
    ) : null;

  return (
    <tr className="border-b border-line-800 align-top last:border-0" data-testid={`approval-row-${person.id}`}>
      <td className="px-3 py-3" data-label={T.colPerson}>
        <p className="text-sm text-paper-50">{person.name}</p>
        {managedCount > 0 ? <p className="text-xs text-fog-400">{T.statusIsManager!.replace("{count}", String(managedCount))}</p> : null}
        {managedCount > 0 && email ? <p className="text-xs text-fog-400" data-testid={`approval-email-${person.id}`}>{T.emailNote!.replace("{email}", email)}</p> : null}
      </td>
      <td className="px-3 py-3 text-sm text-fog-400" data-label={T.colRole}>{person.roleLabel}</td>
      <td className="px-3 py-3" data-label={T.colManager}>
        <select
          name="managerId"
          value={manager}
          onChange={(e) => {
            const next = e.target.value;
            setManager(next);
            void save("manager", { manager: next, phone: number, consent: agreed });
          }}
          className="fm-input min-w-[18rem]"
          aria-label={`${T.colManager}: ${person.name}`}
        >
          <option value="">{T.noManager}</option>
          {managerOptions.filter((o) => o.id !== person.id).map((o) => (
            <option key={o.id} value={o.id}>{o.name}</option>
          ))}
        </select>
        {noteFor("manager")}
      </td>
      <td className="px-3 py-3" data-label={T.colWhatsapp}>
        <input
          name="phone"
          value={number}
          onChange={(e) => {
            const next = e.target.value;
            setNumber(next);
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => void save("phone", { manager, phone: next, consent: agreed }), TYPING_PAUSE_MS);
          }}
          inputMode="tel"
          autoComplete="off"
          maxLength={40}
          placeholder={T.whatsappPlaceholder}
          className="fm-input"
          aria-label={`${T.colWhatsapp}: ${person.name}`}
        />
        <p className="mt-1 text-xs text-fog-400">{T.whatsappHint}</p>
        {noteFor("phone")}
        <label className="mt-2 flex items-start gap-2 text-xs text-fog-400">
          <input
            type="checkbox"
            name="consent"
            checked={agreed}
            onChange={(e) => {
              const next = e.target.checked;
              setAgreed(next);
              if (timer.current) clearTimeout(timer.current);
              void save("consent", { manager, phone: number, consent: next });
            }}
            className="mt-0.5"
          />
          <span>{T.consentLabel}</span>
        </label>
        {noteFor("consent")}
      </td>
      <td className="px-3 py-3" data-label={T.colStatus}>
        <p className="text-xs text-fog-400">{T[statusKey]}</p>
        {saving ? <p className="mt-1 text-xs text-fog-400" aria-live="polite">{T.saving}</p> : null}
      </td>
    </tr>
  );
}
