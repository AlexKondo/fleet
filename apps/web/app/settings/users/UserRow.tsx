"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import {
  removeUser,
  resetMemberLicense,
  saveMemberCustody,
  reactivateUser,
  updateDriverAuthorization,
  updateUserRole,
  updateWorkLocation,
  type UserActionState,
} from "./actions";
import { getRoleOptions } from "./ROLE_LABELS";
import { ConfirmSubmitButton } from "../../ConfirmSubmitButton";
import { FmKeyIcon, FmTrashIcon } from "../../fmIcons";
import { SubmitButton } from "../../ui/SubmitButton";
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
  workLocations = [],
  custody,
}: {
  dict: Dictionary;
  locale: Locale;
  /** false when list_member_licenses() failed: license/authorization controls are rendered disabled and carry NO fields. */
  licensesAvailable?: boolean;
  /** active corporate mobility points a member can be assigned to as their workplace */
  workLocations?: { id: string; name: string }[];
  /** the units this person can hold the keys of, and the ones they hold now */
  custody?: { units: { id: string; name: string; keyProcess: boolean }[]; unitIds: string[] };
  member: {
    id: string;
    full_name: string;
    email: string;
    role: string;
    enabled?: boolean | null;
    accessVersion?: number;
    accessRequestId?: string;
    work_location_id?: string | null;
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
  const [workState, workAction] = useActionState(updateWorkLocation, initialState);
  const workFormRef = useRef<HTMLFormElement>(null);
  // controlled: React 19 resets an uncontrolled <form action> select to its first default once the action settles (the choice looked lost)
  const [workLocationId, setWorkLocationId] = useState(member.work_location_id ?? "");
  const workSaved = useAutoSavedNotice(workState.status);
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

  const accessDialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (removeState.status === "success") accessDialogRef.current?.close();
  }, [removeState]);
  const [custodyState, custodyAction, custodyPending] = useActionState(saveMemberCustody, initialState);
  const custodyDialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (custodyState.status === "success") custodyDialogRef.current?.close();
  }, [custodyState]);

  const roleSaved = useAutoSavedNotice(roleState.status);
  const driverSaved = useAutoSavedNotice(driverState.status);
  const licenseSaved = useAutoSavedNotice(licenseState.status);

  const accountLabel = member.enabled === true ? t.accountActive : member.enabled === false ? t.accountInactive : t.accessUnavailable;
  const inactive = member.enabled === false;
  const accessLabel = inactive ? t.reactivate : t.deactivate;

  return (
    <tr className="border-b border-line-800 last:border-0">
      <td className="min-w-0 px-4 py-3" data-label={dict.team.columns.member}>
        <div className="us-who" data-inactive={inactive ? "" : undefined} title={accountLabel}>
          <span className="us-name truncate text-sm text-paper-50">{member.full_name}</span>
          <span className="us-email truncate text-xs text-fog-400" title={member.email}>{member.email}</span>
          <span className="sr-only">{accountLabel}</span>
        </div>
      </td>

      <td className="px-4 py-3" data-label={dict.team.columns.role}>
        <form ref={roleFormRef} action={roleAction}>
          <input type="hidden" name="userId" value={member.id} />
          <select
            name="role"
            aria-label={dict.team.columns.role}
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

      <td className="px-4 py-3" data-label={t.workLocationLabel}>
        <form ref={workFormRef} action={workAction}>
          <input type="hidden" name="userId" value={member.id} />
          <select
            name="workLocationId"
            aria-label={t.workLocationLabel}
            value={workLocationId}
            onChange={(e) => {
              setWorkLocationId(e.target.value);
              // submit after the state is applied, so the form carries the new value
              setTimeout(() => workFormRef.current?.requestSubmit(), 0);
            }}
            data-testid="work-location-select"
            className="w-40 rounded-sm border border-line-800 bg-panel-800 px-2 py-1.5 text-sm text-paper-50 outline-none focus-visible:border-gwm-accent"
          >
            <option value="">{t.workLocationNone}</option>
            {workLocations.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
        </form>
        {workState.status === "error" ? (
          <p role="alert" className="mt-1 text-xs text-signal-red">{errorLabel(dict, workState.error)}</p>
        ) : workSaved ? (
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
          <label className="flex items-center gap-1.5 text-xs text-fog-400" title={t.driverAuthorized}>
            <input
              type="checkbox"
              name="driverAuthorized"
              defaultChecked={member.driver_authorized}
              disabled={!licensesAvailable}
              onChange={() => driverFormRef.current?.requestSubmit()}
              className="h-3.5 w-3.5"
            />
            <span className="sr-only">{t.driverAuthorized}</span>
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
        <div className="us-cnh-line">
          <form ref={licenseFormRef} action={licenseAction} className="us-cnh">
            <input type="hidden" name="userId" value={member.id} />
            {/* M3: only the three license fields (never driver_authorized); disabled when the data did not load. */}
            <input type="hidden" name="intent" value="license" />
            <div className="us-field">
              <label htmlFor={`lic-num-${member.id}`} className="us-collapse text-[11px] font-medium text-fog-400">
                {t.licenseNumberLabel}
              </label>
              <input
                id={`lic-num-${member.id}`}
                type="text"
                title={t.licenseNumberLabel}
                disabled={!licensesAvailable || locked}
                aria-readonly={locked ? "true" : undefined}
                name="licenseNumber"
                placeholder={t.licenseNumberPlaceholder}
                defaultValue={member.drivers_license_number ?? ""}
                onBlur={() => licenseFormRef.current?.requestSubmit()}
                className="w-28 rounded-sm border border-line-800 bg-panel-800 px-1.5 py-1 font-mono text-xs text-paper-50 outline-none focus-visible:border-gwm-accent"
              />
            </div>
            <div className="us-field">
              <label htmlFor={`lic-cat-${member.id}`} className="us-collapse text-[11px] font-medium text-fog-400">
                {t.licenseCategoryLabel}
              </label>
              <input
                id={`lic-cat-${member.id}`}
                type="text"
                title={t.licenseCategoryLabel}
                name="licenseCategory"
                disabled={!licensesAvailable || locked}
                aria-readonly={locked ? "true" : undefined}
                placeholder={t.licenseCategoryPlaceholder}
                defaultValue={member.drivers_license_category ?? ""}
                onBlur={() => licenseFormRef.current?.requestSubmit()}
                className="w-16 rounded-sm border border-line-800 bg-panel-800 px-1.5 py-1 font-mono text-xs text-paper-50 outline-none focus-visible:border-gwm-accent"
              />
            </div>
            <div className="us-field">
              <label htmlFor={`lic-exp-${member.id}`} className="us-collapse text-[11px] font-medium text-fog-400">
                {t.licenseExpirationLabel}
              </label>
              <input
                id={`lic-exp-${member.id}`}
                type="date"
                title={t.licenseExpirationLabel}
                name="licenseExpiration"
                disabled={!licensesAvailable || locked}
                aria-readonly={locked ? "true" : undefined}
                defaultValue={member.drivers_license_expiration ?? ""}
                onChange={() => licenseFormRef.current?.requestSubmit()}
                className="rounded-sm border border-line-800 bg-panel-800 px-1.5 py-1 font-mono text-xs text-paper-50 outline-none focus-visible:border-gwm-accent"
              />
            </div>
          </form>
          {locked ? (
            <details className="us-lock" data-testid="license-locked">
              <summary title={t.licenseLockedHint} aria-label={t.licenseLockedHint}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="5" y="11" width="14" height="9" rx="2" />
                  <path d="M8 11V8a4 4 0 0 1 8 0v3" />
                </svg>
              </summary>
              <div className="us-lock-body">
                <p className="text-[11px] leading-snug text-fog-400">{t.licenseLockedHint}</p>
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
            </details>
          ) : null}
        </div>
        {licenseState.status === "error" ? (
          <p role="alert" className="mt-1 text-xs text-signal-red">
            {errorLabel(dict, licenseState.error)}
          </p>
        ) : licenseSaved ? (
          <p className="mt-1 text-xs text-signal-teal">{t.autoSaved}</p>
        ) : null}
      </td>

      <td className="px-4 py-3 text-right" data-label={dict.team.columns.action}>
        <div className="us-actions">
        {custody && custody.units.length > 0 ? (
          <>
            <button
              type="button"
              className="fm-btn fm-btn-ghost us-access"
              data-icon="key"
              data-on={custody.unitIds.length > 0 ? "" : undefined}
              title={t.custodyButton}
              aria-label={t.custodyButton}
              disabled={inactive}
              onClick={() => custodyDialogRef.current?.showModal()}
            >
              <FmKeyIcon />
            </button>
            <dialog ref={custodyDialogRef} className="us-dialog" aria-label={t.custodyButton} data-testid="member-custody-dialog">
              <form action={custodyAction}>
                <input type="hidden" name="userId" value={member.id} />
                <p>{t.custodyTitle.replace("{name}", member.full_name)}</p>
                <p className="text-xs text-fog-400">{t.custodyHint}</p>
                <div className="us-unit-list">
                  {custody.units.map((u) => (
                    <label key={u.id} className="us-unit">
                      <input type="hidden" name="offered" value={u.id} />
                      <input type="checkbox" name="unitIds" value={u.id} defaultChecked={custody.unitIds.includes(u.id)} />
                      <span>{u.name}</span>
                      {u.keyProcess ? null : <small>{t.custodyGate}</small>}
                    </label>
                  ))}
                </div>
                <label>
                  {t.reasonLabel}
                  <input name="reason" required minLength={3} maxLength={1000} />
                </label>
                {custodyState.status === "error" ? (
                  <p role="alert" className="text-xs text-signal-red">{custodyState.error}</p>
                ) : null}
                <div className="us-dialog-actions">
                  <button type="button" className="fm-btn fm-btn-ghost" onClick={() => custodyDialogRef.current?.close()}>
                    {dict.common.cancel}
                  </button>
                  <SubmitButton className="fm-btn fm-btn-primary" disabled={custodyPending} pendingLabel={t.savingShort}>
                    {t.custodySave}
                  </SubmitButton>
                </div>
              </form>
            </dialog>
          </>
        ) : null}
        {!isSelf ? (
          <>
            <button
              type="button"
              className="fm-btn fm-btn-ghost us-access"
              data-icon={inactive ? undefined : "trash"}
              title={accessLabel}
              aria-label={accessLabel}
              disabled={typeof member.enabled !== "boolean"}
              onClick={() => accessDialogRef.current?.showModal()}
            >
              {inactive ? t.reactivate : <FmTrashIcon />}
            </button>
            {/* The reason is required by fm_member_access_command, so it is asked here and not in the row. Deactivation keeps the account and its
                history; the database refuses to delete a member (0176). */}
            <dialog ref={accessDialogRef} className="us-dialog" aria-label={accessLabel} data-testid="member-access-dialog">
              <form action={removeAction}>
                <input type="hidden" name="userId" value={member.id} />
                <input type="hidden" name="accessVersion" value={member.accessVersion ?? ""} />
                <input type="hidden" name="requestId" value={member.accessRequestId ?? ""} />
                <p>{(inactive ? t.reactivateConfirm : t.removeConfirm).replace("{name}", member.full_name)}</p>
                <label>
                  {t.reasonLabel}
                  <input name="reason" required minLength={3} maxLength={1000} autoFocus />
                </label>
                {removeState.status === "error" ? (
                  <p role="alert" className="text-xs text-signal-red">
                    {accessErrorText(locale, removeState.error) ?? errorLabel(dict, removeState.error)}
                  </p>
                ) : null}
                <div className="us-dialog-actions">
                  <button type="button" className="fm-btn fm-btn-ghost" onClick={() => accessDialogRef.current?.close()}>
                    {dict.common.cancel}
                  </button>
                  <SubmitButton className="fm-btn fm-btn-primary" disabled={removePending} pendingLabel={t.savingShort}>
                    {accessLabel}
                  </SubmitButton>
                </div>
              </form>
            </dialog>
          </>
        ) : null}
        </div>
      </td>
    </tr>
  );
}
