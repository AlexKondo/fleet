"use client";

import { useActionState } from "react";
import { removeUser, updateUserRole, type UserActionState } from "./actions";
import { ROLE_OPTIONS } from "./ROLE_LABELS";
import { ConfirmSubmitButton } from "../../ConfirmSubmitButton";

const initialState: UserActionState = { status: "idle" };

export function UserRow({
  member,
  isSelf,
}: {
  member: { id: string; full_name: string; email: string; role: string };
  isSelf: boolean;
}) {
  const [roleState, roleAction, rolePending] = useActionState(updateUserRole, initialState);
  const [removeState, removeAction, removePending] = useActionState(removeUser, initialState);

  return (
    <tr className="border-b border-line-800 last:border-0 align-top">
      <td className="px-4 py-3 text-paper-50">{member.full_name}</td>
      <td className="px-4 py-3 text-fog-400">{member.email}</td>
      <td className="px-4 py-3">
        <form action={roleAction} className="flex items-center gap-2">
          <input type="hidden" name="userId" value={member.id} />
          <select
            name="role"
            defaultValue={member.role}
            disabled={isSelf}
            className="rounded-sm border border-line-800 bg-panel-800 px-2 py-1.5 text-sm text-paper-50 outline-none focus-visible:border-signal-amber disabled:opacity-50"
          >
            {ROLE_OPTIONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
          {!isSelf ? (
            <button
              type="submit"
              disabled={rolePending}
              className="text-xs font-semibold uppercase tracking-widest text-signal-amber hover:underline disabled:opacity-50"
            >
              {rolePending ? "…" : "Salvar"}
            </button>
          ) : null}
        </form>
        {roleState.status === "error" ? (
          <p role="alert" className="mt-1 text-xs text-signal-red">
            {roleState.error}
          </p>
        ) : null}
      </td>
      <td className="px-4 py-3">
        {isSelf ? (
          <span className="text-xs uppercase tracking-widest text-fog-600">Você</span>
        ) : (
          <form action={removeAction}>
            <input type="hidden" name="userId" value={member.id} />
            <ConfirmSubmitButton
              confirmMessage={`Remover ${member.full_name}? A pessoa perderá o acesso imediatamente.`}
              disabled={removePending}
              className="text-xs uppercase tracking-widest text-fog-400 hover:text-signal-red disabled:opacity-50"
            >
              {removePending ? "Removendo…" : "Remover"}
            </ConfirmSubmitButton>
          </form>
        )}
        {removeState.status === "error" ? (
          <p role="alert" className="mt-1 text-xs text-signal-red">
            {removeState.error}
          </p>
        ) : null}
      </td>
    </tr>
  );
}
