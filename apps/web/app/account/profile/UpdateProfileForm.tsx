"use client";

import { useActionState } from "react";
import { updateOwnProfile, type UpdateProfileState } from "./actions";
import { Button } from "../../ui/Button";
import type { Dictionary } from "../../../lib/i18n/dictionaries";

const initialState: UpdateProfileState = { status: "idle" };

export function UpdateProfileForm({
  dict,
  fullName,
  email,
}: {
  dict: Dictionary;
  fullName: string;
  email: string;
}) {
  const t = dict.account.profile;
  const [state, formAction, pending] = useActionState(updateOwnProfile, initialState);

  return (
    <form action={formAction} className="flex w-full flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium uppercase tracking-widest text-fog-400">{t.nameLabel}</span>
        <input
          type="text"
          name="fullName"
          required
          defaultValue={fullName}
          className="rounded-sm border border-line-800 bg-panel-900 px-3 py-2 text-sm text-paper-50 outline-none focus-visible:border-gwm-accent focus-visible:ring-1 focus-visible:ring-gwm-accent"
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium uppercase tracking-widest text-fog-400">{t.emailLabel}</span>
        <input
          type="email"
          value={email}
          disabled
          title={t.emailImmutableHint}
          className="rounded-sm border border-line-800 bg-panel-900 px-3 py-2 text-sm text-fog-600 outline-none disabled:opacity-70"
        />
      </label>

      {state.status === "error" ? (
        <p role="alert" className="text-sm text-signal-red">
          {state.error}
        </p>
      ) : null}
      {state.status === "success" ? (
        <p role="status" className="text-sm text-signal-teal">
          {t.success}
        </p>
      ) : null}

      <Button type="submit" disabled={pending} className="self-start">
        {pending ? dict.common.saving : t.submit}
      </Button>
    </form>
  );
}
