"use client";

import { useActionState } from "react";
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

export function UserRow({
  member,
  isSelf,
  dict,
}: {
  dict: Dictionary;
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
  const [roleState, roleAction, rolePending] = useActionState(updateUserRole, initialState);
  const [removeState, removeAction, removePending] = useActionState(removeUser, initialState);
  const [driverState, driverAction, driverPending] = useActionState(
    updateDriverAuthorization,
    initialState,
  );
  const t = dict.team.row;
  const roleOptions = getRoleOptions(dict);

  return (
    <tr className="border-b border-line-800 align-top last:border-0">
      <td className="min-w-0 px-4 py-3">
        <p className="truncate text-sm text-paper-50">{member.full_name}</p>
        <p className="truncate text-xs text-fog-400">{member.email}</p>
        {isSelf ? (
          <span className="text-xs uppercase tracking-widest text-fog-600">{t.you}</span>
        ) : null}
      </td>

      <td className="px-4 py-3">
        <form action={roleAction} className="flex items-center gap-2">
          <input type="hidden" name="userId" value={member.id} />
          <select
            name="role"
            defaultValue={member.role}
            disabled={isSelf}
            className="w-40 rounded-sm border border-line-800 bg-panel-800 px-2 py-1.5 text-sm text-paper-50 outline-none focus-visible:border-gwm-accent disabled:opacity-50"
          >
            {roleOptions.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
          {!isSelf ? (
            <button
              type="submit"
              disabled={rolePending}
              className="shrink-0 text-xs font-semibold uppercase tracking-widest text-gwm-accent hover:underline disabled:opacity-50"
            >
              {rolePending ? t.savingShort : dict.common.save}
            </button>
          ) : null}
        </form>
        {roleState.status === "error" ? (
          <p role="alert" className="mt-1 text-xs text-signal-red">
            {errorLabel(dict, roleState.error)}
          </p>
        ) : null}
      </td>

      <td className="px-4 py-3">
        <form action={driverAction} className="flex flex-col gap-1.5">
          <input type="hidden" name="userId" value={member.id} />
          <label className="flex items-center gap-1.5 text-xs text-fog-400">
            <input
              type="checkbox"
              name="driverAuthorized"
              defaultChecked={member.driver_authorized}
              className="h-3.5 w-3.5"
            />
            {t.driverAuthorized}
          </label>
          <div className="flex flex-wrap items-center gap-1.5">
            <input
              type="text"
              name="licenseNumber"
              placeholder={t.licenseNumberPlaceholder}
              defaultValue={member.drivers_license_number ?? ""}
              className="w-24 rounded-sm border border-line-800 bg-panel-800 px-1.5 py-1 font-mono text-xs text-paper-50 outline-none focus-visible:border-gwm-accent"
            />
            <input
              type="text"
              name="licenseCategory"
              placeholder={t.licenseCategoryPlaceholder}
              defaultValue={member.drivers_license_category ?? ""}
              className="w-14 rounded-sm border border-line-800 bg-panel-800 px-1.5 py-1 font-mono text-xs text-paper-50 outline-none focus-visible:border-gwm-accent"
            />
            <input
              type="date"
              name="licenseExpiration"
              defaultValue={member.drivers_license_expiration ?? ""}
              className="rounded-sm border border-line-800 bg-panel-800 px-1.5 py-1 font-mono text-xs text-paper-50 outline-none focus-visible:border-gwm-accent"
            />
            <button
              type="submit"
              disabled={driverPending}
              className="text-xs font-semibold uppercase tracking-widest text-gwm-accent hover:underline disabled:opacity-50"
            >
              {driverPending ? t.savingShort : dict.common.save}
            </button>
          </div>
        </form>
        {driverState.status === "error" ? (
          <p role="alert" className="mt-1 text-xs text-signal-red">
            {errorLabel(dict, driverState.error)}
          </p>
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
