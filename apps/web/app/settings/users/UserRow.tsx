"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import {
  removeUser,
  resetMemberLicense,
  reactivateUser,
  updateDriverAuthorization,
  updateUserRole,
  type UserActionState,
} from "./actions";
import { getRoleOptions } from "./ROLE_LABELS";
import { ConfirmSubmitButton } from "../../ConfirmSubmitButton";
import type { Dictionary } from "../../../lib/i18n/dictionaries";
import { errorLabel } from "@/lib/i18n/errorLabel";
import { accessErrorText } from "@/lib/i18n/areas/settingsMisc";
import type { Locale } from "@/lib/i18n/locales";

const initialState: UserActionState = { status: "idle" };
const AUTO_SAVED_VISIBLE_MS = 2500;

/** Shows "Salvo automaticamente" for a couple seconds after `state` turns success, then
 * fades — used by every auto-submitting form group below instead of a Salvar button. */
function useAutoSavedNotice(status: UserActionState["status"]) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (status !== "success") return;
    setVisible(true);
    const timer = setTimeout(() => setVisible(false), AUTO_SAVED_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [status]);
  return visible;
}

export function UserRow({
  member,
  isSelf,
  dict,
  locale,
  licensesAvailable = true,
}: {
  dict: Dictionary;
  locale: Locale;
  /** false when list_member_licenses() failed: license/authorization controls are rendered disabled and carry NO fields. */
  licensesAvailable?: boolean;
  member: {
    id: string;
    full_name: string;
    email: string;
    role: string;
    enabled?: boolean | null;
    accessVersion?: number;
    accessRequestId?: string;
    driver_authorized: boolean;
    drivers_license_number: string | null;
    drivers_license_category: string | null;
    drivers_license_expiration: string | null;
    /** How the expiration got there (migration 0074); null = not recorded. */
    drivers_license_expiration_source: "ai" | "manual" | null;
  };
  isSelf: boolean;
}) {
  const [roleState, roleAction] = useActionState(updateUserRole, initialState);
  const [removeState, removeAction, removePending] = useActionState(member.enabled === false ? reactivateUser : removeUser, initialState);
  const [driverState, driverAction] = useActionState(updateDriverAuthorization, initialState);
  const [licenseState, licenseAction] = useActionState(updateDriverAuthorization, initialState);
  const [resetState, resetAction, resetPending] = useActionState(resetMemberLicense, initialState);
  // CNH read by AI is locked (anti-fraud, migration 0075): read-only here; only a new photo from the driver or an audited reset changes it.
  const locked = member.drivers_license_expiration_source === "ai";
  const t = dict.team.row;
  const roleOptions = getRoleOptions(dict);

  const roleFormRef = useRef<HTMLFormElement>(null);
  const driverFormRef = useRef<HTMLFormElement>(null);
  const licenseFormRef = useRef<HTMLFormElement>(null);

  const roleSaved = useAutoSavedNotice(roleState.status);
  const driverSaved = useAutoSavedNotice(driverState.status);
  const licenseSaved = useAutoSavedNotice(licenseState.status);

  return (
    <tr className="border-b border-line-800 align-top last:border-0">
      <td className="min-w-0 px-4 py-3" data-label={dict.team.columns.member}>
        <p className="truncate text-sm text-paper-50">{member.full_name}</p>
        <p className="truncate text-xs text-fog-400">{member.email}</p>
        <p className="text-xs text-fog-400">{member.enabled === true ? t.accountActive : member.enabled === false ? t.accountInactive : t.accessUnavailable}</p>
      </td>

      <td className="px-4 py-3" data-label={dict.team.columns.role}>
        <form ref={roleFormRef} action={roleAction}>
          <input type="hidden" name="userId" value={member.id} />
          <select
            name="role"
            defaultValue={member.role}
            disabled={isSelf}
            onChange={() => roleFormRef.current?.requestSubmit()}
            className="w-40 rounded-sm border border-line-800 bg-panel-800 px-2 py-1.5 text-sm text-paper-50 outline-none focus-visible:border-gwm-accent disabled:opacity-50"
          >
            {roleOptions.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </form>
        {roleState.status === "error" ? (
          <p role="alert" className="mt-1 text-xs text-signal-red">
            {errorLabel(dict, roleState.error)}
          </p>
        ) : roleSaved ? (
          <p className="mt-1 text-xs text-signal-teal">{t.autoSaved}</p>
        ) : null}
      </td>

      <td className="px-4 py-3" data-label={dict.team.columns.authorized}>
        <form ref={driverFormRef} action={driverAction}>
          <input type="hidden" name="userId" value={member.id} />
          {/* M3: this form carries ONLY the authorization field (never the license columns, which a failed
              license read would have turned into blanks); the server action writes only what it receives. */}
          <input type="hidden" name="intent" value="authorization" />
          <input type="hidden" name="authorizationSubmitted" value="1" />
          <label className="flex items-center gap-1.5 text-xs text-fog-400">
            <input
              type="checkbox"
              name="driverAuthorized"
              defaultChecked={member.driver_authorized}
              disabled={!licensesAvailable}
              onChange={() => driverFormRef.current?.requestSubmit()}
              className="h-3.5 w-3.5"
            />
            {t.driverAuthorized}
          </label>
        </form>
        {driverState.status === "error" ? (
          <p role="alert" className="mt-1 text-xs text-signal-red">
            {errorLabel(dict, driverState.error)}
          </p>
        ) : driverSaved ? (
          <p className="mt-1 text-xs text-signal-teal">{t.autoSaved}</p>
        ) : null}
      </td>

      <td className="px-4 py-3" data-label={dict.team.columns.license}>
        <form ref={licenseFormRef} action={licenseAction} className="flex flex-wrap items-start gap-x-2 gap-y-1.5">
          <input type="hidden" name="userId" value={member.id} />
          {/* M3: only the three license fields (never driver_authorized); disabled when the data did not load. */}
          <input type="hidden" name="intent" value="license" />
          <div className="flex flex-col gap-1">
            <label htmlFor={`lic-num-${member.id}`} className="text-[11px] font-medium text-fog-400">
              {t.licenseNumberLabel}
            </label>
            <input
              id={`lic-num-${member.id}`}
              type="text"
              disabled={!licensesAvailable || locked}
              aria-readonly={locked ? "true" : undefined}
              name="licenseNumber"
              placeholder={t.licenseNumberPlaceholder}
              defaultValue={member.drivers_license_number ?? ""}
              onBlur={() => licenseFormRef.current?.requestSubmit()}
              className="w-28 rounded-sm border border-line-800 bg-panel-800 px-1.5 py-1 font-mono text-xs text-paper-50 outline-none focus-visible:border-gwm-accent"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={`lic-cat-${member.id}`} className="text-[11px] font-medium text-fog-400">
              {t.licenseCategoryLabel}
            </label>
            <input
              id={`lic-cat-${member.id}`}
              type="text"
              name="licenseCategory"
              disabled={!licensesAvailable || locked}
              aria-readonly={locked ? "true" : undefined}
              placeholder={t.licenseCategoryPlaceholder}
              defaultValue={member.drivers_license_category ?? ""}
              onBlur={() => licenseFormRef.current?.requestSubmit()}
              className="w-16 rounded-sm border border-line-800 bg-panel-800 px-1.5 py-1 font-mono text-xs text-paper-50 outline-none focus-visible:border-gwm-accent"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={`lic-exp-${member.id}`} className="text-[11px] font-medium text-fog-400">
              {t.licenseExpirationLabel}
            </label>
            <input
              id={`lic-exp-${member.id}`}
              type="date"
              name="licenseExpiration"
              disabled={!licensesAvailable || locked}
              aria-readonly={locked ? "true" : undefined}
              defaultValue={member.drivers_license_expiration ?? ""}
              onChange={() => licenseFormRef.current?.requestSubmit()}
              aria-describedby={`lic-src-${member.id}`}
              className="rounded-sm border border-line-800 bg-panel-800 px-1.5 py-1 font-mono text-xs text-paper-50 outline-none focus-visible:border-gwm-accent"
            />
            <span
              id={`lic-src-${member.id}`}
              data-testid="license-source"
              data-source={member.drivers_license_expiration_source ?? "none"}
              className="inline-flex max-w-[14rem] items-center gap-1 rounded-sm border border-line-800 px-1.5 py-0.5 text-[11px] leading-tight text-fog-400"
            >
              <span aria-hidden="true">{member.drivers_license_expiration_source === "ai" ? "✦" : member.drivers_license_expiration_source === "manual" ? "✎" : "?"}</span>
              {member.drivers_license_expiration_source === "ai"
                ? t.licenseSourceAi
                : member.drivers_license_expiration_source === "manual"
                  ? t.licenseSourceManual
                  : t.licenseSourceUnknown}
            </span>
          </div>
        </form>
        {locked ? (
          <div className="mt-2 flex max-w-[17rem] flex-col gap-1.5" data-testid="license-locked">
            <p className="flex items-start gap-1.5 text-[11px] leading-snug text-fog-400">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true">
                <rect x="5" y="11" width="14" height="9" rx="2" />
                <path d="M8 11V8a4 4 0 0 1 8 0v3" />
              </svg>
              <span>{t.licenseLockedHint}</span>
            </p>
            {isSelf ? (
              <p className="text-[11px] leading-snug text-fog-400" data-testid="license-reset-self">
                {t.resetLicenseSelfHint}
              </p>
            ) : (
            <form action={resetAction} className="flex flex-col gap-1.5">
              <input type="hidden" name="userId" value={member.id} />
              <label htmlFor={`lic-reason-${member.id}`} className="text-[11px] font-medium text-fog-400">
                {t.resetLicenseReasonLabel}
              </label>
              <input
                id={`lic-reason-${member.id}`}
                name="reason"
                type="text"
                required
                minLength={5}
                maxLength={200}
                placeholder={t.resetLicenseReasonPlaceholder}
                className="rounded-sm border border-line-800 bg-panel-800 px-1.5 py-1 text-xs text-paper-50 outline-none focus-visible:border-gwm-accent"
              />
              <ConfirmSubmitButton
                confirmMessage={t.resetLicenseConfirm.replace("{name}", member.full_name)}
                pendingLabel={t.resetLicenseWorking}
                disabled={resetPending}
                className="min-h-[32px] rounded-sm border border-line-800 px-2 py-1 text-xs uppercase tracking-widest text-fog-400 hover:border-signal-red hover:text-signal-red disabled:opacity-50"
              >
                {t.resetLicense}
              </ConfirmSubmitButton>
            </form>
            )}
            {resetState.status === "error" ? (
              <p role="alert" className="text-xs text-signal-red">
                {errorLabel(dict, resetState.error)}
              </p>
            ) : null}
          </div>
        ) : null}
        {licenseState.status === "error" ? (
          <p role="alert" className="mt-1 text-xs text-signal-red">
            {errorLabel(dict, licenseState.error)}
          </p>
        ) : licenseSaved ? (
          <p className="mt-1 text-xs text-signal-teal">{t.autoSaved}</p>
        ) : null}
      </td>

      <td className="px-4 py-3 text-right" data-label={dict.team.columns.action}>
        {!isSelf ? (
          <form action={removeAction}>
            <input type="hidden" name="userId" value={member.id} />
            <input type="hidden" name="accessVersion" value={member.accessVersion ?? ""} />
            <input type="hidden" name="requestId" value={member.accessRequestId ?? ""} />
            <label className="block text-left text-xs text-fog-400">
              {t.reasonLabel}
              <input name="reason" required minLength={3} maxLength={1000} disabled={typeof member.enabled !== "boolean"} className="my-2 w-44 rounded-sm border border-line-800 bg-panel-800 px-2 py-1 text-paper-50" />
            </label>
            <ConfirmSubmitButton
              confirmMessage={(member.enabled === false ? t.reactivateConfirm : t.removeConfirm).replace("{name}", member.full_name)}
              disabled={removePending || typeof member.enabled !== "boolean"}
              className="text-xs uppercase tracking-widest text-fog-400 hover:text-signal-red disabled:opacity-50"
            >
              {removePending ? t.savingShort : member.enabled === false ? t.reactivate : t.deactivate}
            </ConfirmSubmitButton>
          </form>
        ) : null}
        {removeState.status === "error" ? (
          <p role="alert" className="mt-1 text-xs text-signal-red">
            {accessErrorText(locale, removeState.error) ?? errorLabel(dict, removeState.error)}
          </p>
        ) : null}
      </td>
    </tr>
  );
}
