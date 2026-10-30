"use client";

import { useActionState, useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { confirmTrip, planTripAction, type PlanTripResult, type TripFormInput } from "./actions";
import type { OverlappingReservation } from "@/lib/trips/ownOverlap";
import { formatDateTime } from "@/lib/formatDateTime";
import type { Locale } from "@/lib/i18n/locales";
import type { Dictionary } from "../../../lib/i18n/dictionaries";
import type { CarpoolGating } from "@/lib/carpool/carpoolFirst";
import { fillTemplate } from "@/lib/carpool/errorText";
import { CarpoolFirstPanel } from "./CarpoolFirstPanel";
import { VehicleOptions, type VehicleOption } from "./VehicleOptions";
import { RouteMapCard } from "../../carpool/RouteMapCard";
import { PlaceAutocomplete } from "../../carpool/PlaceAutocomplete";
import type { RouteMapResult } from "../../carpool/routeMapActions";
import { parseBrasiliaLocalDateTime } from "@/lib/trips/brasiliaLocalDateTime";
import {
  composeLocalDateTime,
  justificationFor,
  MOTIVO_KEYS,
  motivoFromJustification,
  splitLocalDateTime,
  type MotivoKey,
  type MotivoLabels,
} from "@/lib/trips/reservarForm";
import { RvCheckIcon, RvUsersIcon } from "./rvIcons";
import "./reservar.css";

/** ISO instant -> "YYYY-MM-DDTHH:mm" in Brasília time (the zone-less value is read as Brasília time, see brasiliaLocalDateTime.ts). */
function toLocalInputValue(iso: string): string {
  return new Date(iso)
    .toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
    .replace(" ", "T");
}

type StepKey = "trip" | "vehicle" | "carpool" | "confirm";

const DRAFT_STORAGE_KEY = "fleet.trip-request-draft.v1";
// Only worth restoring if it's from moments ago (e.g. a stray remount right after
// submitting) — an old abandoned draft from a prior visit shouldn't reappear.
const DRAFT_MAX_AGE_MS = 5 * 60 * 1000;
/** The route map waits this long after the last change of origin / destination before asking the server. */
const MAP_DEBOUNCE_MS = 700;
const MIN_PLACE_CHARS = 3;

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

const PinIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z" />
    <circle cx="12" cy="10" r="2.3" />
  </svg>
);
const MapIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 4 3.5 6v14L9 18l6 2 5.5-2V4L15 6 9 4Z" />
    <path d="M9 4v14M15 6v14" />
  </svg>
);

export function TripRequestForm({
  dict,
  locale,
  carpoolMode,
  prefill,
  pickupLocations = [],
  workLocation = null,
}: {
  dict: Dictionary;
  locale: Locale;
  /** Trip data handed over by the FleetMind Assistant (/trips/new?origin=…, lib/trips/tripPrefill.ts),
   * same field format as the sessionStorage draft. Takes precedence over the draft; creates nothing. */
  prefill?: Record<string, string>;
  /** Phase C5: org carpool policy as seen by the server (page.tsx). `newEngine` hides the old
   * allow_carpool checkbox (the Yes/No host step is then the only carpool question). */
  carpoolMode: CarpoolGating;
  /** "Seu local de trabalho" (profile): the default origin, with a button to leave from somewhere else. */
  workLocation?: { id: string; name: string; addressLabel: string } | null;
  /** Registered departure locations with the number of vehicles there (page.tsx). Empty => the org has none: no origin filter. */
  pickupLocations?: { id: string; name: string; vehicles: number }[];
}) {
  const t = dict.trips.request;
  const ct = dict.carpool.newTrip;
  const rv = dict.trips.reservar;
  const reasonLabel = (reason: string): string =>
    (dict.trips.reasons as Record<string, string>)[reason] ?? reason;
  const motivoLabels: MotivoLabels = {
    meeting: rv.reasonMeeting,
    clientVisit: rv.reasonClientVisit,
    training: rv.reasonTraining,
    delivery: rv.reasonDelivery,
    maintenance: rv.reasonMaintenance,
    other: rv.reasonOther,
  };
  const [plan, planAction, isPlanning] = useActionState<PlanTripResult | null, FormData>(
    planTripAction,
    null,
  );
  const [formInput, setFormInput] = useState<TripFormInput | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [isConfirming, startConfirming] = useTransition();
  // The requester's own reservation(s) that collide with this trip's period (confirmTrip answers USER_RESERVATION_OVERLAP):
  // shown with a question; cancelling them needs a typed reason, because the fleet manager is told.
  const [overlap, setOverlap] = useState<{ targetId: string; items: OverlappingReservation[] } | null>(null);
  const [overlapAsking, setOverlapAsking] = useState(false);
  const [overlapReason, setOverlapReason] = useState("");
  // Every field is CONTROLLED: React 19 resets an uncontrolled <form action> to its defaults once the action settles, which
  // would wipe the trip after each search. Controlled state survives it (and the carpool "adjust the field and search again"
  // prompt keeps the rider's values).
  // The server render and the first client render use the same STATIC defaults (no sessionStorage, no clock): the draft
  // (a defensive backstop against a stray remount losing what the user had typed, see writeDraft/readDraft) and the default
  // dates are applied right after hydration, so the markup can never differ between server and client.
  const [origin, setOrigin] = useState("");
  const [originLocationId, setOriginLocationId] = useState("");
  // with a work location the origin is known: the field only shows once the person says they leave from somewhere else
  const [otherOrigin, setOtherOrigin] = useState(false);
  const [includeOthers, setIncludeOthers] = useState(false);
  // "see vehicles at other locations" re-runs the same search with the explicit flag (hidden input is rendered first).
  const formRef = useRef<HTMLFormElement>(null);
  const [resubmit, setResubmit] = useState(false);
  // React 19 resets a <form action> once the action settles; a controlled <select> can come back blank although the state still
  // holds the choice. The value that is SENT lives in a hidden input (never reset) and the select is re-synced from the state.
  const pickupRef = useRef<HTMLSelectElement>(null);
  useEffect(() => {
    const el = pickupRef.current;
    if (el && el.value !== originLocationId) el.value = originLocationId;
  });
  useEffect(() => {
    if (!resubmit) return;
    setResubmit(false);
    formRef.current?.requestSubmit();
  }, [resubmit]);
  const [destination, setDestination] = useState("");
  const [depDate, setDepDate] = useState("");
  const [depTime, setDepTime] = useState("");
  const [retDate, setRetDate] = useState("");
  const [retTime, setRetTime] = useState("");
  const [motivo, setMotivo] = useState<MotivoKey>("meeting");
  const [motivoOther, setMotivoOther] = useState("");
  const [searchCarpool, setSearchCarpool] = useState(true);
  const [passengers, setPassengers] = useState("1");
  const [cargo, setCargo] = useState(false);
  const [allowCarpool, setAllowCarpool] = useState(true);
  // Distance: filled from the route once it is known, unless the rider typed their own value (then it is never overwritten).
  const [distance, setDistance] = useState("100");
  const [distanceAuto, setDistanceAuto] = useState(false);
  const distanceTouched = useRef(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const draft = prefill && Object.keys(prefill).length > 0 ? prefill : readDraft();
    const now = Date.now();
    const dep = splitLocalDateTime(draft.departureAt ?? toLocalInputValue(new Date(now + 60 * 60 * 1000).toISOString()));
    const ret = splitLocalDateTime(draft.expectedReturnAt ?? toLocalInputValue(new Date(now + 9 * 60 * 60 * 1000).toISOString()));
    setDepDate(dep.date);
    setDepTime(dep.time);
    setRetDate(ret.date);
    setRetTime(ret.time);
    if (draft.origin !== undefined) {
      setOrigin(draft.origin);
      if (workLocation && draft.origin.trim() && draft.origin.trim() !== workLocation.addressLabel) setOtherOrigin(true);
    } else if (workLocation) setOrigin(workLocation.addressLabel);
    if (draft.originLocationId && pickupLocations.some((l) => l.id === draft.originLocationId)) setOriginLocationId(draft.originLocationId);
    else if (draft.origin) {
      // the origin text (assistant hand-off / old draft) may already be the name of a registered location
      const wanted = draft.origin.trim().toLowerCase();
      const hit = pickupLocations.find((l) => l.name.trim().toLowerCase() === wanted);
      if (hit) setOriginLocationId(hit.id);
    }
    if (draft.destination !== undefined) setDestination(draft.destination);
    if (draft.justification !== undefined) {
      const m = motivoFromJustification(draft.justification, motivoLabels);
      setMotivo(m.key);
      setMotivoOther(m.other);
    }
    if (draft.searchCarpool === "off") setSearchCarpool(false);
    if (draft.passengerCount !== undefined) setPassengers(draft.passengerCount);
    if (draft.requiresCargo === "on") setCargo(true);
    if (draft.allowCarpool !== undefined) setAllowCarpool(draft.allowCarpool === "on");
    if (draft.distanceKm !== undefined) {
      distanceTouched.current = true;
      setDistance(draft.distanceKm);
    }
    setReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const departureAt = composeLocalDateTime(depDate, depTime);
  const expectedReturnAt = composeLocalDateTime(retDate, retTime);
  const justification = justificationFor(motivo, motivoOther, motivoLabels);

  // Map: both places filled -> debounced (700ms after the last change / selection) -> RouteMapCard (server + in-memory caches).
  const [mapTexts, setMapTexts] = useState<{ origin: string; destination: string } | null>(null);
  useEffect(() => {
    const o = origin.trim();
    const d = destination.trim();
    if (o.length < MIN_PLACE_CHARS || d.length < MIN_PLACE_CHARS) {
      setMapTexts(null);
      return;
    }
    const timer = setTimeout(() => setMapTexts({ origin: o, destination: d }), MAP_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [origin, destination]);

  function onRouteResult(result: RouteMapResult) {
    if (result.status !== "ok" || distanceTouched.current) return;
    setDistance(String(Math.max(1, Math.round(result.distanceKm))));
    setDistanceAuto(true);
  }

  // UI state that belongs to ONE plan result. React's "adjust state when a prop/value changes" pattern: whenever a NEW plan
  // arrives the host's seat choice and the energy filter reset (no effect, no stale flash).
  const [trackedPlan, setTrackedPlan] = useState(plan);
  // Assistant hand-off: the "offer carpool seats" intention survives (pre-selects Yes + the seats).
  const prefillOffer: { choice: "yes" | "no"; seats: string } =
    prefill?.allowCarpool === "on" ? { choice: "yes", seats: prefill.offerSeats ?? "" } : { choice: "no", seats: "" };
  const [offer, setOffer] = useState<{ choice: "yes" | "no"; seats: string }>(prefillOffer);
  const [energyFilter, setEnergyFilter] = useState("all");
  if (plan !== trackedPlan) {
    setTrackedPlan(plan);
    setOffer(prefillOffer);
    setEnergyFilter("all");
    setOverlap(null);
  }
  const carpoolFirst = plan && !plan.error ? plan.carpoolFirst : undefined;
  const hostStepEnabled = Boolean(plan?.carpoolGating?.hostStep);

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
      originLocationId: null,
      includeOtherLocations: formData.get("includeOtherLocations") === "on",
      originIsFreeText: true,
    });
    setConfirmError(null);
  }

  function handleConfirm(targetId?: string, cancelPrevious?: { ids: string[]; reason: string }) {
    if (!formInput || !plan) return;
    const resolvedTargetId = targetId ?? (plan.type === "vehicle" ? plan.vehicle?.vehicleId : undefined);
    if (!resolvedTargetId || plan.type === "none") return;

    startConfirming(async () => {
      const result = await confirmTrip({
        ...formInput,
        choice: plan.type as "carpool" | "vehicle",
        targetId: resolvedTargetId,
        offerSeats: plan.type === "vehicle" ? offerSeatsFor(resolvedTargetId) : undefined,
        replaceReservationIds: cancelPrevious?.ids,
        cancelReason: cancelPrevious?.reason,
      });
      // On success confirmTrip redirects server-side, so this line is rarely reached —
      // best-effort only, the 5-minute TTL in readDraft is the real backstop.
      if (result.success) {
        clearDraft();
      } else if (result.error === "USER_RESERVATION_OVERLAP" && result.overlaps?.length) {
        // the requester already has a reservation in this period: show it and ask whether to cancel it
        setConfirmError(null);
        setOverlap({ targetId: resolvedTargetId, items: result.overlaps });
        setOverlapReason("");
        setOverlapAsking(false);
      } else {
        setConfirmError(result.error ?? "unknown_error");
      }
    });
  }

  // Step header: VISUAL ONLY (art order: Viagem, Veículo, Carona, Confirmação). It mirrors the state of this single page; it is
  // not a wizard. "Carona" only counts when carpool is on for this search (org policy + the toggle).
  const planOk = Boolean(plan && !plan.error);
  const legacyCarpoolPlan = Boolean(plan && !plan.error && plan.type === "carpool" && plan.carpoolOptions?.length);
  const carpoolOn = (carpoolMode.carpoolFirst && searchCarpool) || legacyCarpoolPlan;
  const stepKeys: readonly StepKey[] = carpoolOn ? ["trip", "vehicle", "carpool", "confirm"] : ["trip", "vehicle", "confirm"];
  // Exactly ONE step is current: with carpool offers the page is at "Carona" (the vehicle list is visible too, but it is the next step);
  // otherwise it is at "Veículo".
  const hasOffers = carpoolFirst?.status === "offers" || legacyCarpoolPlan;
  const stepState = (key: StepKey): "done" | "current" | "todo" => {
    switch (key) {
      case "trip":
        return planOk ? "done" : "current";
      case "vehicle":
        return !planOk ? "todo" : isConfirming ? "done" : hasOffers ? "todo" : "current";
      case "carpool":
        return !planOk ? "todo" : isConfirming ? "done" : hasOffers ? "current" : "todo";
      case "confirm":
        return isConfirming ? "current" : "todo";
    }
  };
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

  // The vehicle options (real data only): the recommended one first, then every other eligible vehicle.
  const vehicleOptions: VehicleOption[] =
    plan && !plan.error && plan.type === "vehicle" && plan.vehicle
      ? [
          {
            vehicleId: plan.vehicle.vehicleId,
            plate: plan.vehicle.plate,
            vehicleName: plan.vehicle.vehicleName,
            categoryName: plan.vehicle.categoryName,
            info: plan.vehicle.info,
            energyType: plan.vehicle.info.energyType,
            recommended: true,
          },
          ...plan.vehicle.alternatives.map((alt) => ({
            vehicleId: alt.vehicleId,
            plate: alt.plate,
            vehicleName: alt.vehicleName,
            categoryName: alt.categoryName,
            info: alt.info,
            energyType: alt.info.energyType,
            recommended: false,
          })),
        ]
      : [];

  const recommendedExtras = plan?.vehicle ? (
    <>
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
    </>
  ) : null;

  return (
    <div className="rv">
      <ol className="rv-steps" aria-label={rv.stepsLabel} data-testid="rv-steps">
        {stepKeys.map((key, i) => {
          const state = stepState(key);
          return (
            <li key={key} className="rv-step" data-state={state} data-step={key} aria-current={state === "current" ? "step" : undefined}>
              <span className="rv-step-dot" aria-hidden="true">
                {state === "done" ? <RvCheckIcon /> : i + 1}
              </span>
              <span className="rv-step-text">
                <span className="rv-step-label">
                  {stepText[key][0]}
                  {state !== "todo" ? (
                    <span className="fm-sr-only"> ({state === "done" ? rv.stepDone : rv.stepCurrent})</span>
                  ) : null}
                </span>
                <span className="rv-step-hint">{stepText[key][1]}</span>
              </span>
            </li>
          );
        })}
      </ol>

      <div className="rv-top">
        <form ref={formRef} action={planAction} onSubmit={handleFormSubmit} className="fm-card rv-form" data-testid="rv-form" data-ready={ready ? "true" : "false"}>
          <h2 className="fm-h2">{rv.detailsTitle}</h2>
          <div className="rv-grid">
            <div className="fm-field rv-s7">
              <label className="fm-label" htmlFor="rv-origin">{t.originLabel}</label>
              {workLocation && !otherOrigin ? (
                <div data-testid="rv-origin-work">
                  <input type="hidden" name="origin" value={workLocation.addressLabel} />
                  <p className="fm-input" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <PinIcon />
                    <span><strong>{rv.leavingFrom}</strong> {workLocation.name}</span>
                  </p>
                  <button type="button" className="rv-linkbtn" data-testid="rv-origin-other" onClick={() => { setOtherOrigin(true); setOrigin(""); }}>
                    {rv.otherOriginButton}
                  </button>
                </div>
              ) : (
                <>
                  <PlaceAutocomplete
                    id="rv-origin"
                    name="origin"
                    value={origin}
                    onChange={setOrigin}
                    dict={dict}
                    required
                    placeholder={dict.carpool.buscar.originPlaceholder}
                    icon={<PinIcon />}
                    clearLabel={`${dict.carpool.buscar.clearField}: ${t.originLabel}`}
                    testId="rv-origin"
                  />
                  {workLocation ? (
                    <button type="button" className="rv-linkbtn" data-testid="rv-origin-back" onClick={() => { setOtherOrigin(false); setOrigin(workLocation.addressLabel); }}>
                      {rv.backToWorkLocation}
                    </button>
                  ) : null}
                </>
              )}
            </div>
            <div className="fm-field rv-s7">
              <label className="fm-label" htmlFor="rv-destination">{t.destinationLabel}</label>
              <PlaceAutocomplete
                id="rv-destination"
                name="destination"
                value={destination}
                onChange={setDestination}
                dict={dict}
                required
                placeholder={t.destinationPlaceholder}
                icon={<PinIcon />}
                clearLabel={`${dict.carpool.buscar.clearField}: ${t.destinationLabel}`}
                testId="rv-destination"
              />
            </div>

            {/* date with date, time with time: the departure in the left column, the return in the right one */}
            <div className="fm-field rv-s7">
              <label className="fm-label" htmlFor="rv-dep-date">{rv.departureDateLabel}</label>
              <input id="rv-dep-date" type="date" required value={depDate} onChange={(e) => setDepDate(e.target.value)} className="fm-input" data-testid="rv-dep-date" />
            </div>
            <div className="fm-field rv-s7">
              <label className="fm-label" htmlFor="rv-ret-date">{rv.returnDateLabel}</label>
              <input id="rv-ret-date" type="date" required value={retDate} onChange={(e) => setRetDate(e.target.value)} className="fm-input" data-testid="rv-ret-date" />
            </div>
            <div className="fm-field rv-s7">
              <label className="fm-label" htmlFor="rv-dep-time">{rv.departureTimeLabel}</label>
              <input id="rv-dep-time" type="time" required value={depTime} onChange={(e) => setDepTime(e.target.value)} className="fm-input" data-testid="rv-dep-time" />
            </div>
            <div className="fm-field rv-s7">
              <label className="fm-label" htmlFor="rv-ret-time">{rv.returnTimeLabel}</label>
              <input id="rv-ret-time" type="time" required value={retTime} onChange={(e) => setRetTime(e.target.value)} className="fm-input" data-testid="rv-ret-time" />
            </div>
            {/* composed values, same names and Brasília-time semantics as before (parseBrasiliaLocalDateTime) */}
            <input type="hidden" name="departureAt" value={departureAt} />
            <input type="hidden" name="expectedReturnAt" value={expectedReturnAt} />

            <div className="fm-field rv-s14">
              <label className="fm-label" htmlFor="rv-motivo">{rv.reasonLabel}</label>
              <select id="rv-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value as MotivoKey)} className="fm-input rv-select" data-testid="rv-motivo">
                {MOTIVO_KEYS.map((k) => (
                  <option key={k} value={k}>
                    {motivoLabels[k]}
                  </option>
                ))}
              </select>
              {motivo === "other" ? (
                <input
                  type="text"
                  aria-label={rv.reasonOtherLabel}
                  placeholder={rv.reasonOtherPlaceholder}
                  required
                  maxLength={200}
                  value={motivoOther}
                  onChange={(e) => setMotivoOther(e.target.value)}
                  className="fm-input"
                  data-testid="rv-motivo-other"
                />
              ) : null}
              <input type="hidden" name="justification" value={justification} />
            </div>

            {carpoolMode.carpoolFirst ? (
            <div className="rv-s7 rv-toggle-box">
              <label className="rv-toggle" htmlFor="rv-search-carpool">
                <span className="rv-toggle-text">
                  <span className="rv-toggle-label">{rv.searchCarpoolLabel}</span>
                  <span className="rv-toggle-hint">{rv.searchCarpoolHint}</span>
                </span>
                <input
                  id="rv-search-carpool"
                  type="checkbox"
                  role="switch"
                  checked={searchCarpool}
                  onChange={(e) => setSearchCarpool(e.target.checked)}
                  data-testid="rv-search-carpool"
                />
              </label>
              <input type="hidden" name="searchCarpool" value={searchCarpool ? "on" : "off"} />
            </div>
            ) : null}

            <div className="fm-field rv-s4">
              <label className="fm-label" htmlFor="rv-distance">{t.distanceLabel}</label>
              <input
                id="rv-distance"
                type="number"
                name="distanceKm"
                required
                min={1}
                value={distance}
                onChange={(e) => {
                  distanceTouched.current = true;
                  setDistanceAuto(false);
                  setDistance(e.target.value);
                }}
                className="fm-input"
                aria-describedby={distanceAuto ? "rv-distance-hint" : undefined}
                data-auto={distanceAuto ? "true" : undefined}
                data-testid="rv-distance"
              />
              {distanceAuto ? (
                <span id="rv-distance-hint" className="rv-hint" data-testid="rv-distance-auto">
                  {rv.distanceAuto}
                </span>
              ) : null}
            </div>
            <div className="fm-field rv-s3">
              <label className="fm-label" htmlFor="rv-passengers">{t.passengersLabel}</label>
              <input id="rv-passengers" type="number" name="passengerCount" required min={1} value={passengers} onChange={(e) => setPassengers(e.target.value)} className="fm-input" />
            </div>

            <label className="rv-check rv-s14">
              <input type="checkbox" name="requiresCargo" checked={cargo} onChange={(e) => setCargo(e.target.checked)} />
              <span>{t.cargoLabel}</span>
            </label>

            {carpoolMode.newEngine ? (
              // Phase C5 decision: with the new carpool engine the old consent checkbox would be a
              // confusing second carpool question. It is hidden; the value stays "on" so the DB
              // default (allow_carpool = true) and the chat slot semantics are unchanged. The new
              // Yes/No "offer seats" step (after the vehicle recommendation) is the only question.
              <input type="hidden" name="allowCarpool" value="on" />
            ) : (
              <label className="rv-check rv-s14">
                <input type="checkbox" name="allowCarpool" checked={allowCarpool} onChange={(e) => setAllowCarpool(e.target.checked)} />
                <span>{t.allowCarpoolLabel}</span>
              </label>
            )}
          </div>

          <button type="submit" disabled={isPlanning} className="fm-btn fm-btn-primary rv-submit">
            {isPlanning ? t.submitPending : t.submit}
          </button>
        </form>

        {/* Route map: loads once BOTH places are filled (debounced), independent of the recommendation (never blocks it). */}
        <aside className="rv-mapcol" data-testid="rv-mapcol">
          {mapTexts ? (
            <RouteMapCard
              dict={dict}
              locale={locale}
              originText={mapTexts.origin}
              destinationText={mapTexts.destination}
              debounceMs={0}
              onResult={onRouteResult}
            />
          ) : (
            <div className="fm-card rv-mapempty" data-testid="rv-map-empty">
              <span className="rv-mapempty-icon" aria-hidden="true">
                <MapIcon />
              </span>
              <p>{rv.mapEmpty}</p>
            </div>
          )}
        </aside>
      </div>

      <section className="rv-results" aria-labelledby="rv-results-title">
        <h2 id="rv-results-title" className="fm-sr-only">
          {rv.resultTitle}
        </h2>

        {/* ABOVE the vehicles, and shown together with them (nothing is gated behind a click). */}
        {carpoolFirst && carpoolFirst.status !== "none" ? (
          <div data-testid="carpool-first">
            <CarpoolFirstPanel state={carpoolFirst} dict={dict} locale={locale} />
          </div>
        ) : null}

        {!plan ? (
          <p className="fm-card rv-empty">{t.emptyState}</p>
        ) : plan.error ? (
          <p className="fm-banner fm-banner-danger" role="alert" style={{ marginTop: 0 }}>
            {t.planError}
          </p>
        ) : plan.type === "carpool" && plan.carpoolOptions && plan.carpoolOptions.length > 0 ? (
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
          <VehicleOptions
            dict={dict}
            locale={locale}
            options={vehicleOptions}
            filter={energyFilter}
            onFilter={setEnergyFilter}
            onConfirm={(id) => handleConfirm(id)}
            busy={isConfirming}
            recommendedExtras={recommendedExtras}
          />
          </>
        ) : plan.originCheck && plan.originCheck.status !== "ok" ? (
          <section className="fm-card rv-block" data-testid="no-vehicles-at-origin">
            <p className="rv-error">
              {plan.originCheck.status === "none_at_origin"
                ? fillTemplate(rv.noVehiclesAtOriginTitle, { location: plan.originCheck.originLocationName ?? "" })
                : rv.unknownOriginBody}
            </p>
            {plan.originCheck.status === "none_at_origin" ? <p className="rv-muted">{rv.noVehiclesAtOriginBody}</p> : null}
            {plan.originCheck.others.length > 0 ? (
              <>
                <p className="rv-muted">{rv.otherLocationsHeading}</p>
                <ul className="rv-reasons">
                  {plan.originCheck.others.map((o) => (
                    <li key={o.locationId}>
                      <RvCheckIcon />
                      <span>
                        {o.name} · {o.count === 1 ? rv.pickupVehiclesOne : fillTemplate(rv.pickupVehiclesMany, { count: o.count })}
                      </span>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  className="fm-btn"
                  disabled={isPlanning}
                  data-testid="show-other-locations"
                  onClick={() => {
                    setIncludeOthers(true);
                    setResubmit(true);
                  }}
                >
                  {rv.showOtherLocations}
                </button>
              </>
            ) : null}
          </section>
        ) : (
          <section className="fm-card rv-block">
            <p className="rv-error">{t.noOptions}</p>
            {reasonList(plan.reasons)}
          </section>
        )}

        {overlap ? (
          <section className="fm-card rv-block" role="alertdialog" aria-labelledby="rv-overlap-title" data-testid="rv-overlap">
            <h3 id="rv-overlap-title" className="fm-h2">{t.overlapTitle}</h3>
            <p className="rv-muted">{t.overlapBody}</p>
            <ul className="rv-reasons">
              {overlap.items.map((o) => (
                <li key={o.reservationId} data-testid="rv-overlap-item">
                  <RvCheckIcon />
                  <span>
                    <strong>{o.vehicleName || o.vehiclePlate}</strong>
                    {o.vehicleName && o.vehiclePlate && o.vehicleName !== o.vehiclePlate ? ` (${o.vehiclePlate})` : ""} · {o.origin} → {o.destination} ·{" "}
                    {formatDateTime(o.startAt, locale)} – {formatDateTime(o.endAt, locale)} (
                    {o.status === "confirmed" ? t.overlapStatusConfirmed : t.overlapStatusPending})
                  </span>
                </li>
              ))}
            </ul>
            <p><strong>{t.overlapQuestion}</strong></p>
            {overlapAsking ? (
              <div className="fm-field">
                <label className="fm-label" htmlFor="rv-overlap-reason">{t.overlapReasonLabel}</label>
                <textarea
                  id="rv-overlap-reason"
                  className="fm-input"
                  rows={2}
                  maxLength={300}
                  value={overlapReason}
                  onChange={(e) => setOverlapReason(e.target.value)}
                  placeholder={t.overlapReasonPlaceholder}
                  data-testid="rv-overlap-reason"
                />
                <p className="rv-hint">{t.overlapManagerNote}</p>
                {overlapReason.trim().length < 3 ? (
                  <p role="alert" className="rv-error" data-testid="rv-overlap-reason-required">{t.overlapReasonRequired}</p>
                ) : null}
                <div className="rv-seg-row">
                  <button
                    type="button"
                    className="fm-btn fm-btn-danger"
                    disabled={isConfirming || overlapReason.trim().length < 3}
                    data-testid="rv-overlap-confirm"
                    onClick={() => handleConfirm(overlap.targetId, { ids: overlap.items.map((o) => o.reservationId), reason: overlapReason.trim() })}
                  >
                    {isConfirming ? t.overlapCancelling : t.overlapConfirmCancel}
                  </button>
                  <button type="button" className="fm-btn" disabled={isConfirming} onClick={() => setOverlapAsking(false)}>
                    {t.overlapBack}
                  </button>
                </div>
              </div>
            ) : (
              <div className="rv-seg-row">
                <button type="button" className="fm-btn" data-testid="rv-overlap-keep" onClick={() => setOverlap(null)}>
                  {t.overlapKeep}
                </button>
                <button
                  type="button"
                  className="fm-btn fm-btn-danger"
                  data-testid="rv-overlap-cancel-previous"
                  onClick={() => {
                    setOverlapAsking(true);
                  }}
                >
                  {t.overlapCancelPrevious}
                </button>
              </div>
            )}
          </section>
        ) : null}

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
    </div>
  );
}
