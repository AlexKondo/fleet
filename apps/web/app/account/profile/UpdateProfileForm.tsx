"use client";

import { useActionState, useState } from "react";
import { updateOwnProfile, type UpdateProfileState } from "./actions";
import { Button } from "../../ui/Button";
import type { Dictionary } from "../../../lib/i18n/dictionaries";

const initialState: UpdateProfileState = { status: "idle" };

/** "2033-06-29" -> "29-06-2033", same display convention as the CNH capture screen
 * (account/license/LicenseCaptureForm.tsx) — display only, never the stored value. */
function formatDateBR(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  return `${day}-${month}-${year}`;
}

export function UpdateProfileForm({
  dict,
  fullName,
  email,
  avatarUrl,
  license,
}: {
  dict: Dictionary;
  fullName: string;
  email: string;
  avatarUrl: string | null;
  /** null when no CNH has been read yet (account/license) — nothing to show. */
  license: { number: string; category: string | null; expirationDate: string | null } | null;
}) {
  const t = dict.account.profile;
  const tl = dict.account.license.readFields;
  const [state, formAction, pending] = useActionState(updateOwnProfile, initialState);
  const [preview, setPreview] = useState<string | null>(null);

  function handleAvatarPicked(file: File | undefined) {
    if (!file) return;
    setPreview(URL.createObjectURL(file));
  }

  return (
    <form action={formAction} className="flex w-full flex-col gap-4">
      <label className="flex flex-col items-center gap-2 self-center">
        <span className="relative flex h-20 w-20 items-center justify-center overflow-hidden rounded-full border border-line-800 bg-panel-800 text-lg font-semibold text-paper-50">
          {preview || avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- user-uploaded avatar, arbitrary origin
            <img src={preview ?? avatarUrl ?? undefined} alt="" className="h-full w-full object-cover" />
          ) : (
            fullName.trim().slice(0, 1).toUpperCase() || "?"
          )}
        </span>
        <input
          type="file"
          name="avatar"
          accept="image/*"
          className="sr-only"
          onChange={(e) => handleAvatarPicked(e.target.files?.[0])}
        />
        <span className="cursor-pointer text-xs font-semibold uppercase tracking-widest text-gwm-accent hover:opacity-80">
          {t.changeAvatar}
        </span>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium uppercase tracking-widest text-fog-400">{t.nameLabel}</span>
        <input
          type="text"
          name="fullName"
          required
          defaultValue={fullName}
          className="rounded-sm border border-line-800 bg-panel-900 px-3 py-2 text-sm text-paper-50 outline-none focus-visible:border-gwm-accent focus-visible:ring-1 focus-visible:ring-gwm-accent"
        />
        {license ? <p className="text-xs text-fog-600">{t.nameFromLicenseHint}</p> : null}
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

      {license ? (
        <div className="flex flex-col gap-2 rounded-sm border border-line-800 bg-panel-900/60 p-3">
          <p className="text-xs font-medium uppercase tracking-widest text-fog-400">{t.licenseSectionTitle}</p>
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="text-fog-400">{tl.number}</span>
            <span className="font-medium text-paper-50">{license.number}</span>
          </div>
          {license.category ? (
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="text-fog-400">{tl.category}</span>
              <span className="font-medium text-paper-50">{license.category}</span>
            </div>
          ) : null}
          {license.expirationDate ? (
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="text-fog-400">{tl.expirationDate}</span>
              <span className="font-medium text-paper-50">{formatDateBR(license.expirationDate)}</span>
            </div>
          ) : null}
        </div>
      ) : null}

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
