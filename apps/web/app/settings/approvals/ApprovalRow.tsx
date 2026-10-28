"use client";

import { useActionState, useState } from "react";
import { saveApprovalChannel, type ApprovalSaveState } from "./actions";

const initial: ApprovalSaveState = { status: "idle" };

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

export function ApprovalRow({ person, managerId, phone, consent, managedCount, email, managerOptions, T, statusKey }: ApprovalRowProps) {
  const [state, action, pending] = useActionState(saveApprovalChannel, initial);
  // Controlled fields: React 19 resets an uncontrolled <form action> once the action settles, which would wipe the typed number
  // after a validation error (e.g. consent not ticked yet).
  const [manager, setManager] = useState(managerId);
  const [number, setNumber] = useState(phone);
  const [agreed, setAgreed] = useState(consent);
  const formId = `approval-${person.id}`;
  const errorText = state.status === "error" ? (T[state.errorKey ?? "errUnknown"] ?? T.errUnknown) : null;
  return (
    <tr className="border-b border-line-800 align-top last:border-0" data-testid={`approval-row-${person.id}`}>
      <td className="px-3 py-3" data-label={T.colPerson}>
        <p className="text-sm text-paper-50">{person.name}</p>
        {managedCount > 0 ? <p className="text-xs text-fog-400">{T.statusIsManager!.replace("{count}", String(managedCount))}</p> : null}
        {managedCount > 0 && email ? <p className="text-xs text-fog-400" data-testid={`approval-email-${person.id}`}>{T.emailNote!.replace("{email}", email)}</p> : null}
      </td>
      <td className="px-3 py-3 text-sm text-fog-400" data-label={T.colRole}>{person.roleLabel}</td>
      <td className="px-3 py-3" data-label={T.colManager}>
        <select form={formId} name="managerId" value={manager} onChange={(e) => setManager(e.target.value)} className="fm-input" aria-label={`${T.colManager}: ${person.name}`}>
          <option value="">{T.noManager}</option>
          {managerOptions.filter((o) => o.id !== person.id).map((o) => (
            <option key={o.id} value={o.id}>{o.name}</option>
          ))}
        </select>
      </td>
      <td className="px-3 py-3" data-label={T.colWhatsapp}>
        <input form={formId} name="phone" value={number} onChange={(e) => setNumber(e.target.value)} inputMode="tel" autoComplete="off" maxLength={40} placeholder={T.whatsappPlaceholder} className="fm-input" aria-label={`${T.colWhatsapp}: ${person.name}`} />
        <p className="mt-1 text-xs text-fog-400">{T.whatsappHint}</p>
        <label className="mt-2 flex items-start gap-2 text-xs text-fog-400">
          <input form={formId} type="checkbox" name="consent" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5" />
          <span>{T.consentLabel}</span>
        </label>
      </td>
      <td className="px-3 py-3" data-label={T.colStatus}>
        <p className="text-xs text-fog-400">{T[statusKey]}</p>
        <form id={formId} action={action} className="mt-2">
          <input type="hidden" name="userId" value={person.id} />
          <input type="hidden" name="hadManager" value={managerId} />
          <input type="hidden" name="hadPhone" value={phone ? "1" : "0"} />
          <button type="submit" disabled={pending} className="fm-btn fm-btn-primary">{pending ? T.saving : T.save}</button>
        </form>
        {errorText ? <p role="alert" className="mt-1 text-xs text-signal-red">{errorText}</p> : null}
        {state.status === "success" ? <p role="status" className="mt-1 text-xs text-signal-teal">{T.saved}</p> : null}
      </td>
    </tr>
  );
}
