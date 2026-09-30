"use client";

import { useActionState, useState, useTransition, type FormEvent } from "react";
import { confirmTrip, planTripAction, type PlanTripResult, type TripFormInput } from "./actions";
import { formatDateTime } from "@/lib/formatDateTime";
import type { Locale } from "@/lib/i18n/locales";
import type { Dictionary } from "../../../lib/i18n/dictionaries";

function toLocalInputValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const DRAFT_STORAGE_KEY = "fleet.trip-request-draft.v1";
// Only worth restoring if it's from moments ago (e.g. a stray remount right after
// submitting) — an old abandoned draft from a prior visit shouldn't reappear.
const DRAFT_MAX_AGE_MS = 5 * 60 * 1000;

interface TripRequestDraft {
  savedAt: number;
  fields: Record<string, string>;
}

function readDraft(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = sessionStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return {};
    const draft = JSON.parse(raw) as TripRequestDraft;
    if (Date.now() - draft.savedAt > DRAFT_MAX_AGE_MS) return {};
    return draft.fields ?? {};
  } catch {
    return {};
  }
}

function writeDraft(formData: FormData): void {
  try {
    const fields: Record<string, string> = {};
    for (const [key, value] of formData.entries()) {
      if (typeof value === "string") fields[key] = value;
    }
    const draft: TripRequestDraft = { savedAt: Date.now(), fields };
    sessionStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // sessionStorage unavailable (private browsing, disabled) — just skip persistence.
  }
}

function clearDraft(): void {
  try {
    sessionStorage.removeItem(DRAFT_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function TripRequestForm({ dict, locale }: { dict: Dictionary; locale: Locale }) {
  const t = dict.trips.request;
  const reasonLabel = (reason: string): string =>
    (dict.trips.reasons as Record<string, string>)[reason] ?? reason;
  const [plan, planAction, isPlanning] = useActionState<PlanTripResult | null, FormData>(
    planTripAction,
    null,
  );
  const [formInput, setFormInput] = useState<TripFormInput | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [isConfirming, startConfirming] = useTransition();
  // Read once, on mount — see writeDraft/readDraft: a defensive backstop against a stray
  // client-side remount losing whatever the user had just typed (matches feedback: form
  // fields reverting to today's date right after clicking "Buscar recomendação").
  const [draft] = useState(readDraft);

  function handleFormSubmit(e: FormEvent<HTMLFormElement>) {
    const formData = new FormData(e.currentTarget);
    writeDraft(formData);
    setFormInput({
      departureAt: new Date(String(formData.get("departureAt"))).toISOString(),
      expectedReturnAt: new Date(String(formData.get("expectedReturnAt"))).toISOString(),
      origin: String(formData.get("origin")),
      destination: String(formData.get("destination")),
      distanceKm: Number(formData.get("distanceKm")),
      passengerCount: Number(formData.get("passengerCount")),
      requiresCargo: formData.get("requiresCargo") === "on",
      justification: String(formData.get("justification")),
      allowCarpool: formData.get("allowCarpool") === "on",
    });
    setConfirmError(null);
  }

  function handleConfirm(targetId?: string) {
    if (!formInput || !plan) return;
    const resolvedTargetId = targetId ?? (plan.type === "vehicle" ? plan.vehicle?.vehicleId : undefined);
    if (!resolvedTargetId || plan.type === "none") return;

    startConfirming(async () => {
      const result = await confirmTrip({
        ...formInput,
        choice: plan.type as "carpool" | "vehicle",
        targetId: resolvedTargetId,
      });
      // On success confirmTrip redirects server-side, so this line is rarely reached —
      // best-effort only, the 5-minute TTL in readDraft is the real backstop.
      if (result.success) {
        clearDraft();
      } else {
        setConfirmError(result.error ?? "unknown_error");
      }
    });
  }

  const now = new Date();
  const defaultDeparture =
    draft.departureAt ?? toLocalInputValue(new Date(now.getTime() + 60 * 60 * 1000).toISOString());
  const defaultReturn =
    draft.expectedReturnAt ?? toLocalInputValue(new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString());

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <form
        action={planAction}
        onSubmit={handleFormSubmit}
        className="flex flex-col gap-4 rounded-md border border-line-800 bg-panel-900/60 p-6"
      >
        <div className="grid grid-cols-2 gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium uppercase tracking-widest text-fog-400">{t.departureLabel}</span>
            <input
              type="datetime-local"
              name="departureAt"
              required
              defaultValue={defaultDeparture}
              className="rounded-sm border border-line-800 bg-panel-800 px-3 py-2 font-mono text-sm text-paper-50 outline-none focus-visible:border-gwm-accent"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium uppercase tracking-widest text-fog-400">
              {t.expectedReturnLabel}
            </span>
            <input
              type="datetime-local"
              name="expectedReturnAt"
              required
              defaultValue={defaultReturn}
              className="rounded-sm border border-line-800 bg-panel-800 px-3 py-2 font-mono text-sm text-paper-50 outline-none focus-visible:border-gwm-accent"
            />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium uppercase tracking-widest text-fog-400">{t.originLabel}</span>
            <input
              name="origin"
              required
              defaultValue={draft.origin ?? "Iracemápolis"}
              className="rounded-sm border border-line-800 bg-panel-800 px-3 py-2 text-sm text-paper-50 outline-none focus-visible:border-gwm-accent"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium uppercase tracking-widest text-fog-400">{t.destinationLabel}</span>
            <input
              name="destination"
              required
              defaultValue={draft.destination}
              placeholder={t.destinationPlaceholder}
              className="rounded-sm border border-line-800 bg-panel-800 px-3 py-2 text-sm text-paper-50 outline-none focus-visible:border-gwm-accent"
            />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium uppercase tracking-widest text-fog-400">
              {t.distanceLabel}
            </span>
            <input
              type="number"
              name="distanceKm"
              required
              min={1}
              defaultValue={draft.distanceKm ?? 100}
              className="rounded-sm border border-line-800 bg-panel-800 px-3 py-2 font-mono text-sm text-paper-50 outline-none focus-visible:border-gwm-accent"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium uppercase tracking-widest text-fog-400">
              {t.passengersLabel}
            </span>
            <input
              type="number"
              name="passengerCount"
              required
              min={1}
              defaultValue={draft.passengerCount ?? 1}
              className="rounded-sm border border-line-800 bg-panel-800 px-3 py-2 font-mono text-sm text-paper-50 outline-none focus-visible:border-gwm-accent"
            />
          </label>
        </div>

        <label className="flex items-center gap-2 text-sm text-fog-400">
          <input
            type="checkbox"
            name="requiresCargo"
            defaultChecked={draft.requiresCargo === "on"}
            className="h-4 w-4"
          />
          {t.cargoLabel}
        </label>

        <label className="flex items-center gap-2 text-sm text-fog-400">
          <input
            type="checkbox"
            name="allowCarpool"
            defaultChecked={draft.allowCarpool !== undefined ? draft.allowCarpool === "on" : true}
            className="h-4 w-4"
          />
          {t.allowCarpoolLabel}
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-widest text-fog-400">
            {t.justificationLabel}
          </span>
          <textarea
            name="justification"
            required
            rows={3}
            defaultValue={draft.justification}
            className="rounded-sm border border-line-800 bg-panel-800 px-3 py-2 text-sm text-paper-50 outline-none focus-visible:border-gwm-accent"
          />
        </label>

        <button
          type="submit"
          disabled={isPlanning}
          className="mt-2 rounded-sm bg-gwm-accent px-4 py-2.5 text-sm font-semibold uppercase tracking-widest text-ink-950 transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {isPlanning ? t.submitPending : t.submit}
        </button>
      </form>

      <div className="rounded-md border border-line-800 bg-panel-900/60 p-6">
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-fog-400">
          {t.recommendationTitle}
        </h2>

        {!plan ? (
          <p className="text-sm text-fog-600">{t.emptyState}</p>
        ) : plan.error ? (
          <p className="text-sm text-signal-red">{t.planError}</p>
        ) : plan.type === "carpool" && plan.carpoolOptions && plan.carpoolOptions.length > 0 ? (
          <div className="flex flex-col gap-4">
            <p className="text-xs uppercase tracking-widest text-signal-teal">
              {plan.carpoolOptions.length > 1
                ? t.carpoolsCompatible.replace("{count}", String(plan.carpoolOptions.length))
                : t.carpoolAvailable}
            </p>
            {plan.carpoolOptions.length > 1 ? (
              <p className="text-xs text-fog-600">{t.carpoolMatchNote}</p>
            ) : null}
            <ul className="flex flex-col gap-3">
              {plan.carpoolOptions.map((option) => (
                <li
                  key={option.reservationId}
                  className="rounded-sm border border-signal-teal/40 bg-signal-teal/10 p-4"
                >
                  <p className="font-mono text-lg text-paper-50">{option.vehiclePlate}</p>
                  <p className="mt-1 text-sm text-fog-400">
                    {t.carpoolSchedule
                      .replace("{departure}", formatDateTime(option.departureAt, locale))
                      .replace("{returnAt}", formatDateTime(option.expectedReturnAt, locale))}
                  </p>
                  <button
                    onClick={() => handleConfirm(option.reservationId)}
                    disabled={isConfirming}
                    className="mt-3 rounded-sm bg-signal-teal px-4 py-2 text-sm font-semibold uppercase tracking-widest text-ink-950 transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    {isConfirming ? t.confirming : t.acceptCarpool}
                  </button>
                </li>
              ))}
            </ul>
            <ul className="flex flex-col gap-1 text-sm text-fog-400">
              {plan.reasons.map((r) => (
                <li key={r}>• {reasonLabel(r)}</li>
              ))}
            </ul>
          </div>
        ) : plan.type === "vehicle" && plan.vehicle ? (
          <div className="flex flex-col gap-4">
            <div className="rounded-sm border border-signal-blue/40 bg-signal-blue/10 p-4">
              <p className="text-xs uppercase tracking-widest text-signal-blue">{t.recommendedVehicle}</p>
              <p className="mt-1 font-mono text-lg text-paper-50">{plan.vehicle.plate}</p>
              <p className="mt-1 text-sm text-fog-400">{plan.vehicle.categoryName}</p>
            </div>
            <ul className="flex flex-col gap-1 text-sm text-fog-400">
              {plan.vehicle.reasons.map((r) => (
                <li key={r}>• {reasonLabel(r)}</li>
              ))}
            </ul>
            {plan.vehicle.requiredPreparation && plan.vehicle.requiredPreparation.length > 0 ? (
              <p className="text-xs text-gwm-accent">
                {t.preparationNote}
              </p>
            ) : null}
            {plan.vehicle.trafficRestriction?.restricted ? (
              <div className="rounded-sm border border-gwm-accent/40 bg-gwm-accent/10 p-4">
                <p className="text-xs uppercase tracking-widest text-gwm-accent">
                  {t.trafficRestrictionTitle}
                </p>
                <p className="mt-1 text-sm text-fog-400">
                  {t.trafficRestrictionBody}
                </p>
              </div>
            ) : null}
            <button
              onClick={() => handleConfirm(plan.vehicle!.vehicleId)}
              disabled={isConfirming}
              className="rounded-sm bg-signal-blue px-4 py-2.5 text-sm font-semibold uppercase tracking-widest text-ink-950 transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {isConfirming ? t.confirming : t.requestReservation}
            </button>

            {plan.vehicle.alternatives.length > 0 ? (
              <div className="flex flex-col gap-3 border-t border-line-800 pt-4">
                <p className="text-xs uppercase tracking-widest text-fog-400">
                  {plan.bookingMode === "user_choice"
                    ? t.otherEligibleVehicles
                    : t.preferAnotherVehicle}
                </p>
                <ul className="flex flex-col gap-2">
                  {plan.vehicle.alternatives.map((alt) => (
                    <li
                      key={alt.vehicleId}
                      className="flex items-center justify-between gap-3 rounded-sm border border-line-800 bg-panel-800 px-3 py-2.5"
                    >
                      <div>
                        <p className="font-mono text-sm text-paper-50">{alt.plate}</p>
                        <p className="text-xs text-fog-600">{alt.categoryName}</p>
                      </div>
                      <button
                        onClick={() => handleConfirm(alt.vehicleId)}
                        disabled={isConfirming}
                        className="shrink-0 rounded-sm border border-line-700 px-3 py-1.5 text-xs font-semibold uppercase tracking-widest text-fog-400 hover:border-signal-blue hover:text-signal-blue disabled:opacity-50"
                      >
                        {t.choose}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-signal-red">
              {t.noOptions}
            </p>
            <ul className="flex flex-col gap-1 text-sm text-fog-400">
              {plan.reasons.map((r) => (
                <li key={r}>• {reasonLabel(r)}</li>
              ))}
            </ul>
          </div>
        )}

        {confirmError ? (
          <p role="alert" className="mt-4 text-sm text-signal-red">
            {confirmError === "RESERVATION_CONFLICT"
              ? t.reservationConflict
              : confirmError === "plan_changed"
                ? t.planChanged
                : t.confirmError.replace("{code}", confirmError)}
          </p>
        ) : null}
      </div>
    </div>
  );
}
