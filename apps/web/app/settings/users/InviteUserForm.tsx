"use client";

import { useActionState, useEffect, useRef } from "react";
import { inviteUser, type UserActionState } from "./actions";
import { getRoleOptions } from "./ROLE_LABELS";
import type { Dictionary } from "../../../lib/i18n/dictionaries";
import { errorLabel } from "@/lib/i18n/errorLabel";

const initialState: UserActionState = { status: "idle" };

export function InviteUserForm({ dict, onSaved }: { dict: Dictionary; onSaved?: () => void }) {
  const [state, formAction, pending] = useActionState(inviteUser, initialState);
  const formRef = useRef<HTMLFormElement>(null);
  const t = dict.team.invite;
  const roleOptions = getRoleOptions(dict);

  useEffect(() => {
    if (state.status === "success") {
      formRef.current?.reset();
      onSaved?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-widest text-fog-400">{t.nameLabel}</span>
          <input
            type="text"
            name="fullName"
            required
            placeholder={t.namePlaceholder}
            className="rounded-sm border border-line-800 bg-panel-900 px-3 py-2 text-sm text-paper-50 outline-none placeholder:text-fog-600 focus-visible:border-gwm-accent focus-visible:ring-1 focus-visible:ring-gwm-accent"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-widest text-fog-400">{t.emailLabel}</span>
          <input
            type="email"
            name="email"
            required
            placeholder={t.emailPlaceholder}
            className="rounded-sm border border-line-800 bg-panel-900 px-3 py-2 text-sm text-paper-50 outline-none placeholder:text-fog-600 focus-visible:border-gwm-accent focus-visible:ring-1 focus-visible:ring-gwm-accent"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-widest text-fog-400">
            {t.passwordLabel}
          </span>
          <input
            type="text"
            name="password"
            required
            minLength={8}
            placeholder={t.passwordPlaceholder}
            className="rounded-sm border border-line-800 bg-panel-900 px-3 py-2 text-sm text-paper-50 outline-none placeholder:text-fog-600 focus-visible:border-gwm-accent focus-visible:ring-1 focus-visible:ring-gwm-accent"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-widest text-fog-400">{t.roleLabel}</span>
          <select
            name="role"
            required
            defaultValue="employee"
            className="rounded-sm border border-line-800 bg-panel-800 px-3 py-2 text-sm text-paper-50 outline-none focus-visible:border-gwm-accent"
          >
            {roleOptions.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <p className="text-xs text-fog-600">{t.passwordHint}</p>

      {state.status === "error" ? (
        <p role="alert" className="text-sm text-signal-red">
          {errorLabel(dict, state.error)}
        </p>
      ) : null}
      {state.status === "success" ? (
        <p role="status" className="text-sm text-signal-teal">
          {t.success}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="self-start rounded-sm bg-gwm-accent px-4 py-2.5 text-sm font-semibold uppercase tracking-widest text-ink-950 transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {pending ? t.submitPending : t.submit}
      </button>
    </form>
  );
}
