"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { requestCarpoolRide } from "@/app/carpool/requestActions";
import { getMyCarpoolRequestStatus } from "@/app/carpool/formActions";
import { carpoolErrorText, fillTemplate } from "@/lib/carpool/errorText";
import type { CarpoolFirstState, PlaceCheck } from "@/lib/carpool/carpoolFirst";
import type { ResolvedPlace } from "@/lib/carpool/resolveLocationText";
import { formatDateTimeShort } from "@/lib/formatDateTime";
import type { Locale } from "@/lib/i18n/locales";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { RvUsersIcon } from "./rvIcons";

type CardOutcome =
  | { kind: "requested"; status: "PENDING" | "ACCEPTED" | string }
  | { kind: "error"; code: string };

/**
 * Phase C5 (pack 05): the carpool-first step of New Trip. Shown BEFORE the vehicle result.
 *  - offers          : compatible cards (departure, detour, seats, Request Ride) + decline button
 *  - none            : nothing fits -> renders nothing; the vehicle result follows automatically (caller)
 *  - unavailable     : outage banner; the vehicle flow is untouched
 *  - needs_precision : we do NOT guess; the rider is asked for a more precise place
 * Every request carries a client_request_id generated once per offer and REUSED on retry, so a
 * double click / network retry can never create two requests (the DB enforces it too).
 */
export function CarpoolFirstPanel({
  state,
  dict,
  locale,
  onContinue,
}: {
  state: CarpoolFirstState;
  dict: Dictionary;
  locale: Locale;
  /** Reveals the normal vehicle result (decline / clarification skipped). */
  onContinue: () => void;
}) {
  const t = dict.carpool.newTrip;
  const keys = useRef(new Map<string, string>());
  const [outcomes, setOutcomes] = useState<Record<string, CardOutcome>>({});
  const [busyOffer, setBusyOffer] = useState<string | null>(null);
  const [, startRequesting] = useTransition();

  function keyFor(offerId: string): string {
    let key = keys.current.get(offerId);
    if (!key) {
      key = crypto.randomUUID();
      keys.current.set(offerId, key);
    }
    return key;
  }

  function request(offerId: string) {
    if (state.status !== "offers") return;
    setBusyOffer(offerId);
    startRequesting(async () => {
      try {
        const result = await requestCarpoolRide({
          offerId,
          clientRequestId: keyFor(offerId),
          draft: state.draft,
          pickupLabel: state.origin.label,
          dropoffLabel: state.destination.label,
        });
        if (result.status === "success") {
          const current = await getMyCarpoolRequestStatus(result.requestId);
          setOutcomes((o) => ({ ...o, [offerId]: { kind: "requested", status: current?.status ?? "PENDING" } }));
        } else {
          setOutcomes((o) => ({ ...o, [offerId]: { kind: "error", code: result.error } }));
        }
      } catch {
        setOutcomes((o) => ({ ...o, [offerId]: { kind: "error", code: "CARPOOL_RPC_FAILED" } }));
      } finally {
        setBusyOffer(null);
      }
    });
  }

  if (state.status === "unavailable") {
    return (
      <p role="status" data-testid="carpool-unavailable" className="fm-banner" style={{ marginTop: 0 }}>
        {t.unavailableBanner}
      </p>
    );
  }

  // Carpool is optional: with nobody on the route it simply does not appear (the vehicle result follows).
  if (state.status === "none") return null;

  if (state.status === "needs_precision") {
    const failing: { check: PlaceCheck & { ok: false }; field: string }[] = [];
    if (!state.origin.ok) failing.push({ check: state.origin, field: t.originField });
    if (!state.destination.ok) failing.push({ check: state.destination, field: t.destinationField });
    return (
      <div role="alert" data-testid="carpool-needs-precision" className="fm-banner fm-needs" style={{ marginTop: 0 }}>
        <p style={{ fontWeight: 700 }}>{t.needsPrecisionTitle}</p>
        <ul>
          {failing.map(({ check, field }) => (
            <li key={field}>
              {fillTemplate(
                ({
                  city_level: t.cityLevel,
                  state_level: t.stateLevel,
                  neighborhood_level: t.neighborhoodLevel,
                  postal_code: t.postalCode,
                  empty: t.empty,
                  not_found: t.notFound,
                } as Record<string, string>)[check.reason] ?? t.notFound,
                { text: check.query, field },
              )}
            </li>
          ))}
        </ul>
        <button type="button" onClick={onContinue} className="fm-btn fm-btn-ghost" style={{ marginTop: 12 }}>
          {t.continueWithoutCarpool}
        </button>
      </div>
    );
  }

  // offers
  return (
    <section className="fm-card rv-block rv-block-carpool" aria-labelledby="rv-carpool-title">
      <div className="rv-head">
        <span className="rv-head-icon">
          <RvUsersIcon />
        </span>
        <div>
          <h2 id="rv-carpool-title" className="fm-h2">
            {t.offersTitle}
          </h2>
          <p className="rv-sub">{t.offersIntro}</p>
        </div>
      </div>
      <PlacesConfirmation origin={state.origin} destination={state.destination} dict={dict} />
      <ul className="rv-offers">
        {state.offers.map((offer) => {
          const outcome = outcomes[offer.offerId];
          return (
            <li key={offer.offerId} data-testid="carpool-offer-card" className="rv-offer">
              <p className="rv-offer-time">
                {fillTemplate(t.cardDeparture, { time: formatDateTimeShort(offer.hostDepartureAt, locale) })}
              </p>
              <p className="rv-muted">
                {fillTemplate(t.cardDetour, { km: offer.additionalDistanceKm, min: offer.additionalTimeMin })}
              </p>
              <div className="fm-chips">
                <span className="fm-chip fm-chip-seats">
                  {fillTemplate(offer.seatsAvailable === 1 ? t.seatsOne : t.seatsOther, { count: offer.seatsAvailable })}
                </span>
              </div>
              {outcome?.kind === "requested" ? (
                <div role="status" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <p className="rv-ok">{outcome.status === "ACCEPTED" ? t.outcomeAccepted : t.outcomePending}</p>
                  <Link href="/trips" className="rv-link">
                    {t.viewMyTrips}
                  </Link>
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => request(offer.offerId)}
                    disabled={busyOffer !== null}
                    className="fm-btn fm-btn-primary"
                  >
                    {busyOffer === offer.offerId ? t.requesting : t.requestRide}
                  </button>
                  {outcome?.kind === "error" ? (
                    <p role="alert" className="fm-error">
                      {carpoolErrorText(dict, outcome.code)}
                    </p>
                  ) : null}
                </>
              )}
            </li>
          );
        })}
      </ul>
      <button type="button" onClick={onContinue} className="fm-btn fm-btn-ghost" style={{ alignSelf: "flex-start" }}>
        {t.continueWithVehicle}
      </button>
    </section>
  );
}

/** Shows the canonical places the system understood, so the rider can confirm (or fix) them. */
export function PlacesConfirmation({
  origin,
  destination,
  dict,
}: {
  origin: ResolvedPlace;
  destination: ResolvedPlace;
  dict: Dictionary;
}) {
  const t = dict.carpool.newTrip;
  const row = (label: string, place: ResolvedPlace, testId: string) => (
    <li data-testid={testId}>
      <span className="rv-places-label">{label}: </span>
      {place.label}
      {place.source === "corporate_mobility_point" ? <span className="fm-badge">{t.sourceMobilityPoint}</span> : null}
    </li>
  );
  return (
    <div className="rv-places" data-testid="carpool-places">
      <p style={{ fontWeight: 700 }}>{t.placesTitle}</p>
      <ul>
        {row(t.originLabel, origin, "carpool-origin-label")}
        {row(t.destinationLabel, destination, "carpool-destination-label")}
      </ul>
      <p className="rv-hint" style={{ marginTop: 8 }}>
        {t.confirmHint}
      </p>
    </div>
  );
}
