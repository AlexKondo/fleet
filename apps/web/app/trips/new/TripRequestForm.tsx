"use client";

import { useActionState, useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { confirmTrip, planTripAction, type PlanTripResult, type TripFormInput } from "./actions";
import { formatDateTime } from "@/lib/formatDateTime";
import type { Locale } from "@/lib/i18n/locales";
import type { Dictionary } from "../../../lib/i18n/dictionaries";
import type { CarpoolGating } from "@/lib/carpool/carpoolFirst";
import { fillTemplate } from "@/lib/carpool/errorText";
import { CarpoolFirstPanel } from "./CarpoolFirstPanel";
import { RouteMapCard } from "../../carpool/RouteMapCard";
import { parseBrasiliaLocalDateTime } from "@/lib/trips/brasiliaLocalDateTime";
import { RvCarIcon, RvCheckIcon, RvUsersIcon } from "./rvIcons";
import "./reservar.css";

/** ISO instant -> "YYYY-MM-DDTHH:mm" in Brasília time (the zone-less datetime-local value is read as Brasília time, see brasiliaLocalDateTime.ts). */
function toLocalInputValue(iso: string): string {
  return new Date(iso)
    .toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
    .replace(" ", "T");
}

type StepKey = "trip" | "carpool" | "vehicle" | "confirm";

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
  const rv = dict.trips.reservar;
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

  function stepSeats(delta: number, cap: number) {
    setOffer((o) => {
      const cur = Math.floor(Number(o.seats));
      const base = Number.isFinite(cur) && cur > 0 ? cur : cap;
      return { ...o, seats: String(Math.min(Math.max(base + delta, 1), cap)) };
    });
  }

  function handleFormSubmit(e: FormEvent<HTMLFormElement>) {
    const formData = new FormData(e.currentTarget);
    writeDraft(formData);
    setFormInput({
      departureAt: parseBrasiliaLocalDateTime(String(formData.get("departureAt"))).toISOString(),
      expectedReturnAt: parseBrasiliaLocalDateTime(String(formData.get("expectedReturnAt"))).toISOString(),
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

  // Step header: VISUAL ONLY. It mirrors where this single page currently is; it is not a wizard.
  const legacyCarpoolPlan = Boolean(plan && !plan.error && plan.type === "carpool" && plan.carpoolOptions?.length);
  const hasCarpoolStep = carpoolFirst?.status === "offers" || legacyCarpoolPlan;
  const stepKeys: readonly StepKey[] = hasCarpoolStep
    ? (["trip", "carpool", "vehicle", "confirm"] as const)
    : (["trip", "vehicle", "confirm"] as const);
  const currentStep: StepKey = !plan || plan.error
    ? "trip"
    : isConfirming
      ? "confirm"
      : carpoolFirst?.status === "offers" && !vehicleRevealed
        ? "carpool"
        : legacyCarpoolPlan
          ? "carpool"
          : plan.type === "vehicle" && plan.vehicle && vehicleVisible
            ? "vehicle"
            : "trip";
  const currentIdx = stepKeys.indexOf(currentStep);
  const stepText: Record<StepKey, [string, string]> = {
    trip: [rv.stepTrip, rv.stepTripHint],
    carpool: [rv.stepCarpool, rv.stepCarpoolHint],
    vehicle: [rv.stepVehicle, rv.stepVehicleHint],
    confirm: [rv.stepConfirm, rv.stepConfirmHint],
  };

  const reasonList = (reasons: string[]) => (
    <ul className="rv-reasons">
      {reasons.map((r) => (
        <li key={r}>
          <RvCheckIcon />
          <span>{reasonLabel(r)}</span>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="rv">
      <ol className="rv-steps" aria-label={rv.stepsLabel} data-testid="rv-steps">
        {stepKeys.map((key, i) => {
          const state = i < currentIdx ? "done" : i === currentIdx ? "current" : "todo";
          return (
            <li key={key} className="rv-step" data-state={state} aria-current={state === "current" ? "step" : undefined}>
              <span className="rv-step-dot" aria-hidden="true">
                {state === "done" ? <RvCheckIcon /> : i + 1}
              </span>
              <span className="rv-step-label">
                {stepText[key][0]}
                {state !== "todo" ? (
                  <span className="fm-sr-only"> ({state === "done" ? rv.stepDone : rv.stepCurrent})</span>
                ) : null}
              </span>
              <span className="rv-step-hint">{stepText[key][1]}</span>
            </li>
          );
        })}
      </ol>

      <form ref={formRef} action={planAction} onSubmit={handleFormSubmit} className="fm-card rv-form">
        <h2 className="fm-h2">{rv.detailsTitle}</h2>
        <div className="rv-grid">
          <label className="fm-field">
            <span className="fm-label">{t.originLabel}</span>
            <input name="origin" required defaultValue={draft.origin ?? "Iracemápolis"} className="fm-input" />
          </label>
          <label className="fm-field">
            <span className="fm-label">{t.destinationLabel}</span>
            <input
              name="destination"
              required
              defaultValue={draft.destination}
              placeholder={t.destinationPlaceholder}
              className="fm-input"
            />
          </label>
          <label className="fm-field">
            <span className="fm-label">{t.departureLabel}</span>
            <input type="datetime-local" name="departureAt" required defaultValue={defaultDeparture} className="fm-input" />
          </label>
          <label className="fm-field">
            <span className="fm-label">{t.expectedReturnLabel}</span>
            <input type="datetime-local" name="expectedReturnAt" required defaultValue={defaultReturn} className="fm-input" />
          </label>
          <label className="fm-field">
            <span className="fm-label">{t.distanceLabel}</span>
            <input type="number" name="distanceKm" required min={1} defaultValue={draft.distanceKm ?? 100} className="fm-input" />
          </label>
          <label className="fm-field">
            <span className="fm-label">{t.passengersLabel}</span>
            <input type="number" name="passengerCount" required min={1} defaultValue={draft.passengerCount ?? 1} className="fm-input" />
          </label>

          <label className="rv-check rv-span-2">
            <input type="checkbox" name="requiresCargo" defaultChecked={draft.requiresCargo === "on"} />
            <span>{t.cargoLabel}</span>
          </label>

          {carpoolMode.newEngine ? (
            // Phase C5 decision: with the new carpool engine the old consent checkbox would be a
            // confusing second carpool question. It is hidden; the value stays "on" so the DB
            // default (allow_carpool = true) and the chat slot semantics are unchanged. The new
            // Yes/No "offer seats" step (after the vehicle recommendation) is the only question.
            <input type="hidden" name="allowCarpool" value="on" />
          ) : (
            <label className="rv-check rv-span-2">
              <input
                type="checkbox"
                name="allowCarpool"
                defaultChecked={draft.allowCarpool !== undefined ? draft.allowCarpool === "on" : true}
              />
              <span>{t.allowCarpoolLabel}</span>
            </label>
          )}

          <label className="fm-field rv-span-4">
            <span className="fm-label">{t.justificationLabel}</span>
            <textarea name="justification" required rows={3} defaultValue={draft.justification} className="fm-input" />
          </label>
        </div>

        <button type="submit" disabled={isPlanning} className="fm-btn fm-btn-primary rv-submit">
          {isPlanning ? t.submitPending : t.submit}
        </button>
      </form>

      <div className="rv-resultswrap">
      <section className="rv-results" aria-labelledby="rv-results-title">
        <h2 id="rv-results-title" className="fm-sr-only">
          {rv.resultTitle}
        </h2>

        {carpoolFirst && carpoolFirst.status !== "none" ? (
          <div data-testid="carpool-first">
            <CarpoolFirstPanel
              state={carpoolFirst}
              dict={dict}
              locale={locale}
              onContinue={() => setVehicleRevealed(true)}
            />
          </div>
        ) : null}

        {!plan ? (
          <p className="fm-card rv-empty">{t.emptyState}</p>
        ) : plan.error ? (
          <p className="fm-banner fm-banner-danger" role="alert" style={{ marginTop: 0 }}>
            {t.planError}
          </p>
        ) : !vehicleVisible ? null : plan.type === "carpool" && plan.carpoolOptions && plan.carpoolOptions.length > 0 ? (
          <section className="fm-card rv-block rv-block-carpool">
            <div className="rv-head">
              <span className="rv-head-icon">
                <RvUsersIcon />
              </span>
              <div>
                <h3 className="fm-h2">
                  {plan.carpoolOptions.length > 1
                    ? t.carpoolsCompatible.replace("{count}", String(plan.carpoolOptions.length))
                    : t.carpoolAvailable}
                </h3>
                {plan.carpoolOptions.length > 1 ? <p className="rv-sub">{t.carpoolMatchNote}</p> : null}
              </div>
            </div>
            <ul className="rv-offers">
              {plan.carpoolOptions.map((option) => (
                <li key={option.reservationId} className="rv-offer">
                  <p className="rv-offer-time">{option.vehiclePlate}</p>
                  <p className="rv-muted">
                    {t.carpoolSchedule
                      .replace("{departure}", formatDateTime(option.departureAt, locale))
                      .replace("{returnAt}", formatDateTime(option.expectedReturnAt, locale))}
                  </p>
                  <button
                    onClick={() => handleConfirm(option.reservationId)}
                    disabled={isConfirming}
                    className="fm-btn fm-btn-primary"
                  >
                    {isConfirming ? t.confirming : t.acceptCarpool}
                  </button>
                </li>
              ))}
            </ul>
            {reasonList(plan.reasons)}
          </section>
        ) : plan.type === "vehicle" && plan.vehicle ? (
          <>
            <section className="fm-card rv-block" aria-labelledby="rv-vehicle-title">
              <div className="rv-vehicle">
                <span className="rv-head-icon">
                  <RvCarIcon />
                </span>
                <div>
                  <div className="rv-badge-row">
                    <h3 id="rv-vehicle-title" className="fm-badge">
                      {t.recommendedVehicle}
                    </h3>
                  </div>
                  <p className="rv-plate">{plan.vehicle.plate}</p>
                  <p className="rv-muted">{plan.vehicle.categoryName}</p>
                </div>
              </div>
              {reasonList(plan.vehicle.reasons)}
              {plan.vehicle.requiredPreparation && plan.vehicle.requiredPreparation.length > 0 ? (
                <p className="rv-warn">{t.preparationNote}</p>
              ) : null}
              {plan.vehicle.trafficRestriction?.restricted ? (
                <div className="rv-warn">
                  <p className="rv-warn-title">{t.trafficRestrictionTitle}</p>
                  <p>{t.trafficRestrictionBody}</p>
                </div>
              ) : null}
              {hostStepEnabled ? (
                <fieldset data-testid="host-offer-step" className="rv-host">
                  <legend>{ct.hostQuestion}</legend>
                  {plan.vehicle.maxOfferableSeats < 1 ? (
                    <p className="rv-hint">{ct.noFreeSeats}</p>
                  ) : (
                    <>
                      <div className="rv-seg-row">
                        <label className="rv-seg">
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
                        <label className="rv-seg">
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
                        <div className="fm-field" role="group" aria-labelledby="rv-offer-seats-label">
                          <label id="rv-offer-seats-label" htmlFor="rv-offer-seats" className="fm-label">
                            {fillTemplate(ct.seatsLabel, { max: plan.vehicle.maxOfferableSeats })}
                          </label>
                          <div className="rv-stepper">
                            <button
                              type="button"
                              className="rv-stepper-btn"
                              aria-label={rv.decreaseSeats}
                              onClick={() => stepSeats(-1, plan.vehicle!.maxOfferableSeats)}
                            >
                              −
                            </button>
                            <input
                              id="rv-offer-seats"
                              type="number"
                              name="offerSeats"
                              min={1}
                              max={plan.vehicle.maxOfferableSeats}
                              value={offer.seats}
                              onChange={(e) => setOffer((o) => ({ ...o, seats: e.target.value }))}
                              className="fm-input"
                            />
                            <button
                              type="button"
                              className="rv-stepper-btn"
                              aria-label={rv.increaseSeats}
                              onClick={() => stepSeats(1, plan.vehicle!.maxOfferableSeats)}
                            >
                              +
                            </button>
                          </div>
                        </div>
                      ) : null}
                      <p className="rv-hint">{ct.hostHint}</p>
                    </>
                  )}
                </fieldset>
              ) : null}
              <button
                onClick={() => handleConfirm(plan.vehicle!.vehicleId)}
                disabled={isConfirming}
                className="fm-btn fm-btn-primary rv-confirm"
              >
                {isConfirming ? t.confirming : t.requestReservation}
              </button>
            </section>

            {plan.vehicle.alternatives.length > 0 ? (
              <section className="fm-card rv-block" aria-labelledby="rv-alt-title">
                <h3 id="rv-alt-title" className="fm-h2">
                  {plan.bookingMode === "user_choice" ? t.otherEligibleVehicles : t.preferAnotherVehicle}
                </h3>
                <ul className="rv-alt-list">
                  {plan.vehicle.alternatives.map((alt) => (
                    <li key={alt.vehicleId} className="rv-alt">
                      <div>
                        <p className="rv-plate" style={{ fontSize: 17 }}>
                          {alt.plate}
                        </p>
                        <p className="rv-muted">{alt.categoryName}</p>
                      </div>
                      <button
                        onClick={() => handleConfirm(alt.vehicleId)}
                        disabled={isConfirming}
                        className="fm-btn fm-btn-ghost"
                      >
                        {t.choose}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        ) : (
          <section className="fm-card rv-block">
            <p className="rv-error">{t.noOptions}</p>
            {reasonList(plan.reasons)}
          </section>
        )}

        {confirmError ? (
          <p role="alert" className="fm-banner fm-banner-danger" style={{ marginTop: 0 }}>
            {confirmError === "RESERVATION_CONFLICT"
              ? t.reservationConflict
              : confirmError === "plan_changed"
                ? t.planChanged
                : t.confirmError.replace("{code}", confirmError)}
          </p>
        ) : null}
      </section>
      {/* Route map: loaded lazily AFTER the plan, independent of the recommendation (never blocks it). */}
      {plan && !plan.error && formInput ? (
        <aside className="rv-mapcol" data-testid="rv-mapcol">
          <RouteMapCard dict={dict} locale={locale} originText={formInput.origin} destinationText={formInput.destination} />
        </aside>
      ) : null}
      </div>
    </div>
  );
}
