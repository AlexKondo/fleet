"use client";

import { useState } from "react";
import { ConfirmSubmitButton } from "./ConfirmSubmitButton";

/**
 * The block reason is shown to the requesters whose reservations get displaced
 * (dashboard/page.tsx), so an empty reason isn't a fallback worth allowing from this
 * form — the button stays disabled until something is actually typed.
 */
export function BlockVehicleForm({
  action,
  confirmMessage,
  reasonLabel,
  reasonPlaceholder,
  blockLabel,
}: {
  action: (formData: FormData) => void;
  confirmMessage: string;
  reasonLabel: string;
  reasonPlaceholder: string;
  blockLabel: string;
}) {
  const [reason, setReason] = useState("");

  return (
    <form action={action} className="flex flex-col gap-2">
      <input
        type="text"
        name="reason"
        required
        maxLength={200}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        aria-label={reasonLabel}
        placeholder={reasonPlaceholder}
        className="w-full rounded-sm border border-line-800 bg-panel-900 px-2 py-1.5 text-xs text-paper-50 placeholder:text-fog-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-red"
      />
      <ConfirmSubmitButton
        confirmMessage={confirmMessage}
        disabled={reason.trim().length === 0}
        className="w-full rounded-sm border border-signal-red px-2.5 py-1.5 text-xs font-semibold uppercase tracking-widest text-signal-red hover:bg-signal-red/10 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
      >
        {blockLabel}
      </ConfirmSubmitButton>
    </form>
  );
}
