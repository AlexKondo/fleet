"use client";

import { useActionState, useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { confirmTrip, planTripAction, type PlanTripResult, type TripFormInput } from "./actions";
import { formatDateTime } from "@/lib/formatDateTime";
import type { Locale } from "@/lib/i18n/locales";
import type { Dictionary } from "../../../lib/i18n/dictionaries";
import type { CarpoolGating } from "@/lib/carpool/carpoolFirst";
import { fillTemplate } from "@/lib/carpool/errorText";
import { CarpoolFirstPanel } from "./CarpoolFirstPanel";

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

export function TripRequestForm({
  dict,
  locale,
  carpoolMode,
}: {
  dict: Dictionary;
  locale: Locale;
  /** Phase C5: org carpool policy as seen by the server (page.tsx). `newEngine` hides the old
   * allow_carpool checkbox (the Yes/No host step is then the only carpool question). */
  carpoolMode: CarpoolGating;
}) {
  const t = dict.trips.request;
  const ct = dict.carpool.newTrip;
  const reasonLabel = (reason: string): string =>
    (dict.trips.reasons as Record<string, string>)[reason] ?? reason;
  const [plan, planAction, isPlanning] = useActionState<PlanTripResult | null, FormData>(
    planTripAction,
    null,
  );
  const formRef = useRef<HTMLFormElement>(null);
  const [formInput, setFormInput] = useState<TripFormInput | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [isConfirming, startConfirming] = useTransition();
  // Read once, on mount — see writeDraft/readDraft: a defensive backstop against a stray
  // client-side remount losing whatever the user had just typed (matches feedback: form
  // fields reverting to today's date right after clicking "Buscar recomendação").
  const [draft] = useState(readDraft);
  // Phase C5: UI state that belongs to ONE plan result. React's "adjust state when a prop/value
  // changes" pattern: whenever a NEW plan arrives the reveal flag and the host's seat choice
  // reset (no effect, no stale flash).
  const [trackedPlan, setTrackedPlan] = useState(plan);
  const [vehicleRevealed, setVehicleRevealed] = useState(false);
  const [offer, setOffer] = useState<{ choice: "yes" | "no"; seats: string }>({ choice: "no", seats: "" });
  if (plan !== trackedPlan) {
    setTrackedPlan(plan);
    setVehicleRevealed(false);
    setOffer({ choice: "no", seats: "" });
  }
  const carpoolFirst = plan && !plan.error ? plan.carpoolFirst : undefined;
  // The vehicle result follows automatically unless carpool-first has offers to decide on or is
  // asking for a more precise place; the rider can always continue with a click.
  const vehicleVisible =
    !carpoolFirst ||
    carpoolFirst.status === "none" ||
    carpoolFirst.status === "unavailable" ||
    vehicleRevealed;
  const hostStepEnabled = Boolean(plan?.carpoolGating?.hostStep);

  // React 19 resets an uncontrolled <form action> to its defaults once the action settles. The
  // carpool clarification prompt asks the rider to "adjust the field and search again", so after
  // each result the LAST SUBMITTED values are put back (otherwise every search would wipe the
  // trip and the rider would have to retype everything). Runs after the reset has been applied.
  useEffect(() => {
    const form = formRef.current;
    if (!plan || !formInput || !form) return;
    const set = (name: string, value: string) => {
      const el = form.elements.namedItem(name);
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) el.value = value;
    };
    set("departureAt", toLocalInputValue(formInput.departureAt));
    set("expectedReturnAt", toLocalInputValue(formInput.expectedReturnAt));
    set("origin", formInput.origin);
    set("destination", formInput.destination);
    set("distanceKm", String(formInput.distanceKm));
    set("passengerCount", String(formInput.passengerCount));
    set("justification", formInput.justification);
    const cargo = form.elements.namedItem("requiresCargo");
    if (cargo instanceof HTMLInputElement) cargo.checked = formInput.requiresCargo;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan]);

  function seatCapFor(targetId: string | undefined): number {
    if (!plan?.vehicle) return 0;
    if (!targetId || targetId === plan.vehicle.vehicleId) return plan.vehicle.maxOfferableSeats;
    return plan.vehicle.alternatives.find((a) => a.vehicleId === targetId)?.maxOfferableSeats ?? 0;
  }

  function offerSeatsFor(targetId: string | undefined): number | undefined {
    if (!hostStepEnabled || offer.choice !== "yes") return undefined;
    const cap = seatCapFor(targetId);
    if (cap < 1) return undefined;
    const typed = Math.floor(Number(offer.seats));
    return Math.min(Math.max(Number.isFinite(typed) && typed > 0 ? typed : cap, 1), cap);
  }

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
        offerSeats: plan.type === "vehicle" ? offerSeatsFor(resolvedTargetId) : undefined,
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
        ref={formRef}
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

        {carpoolMode.newEngine ? (
          // Phase C5 decision: with the new carpool engine the old consent checkbox would be a
          // confusing second carpool question. It is hidden; the value stays "on" so the DB
          // default (allow_carpool = true) and the chat slot semantics are unchanged. The new
          // Yes/No "offer seats" step (after the vehicle recommendation) is the only question.
          <input type="hidden" name="allowCarpool" value="on" />
        ) : (
          <label className="flex items-center gap-2 text-sm text-fog-400">
            <input
              type="checkbox"
              name="allowCarpool"
              defaultChecked={draft.allowCarpool !== undefined ? draft.allowCarpool === "on" : true}
              className="h-4 w-4"
            />
            {t.allowCarpoolLabel}
          </label>
        )}

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

        {carpoolFirst ? (
          <div className="mb-4" data-testid="carpool-first">
            <CarpoolFirstPanel
              state={carpoolFirst}
              dict={dict}
              locale={locale}
              onContinue={() => setVehicleRevealed(true)}
            />
          </div>
        ) : null}

        {!plan ? (
          <p className="text-sm text-fog-600">{t.emptyState}</p>
        ) : plan.error ? (
          <p className="text-sm text-signal-red">{t.planError}</p>
        ) : !vehicleVisible ? null : plan.type === "carpool" && plan.carpoolOptions && plan.carpoolOptions.length > 0 ? (
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
            {hostStepEnabled ? (
              <fieldset
                data-testid="host-offer-step"
                className="flex flex-col gap-2 rounded-sm border border-line-800 bg-panel-800 p-3"
              >
                <legend className="px-1 text-xs font-semibold uppercase tracking-widest text-fog-400">
                  {ct.hostQuestion}
                </legend>
                {plan.vehicle.maxOfferableSeats < 1 ? (
                  <p className="text-xs text-fog-600">{ct.noFreeSeats}</p>
                ) : (
                  <>
                    <div className="flex items-center gap-4 text-sm text-paper-50">
                      <label className="flex items-center gap-1.5">
                        <input
                          type="radio"
                          name="offerChoice"
                          value="yes"
                          checked={offer.choice === "yes"}
                          onChange={() =>
                            setOffer((o) => ({
                              choice: "yes",
                              seats: o.seats || String(plan.vehicle!.maxOfferableSeats),
                            }))
                          }
                        />
                        {ct.yes}
                      </label>
                      <label className="flex items-center gap-1.5">
                        <input
                          type="radio"
                          name="offerChoice"
                          value="no"
                          checked={offer.choice === "no"}
                          onChange={() => setOffer((o) => ({ ...o, choice: "no" }))}
                        />
                        {ct.no}
                      </label>
                    </div>
                    {offer.choice === "yes" ? (
                      <label className="flex flex-col gap-1 text-xs text-fog-400">
                        {fillTemplate(ct.seatsLabel, { max: plan.vehicle.maxOfferableSeats })}
                        <input
                          type="number"
                          name="offerSeats"
                          min={1}
                          max={plan.vehicle.maxOfferableSeats}
                          value={offer.seats}
                          onChange={(e) => setOffer((o) => ({ ...o, seats: e.target.value }))}
                          className="w-24 rounded-sm border border-line-800 bg-panel-900 px-2 py-1.5 font-mono text-sm text-paper-50 outline-none focus-visible:border-gwm-accent"
                        />
                      </label>
                    ) : null}
                    <p className="text-xs text-fog-600">{ct.hostHint}</p>
                  </>
                )}
              </fieldset>
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
