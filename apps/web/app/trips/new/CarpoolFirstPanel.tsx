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

type CardOutcome =
  | { kind: "requested"; status: "PENDING" | "ACCEPTED" | string }
  | { kind: "error"; code: string };

/**
 * Phase C5 (pack 05): the carpool-first step of New Trip. Shown BEFORE the vehicle result.
 *  - offers          : compatible cards (departure, detour, seats, Request Ride) + decline button
 *  - none            : nothing fits -> the vehicle result follows automatically (caller)
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
      <p role="status" data-testid="carpool-unavailable" className="rounded-sm border border-signal-yellow/40 bg-signal-yellow/10 p-3 text-sm text-signal-yellow">
        {t.unavailableBanner}
      </p>
    );
  }

  if (state.status === "none") {
    return (
      <div className="flex flex-col gap-2">
        <PlacesConfirmation origin={state.origin} destination={state.destination} dict={dict} />
        <p className="text-sm text-fog-400">{t.noneFound}</p>
      </div>
    );
  }

  if (state.status === "needs_precision") {
    const failing: { check: PlaceCheck & { ok: false }; field: string }[] = [];
    if (!state.origin.ok) failing.push({ check: state.origin, field: t.originField });
    if (!state.destination.ok) failing.push({ check: state.destination, field: t.destinationField });
    return (
      <div role="alert" data-testid="carpool-needs-precision" className="flex flex-col gap-3 rounded-sm border border-gwm-accent/40 bg-gwm-accent/10 p-4">
        <p className="text-xs font-semibold uppercase tracking-widest text-gwm-accent">{t.needsPrecisionTitle}</p>
        <ul className="flex flex-col gap-1.5 text-sm text-paper-50">
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
        <button
          type="button"
          onClick={onContinue}
          className="self-start rounded-sm border border-line-700 px-3 py-1.5 text-xs font-semibold uppercase tracking-widest text-fog-400 hover:border-signal-blue hover:text-signal-blue"
        >
          {t.continueWithoutCarpool}
        </button>
      </div>
    );
  }

  // offers
  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs uppercase tracking-widest text-signal-teal">{t.offersTitle}</p>
      <p className="text-xs text-fog-600">{t.offersIntro}</p>
      <PlacesConfirmation origin={state.origin} destination={state.destination} dict={dict} />
      <ul className="flex flex-col gap-3">
        {state.offers.map((offer) => {
          const outcome = outcomes[offer.offerId];
          return (
            <li
              key={offer.offerId}
              data-testid="carpool-offer-card"
              className="rounded-sm border border-signal-teal/40 bg-signal-teal/10 p-4"
            >
              <p className="font-mono text-base text-paper-50">
                {fillTemplate(t.cardDeparture, { time: formatDateTimeShort(offer.hostDepartureAt, locale) })}
              </p>
              <p className="mt-1 text-sm text-fog-400">
                {fillTemplate(t.cardDetour, { km: offer.additionalDistanceKm, min: offer.additionalTimeMin })}
              </p>
              <p className="mt-1 text-sm text-fog-400">
                {fillTemplate(offer.seatsAvailable === 1 ? t.seatsOne : t.seatsOther, { count: offer.seatsAvailable })}
              </p>
              {outcome?.kind === "requested" ? (
                <div role="status" className="mt-3 flex flex-col gap-2">
                  <p className="text-sm font-semibold text-signal-teal">
                    {outcome.status === "ACCEPTED" ? t.outcomeAccepted : t.outcomePending}
                  </p>
                  <Link href="/trips" className="text-xs uppercase tracking-widest text-gwm-accent hover:underline">
                    {t.viewMyTrips}
                  </Link>
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => request(offer.offerId)}
                    disabled={busyOffer !== null}
                    className="mt-3 rounded-sm bg-signal-teal px-4 py-2 text-sm font-semibold uppercase tracking-widest text-ink-950 transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    {busyOffer === offer.offerId ? t.requesting : t.requestRide}
                  </button>
                  {outcome?.kind === "error" ? (
                    <p role="alert" className="mt-2 text-sm text-signal-red">
                      {carpoolErrorText(dict, outcome.code)}
                    </p>
                  ) : null}
                </>
              )}
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        onClick={onContinue}
        className="self-start rounded-sm border border-line-700 px-3 py-1.5 text-xs font-semibold uppercase tracking-widest text-fog-400 hover:border-signal-blue hover:text-signal-blue"
      >
        {t.continueWithVehicle}
      </button>
    </div>
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
    <li data-testid={testId} className="text-sm text-paper-50">
      <span className="text-xs uppercase tracking-widest text-fog-600">{label}: </span>
      {place.label}
      {place.source === "corporate_mobility_point" ? (
        <span className="ml-2 rounded-sm border border-signal-blue/40 px-1.5 py-0.5 text-[10px] uppercase tracking-widest text-signal-blue">
          {t.sourceMobilityPoint}
        </span>
      ) : null}
    </li>
  );
  return (
    <div className="rounded-sm border border-line-800 bg-panel-800 p-3" data-testid="carpool-places">
      <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-fog-400">{t.placesTitle}</p>
      <ul className="flex flex-col gap-1">
        {row(t.originLabel, origin, "carpool-origin-label")}
        {row(t.destinationLabel, destination, "carpool-destination-label")}
      </ul>
      <p className="mt-2 text-xs text-fog-600">{t.confirmHint}</p>
    </div>
  );
}
