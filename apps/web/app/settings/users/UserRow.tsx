"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import {
  removeUser,
  updateDriverAuthorization,
  updateUserRole,
  type UserActionState,
} from "./actions";
import { getRoleOptions } from "./ROLE_LABELS";
import { ConfirmSubmitButton } from "../../ConfirmSubmitButton";
import type { Dictionary } from "../../../lib/i18n/dictionaries";
import { errorLabel } from "@/lib/i18n/errorLabel";

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
  licensesAvailable = true,
}: {
  dict: Dictionary;
  /** false when list_member_licenses() failed: license/authorization controls are rendered disabled and carry NO fields. */
  licensesAvailable?: boolean;
  member: {
    id: string;
    full_name: string;
    email: string;
    role: string;
    driver_authorized: boolean;
    drivers_license_number: string | null;
    drivers_license_category: string | null;
    drivers_license_expiration: string | null;
  };
  isSelf: boolean;
}) {
  const [roleState, roleAction] = useActionState(updateUserRole, initialState);
  const [removeState, removeAction, removePending] = useActionState(removeUser, initialState);
  const [driverState, driverAction] = useActionState(updateDriverAuthorization, initialState);
  const [licenseState, licenseAction] = useActionState(updateDriverAuthorization, initialState);
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
      <td className="min-w-0 px-4 py-3">
        <p className="truncate text-sm text-paper-50">{member.full_name}</p>
        <p className="truncate text-xs text-fog-400">{member.email}</p>
      </td>

      <td className="px-4 py-3">
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

      <td className="px-4 py-3">
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

      <td className="px-4 py-3">
        <form ref={licenseFormRef} action={licenseAction} className="flex items-center gap-1.5">
          <input type="hidden" name="userId" value={member.id} />
          {/* M3: only the three license fields (never driver_authorized); disabled when the data did not load. */}
          <input type="hidden" name="intent" value="license" />
          <input
            type="text"
            disabled={!licensesAvailable}
            name="licenseNumber"
            placeholder={t.licenseNumberPlaceholder}
            defaultValue={member.drivers_license_number ?? ""}
            onBlur={() => licenseFormRef.current?.requestSubmit()}
            className="w-24 rounded-sm border border-line-800 bg-panel-800 px-1.5 py-1 font-mono text-xs text-paper-50 outline-none focus-visible:border-gwm-accent"
          />
          <input
            type="text"
            name="licenseCategory"
            disabled={!licensesAvailable}
            placeholder={t.licenseCategoryPlaceholder}
            defaultValue={member.drivers_license_category ?? ""}
            onBlur={() => licenseFormRef.current?.requestSubmit()}
            className="w-14 rounded-sm border border-line-800 bg-panel-800 px-1.5 py-1 font-mono text-xs text-paper-50 outline-none focus-visible:border-gwm-accent"
          />
          <input
            type="date"
            name="licenseExpiration"
            disabled={!licensesAvailable}
            defaultValue={member.drivers_license_expiration ?? ""}
            onChange={() => licenseFormRef.current?.requestSubmit()}
            className="rounded-sm border border-line-800 bg-panel-800 px-1.5 py-1 font-mono text-xs text-paper-50 outline-none focus-visible:border-gwm-accent"
          />
        </form>
        {licenseState.status === "error" ? (
          <p role="alert" className="mt-1 text-xs text-signal-red">
            {errorLabel(dict, licenseState.error)}
          </p>
        ) : licenseSaved ? (
          <p className="mt-1 text-xs text-signal-teal">{t.autoSaved}</p>
        ) : null}
      </td>

      <td className="px-4 py-3 text-right">
        {!isSelf ? (
          <form action={removeAction}>
            <input type="hidden" name="userId" value={member.id} />
            <ConfirmSubmitButton
              confirmMessage={t.removeConfirm.replace("{name}", member.full_name)}
              disabled={removePending}
              className="text-xs uppercase tracking-widest text-fog-400 hover:text-signal-red disabled:opacity-50"
            >
              {removePending ? t.removing : dict.common.remove}
            </ConfirmSubmitButton>
          </form>
        ) : null}
        {removeState.status === "error" ? (
          <p role="alert" className="mt-1 text-xs text-signal-red">
            {errorLabel(dict, removeState.error)}
          </p>
        ) : null}
      </td>
    </tr>
  );
}
