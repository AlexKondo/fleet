"use client";

import { useActionState } from "react";
import { publishCarpoolPolicy, type CarpoolPolicyActionState } from "./carpoolPolicyActions";
import { fillTemplate } from "@/lib/carpool/errorText";
import { POLICY_BOUNDS } from "@/lib/carpool/policyInput";
import { formatDateTime } from "@/lib/formatDateTime";
import type { Locale } from "@/lib/i18n/locales";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import type { CarpoolPolicyConfig } from "@fleet/domain";

export interface PolicyVersionView {
  version: number;
  createdAt: string;
  values: CarpoolPolicyConfig;
}

const initialState: CarpoolPolicyActionState = { status: "idle" };
const numberInput =
  "w-28 rounded-sm border border-line-800 bg-panel-900 px-2 py-1.5 font-mono text-sm text-paper-50 outline-none focus-visible:border-gwm-accent";

/** Phase C5 (pack rule 11): current policy values + a form that publishes a NEW version, and a
 * short history. fleet_manager/administrator only (the /settings page itself is gated). */
export function CarpoolPolicySection({
  dict,
  locale,
  versions,
}: {
  dict: Dictionary;
  locale: Locale;
  /** newest first; empty when the org has no published version yet */
  versions: PolicyVersionView[];
}) {
  const t = dict.carpool.policy;
  const [state, action, pending] = useActionState(publishCarpoolPolicy, initialState);
  const current = versions[0];
  const v = current?.values;

  const check = (name: keyof CarpoolPolicyConfig, label: string, fallback: boolean) => (
    <label className="flex items-center gap-2 text-sm text-fog-400">
      <input type="checkbox" name={name} defaultChecked={v ? Boolean(v[name]) : fallback} className="h-4 w-4" />
      {label}
    </label>
  );
  const num = (name: keyof typeof POLICY_BOUNDS, label: string, fallback: number, step?: string) => (
    <label className="flex flex-col gap-1 text-xs text-fog-400">
      {label}
      <input
        type="number"
        name={name}
        required
        min={POLICY_BOUNDS[name].min}
        max={POLICY_BOUNDS[name].max}
        step={step ?? (POLICY_BOUNDS[name].integer ? 1 : "any")}
        defaultValue={v ? (v[name] as number) : fallback}
        className={numberInput}
      />
    </label>
  );

  return (
    <section data-testid="carpool-policy-section" className="mt-8 border-t border-line-800 pt-6">
      <h2 className="mb-1 text-lg font-semibold text-paper-50">{t.title}</h2>
      <p className="mb-1 text-xs text-fog-400">{t.description}</p>
      <p data-testid="carpool-policy-version" className="mb-4 text-xs text-fog-600">
        {current ? fillTemplate(t.currentVersion, { version: current.version }) : t.noVersionYet} · {t.newVersionHint}
      </p>

      <form key={current?.version ?? 0} action={action} className="flex max-w-3xl flex-col gap-4 rounded-md border border-line-800 bg-panel-900/60 p-5">
        <div className="grid gap-2 sm:grid-cols-2">
          {check("carpoolEnabled", t.carpoolEnabled, true)}
          {check("carpoolFirstEnabled", t.carpoolFirstEnabled, true)}
          {check("hostOptInRequired", t.hostOptInRequired, true)}
          {check("hostApprovalRequired", t.hostApprovalRequired, true)}
          {check("allowIntermediatePickup", t.allowIntermediatePickup, true)}
          {check("allowIntermediateDropoff", t.allowIntermediateDropoff, true)}
        </div>
        <div className="flex flex-wrap gap-4">
          {num("departureWindowMinutes", t.departureWindowMinutes, 15)}
          {num("returnWindowMinutes", t.returnWindowMinutes, 15)}
          {num("maxAdditionalDistanceKm", t.maxAdditionalDistanceKm, 5)}
          {num("maxAdditionalTimeMinutes", t.maxAdditionalTimeMinutes, 10)}
          {num("maxCandidatesForPreciseRouting", t.maxCandidatesForPreciseRouting, 5)}
          {num("requestExpiryMinutes", t.requestExpiryMinutes, 30)}
          {num("minimumSeatAvailability", t.minimumSeatAvailability, 1)}
        </div>

        {state.status === "success" ? (
          <p role="status" data-testid="carpool-policy-saved" className="text-sm text-signal-teal">
            {t.published} {state.version ? fillTemplate(t.versionLabel, { version: state.version }) : null}
          </p>
        ) : null}
        {state.status === "error" ? (
          <p role="alert" data-testid="carpool-policy-error" className="text-sm text-signal-red">
            {state.error === "invalid_values"
              ? t.invalidValues
              : state.error === "not_authorized"
                ? t.notAuthorized
                : state.error === "version_conflict"
                  ? t.versionConflict
                  : t.saveFailed}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={pending}
          className="self-start rounded-sm bg-gwm-accent px-4 py-2 text-xs font-semibold uppercase tracking-widest text-ink-950 hover:opacity-90 disabled:opacity-50"
        >
          {pending ? t.publishing : t.publish}
        </button>
      </form>

      {versions.length > 0 ? (
        <div className="mt-5 max-w-3xl">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-widest text-fog-400">{t.historyTitle}</h3>
          <ul data-testid="carpool-policy-history" className="flex flex-col gap-1.5">
            {versions.map((row) => (
              <li key={row.version} className="rounded-sm border border-line-800 bg-panel-900/60 px-3 py-2 text-xs text-fog-400">
                <span className="font-mono text-paper-50">{fillTemplate(t.versionLabel, { version: row.version })}</span>
                {" · "}
                {fillTemplate(t.publishedAt, { date: formatDateTime(row.createdAt, locale) })}
                {" · "}±{row.values.departureWindowMinutes} min · {row.values.maxAdditionalDistanceKm} km /{" "}
                {row.values.maxAdditionalTimeMinutes} min
                {!row.values.carpoolEnabled ? ` · ${t.carpoolEnabled}: ✗` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
