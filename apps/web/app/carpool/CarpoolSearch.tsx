"use client";

import Link from "next/link";
import { useActionState, useRef, useState, useTransition } from "react";
import { requestCarpoolRide } from "@/app/carpool/requestActions";
import { getMyCarpoolRequestStatus } from "@/app/carpool/formActions";
import { searchBuscarCarona, type BuscarCaronaResult } from "@/app/carpool/searchActions";
import { carpoolErrorText, fillTemplate } from "@/lib/carpool/errorText";
import { localInputToIso, MAX_SEATS } from "@/lib/carpool/buscarCarona";
import type { CarpoolFirstState, PlaceCheck } from "@/lib/carpool/carpoolFirst";
import { formatDate, formatDateTimeShort, formatTimeShort } from "@/lib/formatDateTime";
import type { Locale } from "@/lib/i18n/locales";
import type { Dictionary } from "@/lib/i18n/dictionaries";

type UiResult = BuscarCaronaResult | { status: "failed" };
type OfferState = Extract<CarpoolFirstState, { status: "offers" }>;
type CardOutcome = { kind: "error"; code: string };
type Sent = { status: string };

function Icon({ d, children }: { d?: string; children?: React.ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {d ? <path d={d} /> : children}
    </svg>
  );
}
const SearchIcon = () => (
  <Icon>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-4.2-4.2" />
  </Icon>
);
const CarIcon = () => (
  <Icon>
    <path d="M3 17.5h1.2a2.3 2.3 0 0 0 4.4 0h6.8a2.3 2.3 0 0 0 4.4 0H21v-4l-2.5-4.5H15V7a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10.5Z" />
    <circle cx="6.6" cy="17.5" r="1.6" />
    <circle cx="16.4" cy="17.5" r="1.6" />
  </Icon>
);
const CheckIcon = () => <Icon d="m5 12.5 4.5 4.5L19 7.5" />;

export function CarpoolSearch({ dict, locale }: { dict: Dictionary; locale: Locale }) {
  const t = dict.carpool.newTrip;
  const b = dict.carpool.buscar;
  const keys = useRef(new Map<string, string>());
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  // controlled: React resets uncontrolled fields after a form action, which would wipe the rider's date/seats
  const [when, setWhen] = useState("");
  const [seats, setSeats] = useState("1");
  const [outcomes, setOutcomes] = useState<Record<string, CardOutcome>>({});
  const [busyOffer, setBusyOffer] = useState<string | null>(null);
  const [sent, setSent] = useState<Sent | null>(null);
  const [hideResults, setHideResults] = useState(false);
  const [, startRequesting] = useTransition();

  // Bound-to-form action (the repo's documented safe shape for session-reading server actions).
  const [result, formAction, pending] = useActionState<UiResult | null, FormData>(async (_prev, formData) => {
    setHideResults(false);
    setOutcomes({});
    // a new search may carry different places/time: never reuse an old request key for the same offer
    keys.current = new Map();
    const departureAt = localInputToIso(String(formData.get("departureAt") ?? ""));
    if (!departureAt) return { status: "invalid" };
    try {
      return await searchBuscarCarona({
        originText: String(formData.get("origin") ?? ""),
        destinationText: String(formData.get("destination") ?? ""),
        departureAt,
        passengerCount: Number(formData.get("passengerCount")),
      });
    } catch {
      return { status: "failed" };
    }
  }, null);

  function keyFor(offerId: string): string {
    let key = keys.current.get(offerId);
    if (!key) {
      key = crypto.randomUUID();
      keys.current.set(offerId, key);
    }
    return key;
  }

  function request(state: OfferState, offerId: string) {
    setBusyOffer(offerId);
    setOutcomes((o) => {
      const { [offerId]: _drop, ...rest } = o;
      return rest;
    });
    startRequesting(async () => {
      try {
        const res = await requestCarpoolRide({
          offerId,
          clientRequestId: keyFor(offerId),
          draft: state.draft,
          pickupLabel: state.origin.label,
          dropoffLabel: state.destination.label,
        });
        if (res.status === "success") {
          const current = await getMyCarpoolRequestStatus(res.requestId);
          setSent({ status: current?.status ?? "PENDING" });
        } else {
          setOutcomes((o) => ({ ...o, [offerId]: { kind: "error", code: res.error } }));
        }
      } catch {
        setOutcomes((o) => ({ ...o, [offerId]: { kind: "error", code: "CARPOOL_RPC_FAILED" } }));
      } finally {
        setBusyOffer(null);
      }
    });
  }

  function newSearch() {
    keys.current = new Map();
    setSent(null);
    setHideResults(true);
    setOutcomes({});
  }

  // ---------------- request sent (art panel 5) ----------------
  if (sent) {
    return (
      <div className="fm-card fm-success" role="status" data-testid="buscar-sent">
        <div className="fm-success-icon">
          <CheckIcon />
        </div>
        <h1 className="fm-title" style={{ fontSize: 22 }}>{b.successTitle}</h1>
        <p>{sent.status === "ACCEPTED" ? t.outcomeAccepted : t.outcomePending}</p>
        <p className="fm-subtitle">{b.successHint}</p>
        <Link href="/trips" className="fm-btn fm-btn-primary" data-testid="buscar-view-trips">
          {t.viewMyTrips}
        </Link>
        <button type="button" className="fm-btn fm-btn-ghost" onClick={newSearch} data-testid="buscar-new-search">
          {b.newSearch}
        </button>
      </div>
    );
  }

  const shown: UiResult | null = hideResults ? null : result;

  return (
    <>
      <div>
        <h1 className="fm-title">{b.title}</h1>
        <p className="fm-subtitle">{b.subtitle}</p>
      </div>

      <section className="fm-card fm-search" aria-label={b.title}>
        <div className="fm-tabs">
          <span className="fm-tab" aria-current="page">{b.tabFind}</span>
          <Link href="/trips/new" className="fm-tab" data-testid="buscar-tab-offer">{b.tabOffer}</Link>
        </div>
        <form action={formAction} className="fm-form" data-testid="buscar-form">
          <div className="fm-field fm-span-2">
            <label className="fm-label" htmlFor="fm-origin">{b.originLabel}</label>
            <div className="fm-input-wrap">
              <input id="fm-origin" name="origin" className="fm-input" required maxLength={300} autoComplete="off"
                placeholder={b.originPlaceholder} value={origin} onChange={(e) => setOrigin(e.target.value)} />
              {origin ? (
                <button type="button" className="fm-clear" aria-label={`${b.clearField}: ${b.originLabel}`} onClick={() => setOrigin("")}>×</button>
              ) : null}
            </div>
          </div>
          <div className="fm-field fm-span-2">
            <label className="fm-label" htmlFor="fm-destination">{b.destinationLabel}</label>
            <div className="fm-input-wrap">
              <input id="fm-destination" name="destination" className="fm-input" required maxLength={300} autoComplete="off"
                placeholder={b.destinationPlaceholder} value={destination} onChange={(e) => setDestination(e.target.value)} />
              {destination ? (
                <button type="button" className="fm-clear" aria-label={`${b.clearField}: ${b.destinationLabel}`} onClick={() => setDestination("")}>×</button>
              ) : null}
            </div>
          </div>
          <div className="fm-field">
            <label className="fm-label" htmlFor="fm-when">{b.dateTimeLabel}</label>
            <input id="fm-when" name="departureAt" type="datetime-local" className="fm-input" required value={when} onChange={(e) => setWhen(e.target.value)} />
          </div>
          <div className="fm-field">
            <label className="fm-label" htmlFor="fm-seats">{b.seatsLabel}</label>
            <input id="fm-seats" name="passengerCount" type="number" min={1} max={MAX_SEATS} step={1} value={seats} onChange={(e) => setSeats(e.target.value)} className="fm-input" required inputMode="numeric" />
          </div>
          <div className="fm-field fm-submit-field fm-span-2">
            <button type="submit" className="fm-btn fm-btn-primary" disabled={pending} data-testid="buscar-submit">
              <SearchIcon />
              {pending ? b.searching : b.submit}
            </button>
          </div>
        </form>
      </section>

      <div aria-live="polite" aria-busy={pending}>
        {pending ? (
          <div className="fm-results" data-testid="buscar-loading">
            <div className="fm-list" style={{ marginTop: 24 }}>
              <div className="fm-skeleton" />
              <div className="fm-skeleton" />
            </div>
          </div>
        ) : shown ? (
          renderResult(shown)
        ) : null}
      </div>
    </>
  );

  function renderResult(r: UiResult) {
    switch (r.status) {
      case "unavailable":
        return (
          <p role="status" className="fm-banner" data-testid="carpool-unavailable">
            {t.unavailableBanner}
          </p>
        );
      case "blocked":
        return (
          <p role="alert" className="fm-banner fm-banner-danger" data-testid="buscar-blocked">
            {dict.carpool.errors.disabledByPolicy}
          </p>
        );
      case "forbidden":
        return (
          <p role="alert" className="fm-banner fm-banner-danger" data-testid="buscar-forbidden">
            {dict.carpool.errors.notAuthorized}
          </p>
        );
      case "invalid":
        return (
          <p role="alert" className="fm-banner fm-banner-danger" data-testid="buscar-invalid">
            {b.invalidInput}
          </p>
        );
      case "failed":
        return (
          <p role="alert" className="fm-banner fm-banner-danger" data-testid="buscar-failed">
            {dict.carpool.errors.generic}
          </p>
        );
      case "none":
        // NO MATCH: only this message, nothing else (product decision).
        return (
          <div className="fm-card fm-state" role="status" data-testid="buscar-no-match">
            <p className="fm-state-title">{b.noMatch}</p>
          </div>
        );
      case "needs_precision": {
        const failing: { check: PlaceCheck & { ok: false }; field: string }[] = [];
        if (!r.origin.ok) failing.push({ check: r.origin, field: t.originField });
        if (!r.destination.ok) failing.push({ check: r.destination, field: t.destinationField });
        const byReason: Record<string, string> = {
          city_level: t.cityLevel,
          state_level: t.stateLevel,
          neighborhood_level: t.neighborhoodLevel,
          postal_code: t.postalCode,
          empty: t.empty,
          not_found: t.notFound,
        };
        return (
          <div role="alert" className="fm-card fm-state fm-needs" style={{ textAlign: "left" }} data-testid="carpool-needs-precision">
            <p className="fm-state-title">{t.needsPrecisionTitle}</p>
            <ul>
              {failing.map(({ check, field }) => (
                <li key={field}>{fillTemplate(byReason[check.reason] ?? t.notFound, { text: check.query, field })}</li>
              ))}
            </ul>
          </div>
        );
      }
      case "offers":
        return renderOffers(r);
    }
  }

  function renderOffers(r: OfferState) {
    return (
      <div className="fm-results">
        <section aria-labelledby="fm-offers-h">
          <h2 className="fm-h2" id="fm-offers-h">{fillTemplate(b.resultsTitle, { count: r.offers.length })}</h2>
          <ul className="fm-list">
            {r.offers.map((offer) => {
              const outcome = outcomes[offer.offerId];
              return (
                <li key={offer.offerId} className="fm-card fm-offer" data-testid="carpool-offer-card">
                  <div>
                    <div className="fm-offer-main">
                      <span className="fm-offer-icon"><CarIcon /></span>
                      <div>
                        <p className="fm-offer-time" aria-label={fillTemplate(t.cardDeparture, { time: formatDateTimeShort(offer.hostDepartureAt, locale) })}>
                          {formatTimeShort(offer.hostDepartureAt, locale)}
                        </p>
                        <p className="fm-offer-date">{b.departureShort} · {formatDate(offer.hostDepartureAt, locale)}</p>
                      </div>
                    </div>
                    <div className="fm-chips" style={{ marginTop: 12 }}>
                      <span className="fm-chip">{fillTemplate(t.cardDetour, { km: offer.additionalDistanceKm, min: offer.additionalTimeMin })}</span>
                      <span className="fm-chip fm-chip-seats">
                        {fillTemplate(offer.seatsAvailable === 1 ? t.seatsOne : t.seatsOther, { count: offer.seatsAvailable })}
                      </span>
                    </div>
                  </div>
                  <div className="fm-offer-action">
                    <button type="button" className="fm-btn fm-btn-primary" onClick={() => request(r, offer.offerId)} disabled={busyOffer !== null}>
                      {busyOffer === offer.offerId ? t.requesting : t.requestRide}
                    </button>
                    {outcome ? (
                      <p role="alert" className="fm-error">{carpoolErrorText(dict, outcome.code)}</p>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        <aside className="fm-card fm-summary" data-testid="carpool-places" aria-labelledby="fm-summary-h">
          <h2 className="fm-h2" id="fm-summary-h">{b.searchSummaryTitle}</h2>
          <dl>
            <div>
              <dt>{b.originLabel}</dt>
              <dd data-testid="carpool-origin-label">
                {r.origin.label}
                {r.origin.source === "corporate_mobility_point" ? <span className="fm-badge">{t.sourceMobilityPoint}</span> : null}
              </dd>
            </div>
            <div>
              <dt>{b.destinationLabel}</dt>
              <dd data-testid="carpool-destination-label">
                {r.destination.label}
                {r.destination.source === "corporate_mobility_point" ? <span className="fm-badge">{t.sourceMobilityPoint}</span> : null}
              </dd>
            </div>
            <div>
              <dt>{b.requestedTimeLabel}</dt>
              <dd>{formatDateTimeShort(r.draft.requestedDepartureAt, locale)}</dd>
            </div>
          </dl>
          <p className="fm-subtitle" style={{ marginTop: 12, fontSize: 13 }}>{t.confirmHint}</p>
        </aside>
      </div>
    );
  }
}
