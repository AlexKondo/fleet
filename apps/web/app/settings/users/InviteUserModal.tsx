"use client";

import { useEffect, useRef, useState } from "react";
import { InviteUserForm } from "./InviteUserForm";
import type { Dictionary } from "../../../lib/i18n/dictionaries";

/**
 * "Adicionar Usuário" used to be a form permanently open at the bottom of the page —
 * on a page whose main content (the member cards) already fills the screen, that read
 * as one more cluttered block rather than a deliberate action. Moved into a popup,
 * same trigger-then-reveal idea as Frota's AddVehicleSection/AddCategorySection/
 * AddLocationSection, except as an overlay instead of an inline panel since this form
 * has no natural list of its own to sit next to.
 */
export function InviteUserModal({ dict }: { dict: Dictionary }) {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    function handlePointerDown(event: MouseEvent) {
      if (dialogRef.current && !dialogRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-sm bg-signal-amber px-4 py-2.5 text-sm font-semibold uppercase tracking-widest text-ink-950 transition-opacity hover:opacity-90"
      >
        {dict.team.invite.trigger}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={dict.team.invite.dialogLabel}
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink-950/70 px-4 py-10 sm:items-center"
        >
          <div
            ref={dialogRef}
            className="w-full max-w-xl rounded-md border border-line-800 bg-panel-900 p-6 shadow-lg shadow-black/40"
          >
            <div className="mb-4 flex items-center justify-between">
              <p className="text-sm font-semibold uppercase tracking-widest text-fog-400">
                {dict.team.invite.modalTitle}
              </p>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={dict.common.close}
                className="flex h-7 w-7 items-center justify-center rounded-sm text-fog-400 hover:text-signal-red"
              >
                ✕
              </button>
            </div>
            <InviteUserForm dict={dict} onSaved={() => setOpen(false)} />
          </div>
        </div>
      ) : null}
    </>
  );
}
