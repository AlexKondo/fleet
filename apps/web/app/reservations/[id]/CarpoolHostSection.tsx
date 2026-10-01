import { ConfirmSubmitButton } from "../../ConfirmSubmitButton";
import {
  hostAcceptRequest,
  hostDisableOffer,
  hostEnableOffer,
  hostRejectRequest,
  hostUpdateOffer,
} from "../../carpool/formActions";
import { carpoolReasonText, carpoolStatusText, fillTemplate } from "@/lib/carpool/errorText";
import { formatDateTimeShort } from "@/lib/formatDateTime";
import type { Locale } from "@/lib/i18n/locales";
import type { Dictionary } from "@/lib/i18n/dictionaries";

export interface HostOfferView {
  id: string;
  status: string;
  seatsOffered: number;
  seatsAvailable: number;
}

export interface HostRequestView {
  id: string;
  status: string;
  statusReason: string | null;
  riderName: string | null;
  requestedSeats: number;
  requestedDepartureAt: string;
  detourKm: number | null;
  detourMin: number | null;
  pickupLabel: string | null;
  dropoffLabel: string | null;
}

export interface HostParticipantView {
  id: string;
  name: string | null;
  seats: number;
}

const ghostButton =
  "rounded-sm border border-line-700 px-3 py-1.5 text-xs font-semibold uppercase tracking-widest text-fog-400 hover:border-signal-red hover:text-signal-red";
const tealButton =
  "rounded-sm border border-signal-teal px-3 py-1.5 text-xs font-semibold uppercase tracking-widest text-signal-teal hover:bg-signal-teal/10";
const inputClass =
  "w-24 rounded-sm border border-line-800 bg-panel-900 px-2 py-1.5 font-mono text-sm text-paper-50 outline-none focus-visible:border-gwm-accent";

/**
 * Phase C5 (pack 05 "Host UX"): the host's carpool view on My Trip. Server component - all
 * mutations are forms bound to the form-actions wrappers, which call the C4 RPCs (host
 * ownership, organization and seat accounting are enforced by the database, not here).
 *
 * Privacy: only the HOST's own riders appear (names of accepted passengers and of people who
 * asked for a ride on this very trip); nothing about any other trip.
 */
export function CarpoolHostSection({
  reservationId,
  tripRequestId,
  dict,
  locale,
  offer,
  maxSeats,
  canOffer,
  participants,
  pending,
  history,
}: {
  reservationId: string;
  tripRequestId: string;
  dict: Dictionary;
  locale: Locale;
  offer: HostOfferView | null;
  /** capacity - declared occupants (same number the DB enforces). */
  maxSeats: number;
  /** policy enabled AND reservation active AND trip not started. */
  canOffer: boolean;
  participants: HostParticipantView[];
  pending: HostRequestView[];
  history: HostRequestView[];
}) {
  const t = dict.carpool.host;
  const isActive = offer?.status === "active";
  const stateLabel = isActive ? t.stateActive : offer ? t.stateDisabled : t.stateNone;

  return (
    <section data-testid="carpool-host-section" className="mt-4 rounded-md border border-line-800 bg-panel-900/60 p-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-fog-400">{t.sectionTitle}</h2>
        <span
          data-testid="carpool-state"
          className={`rounded-sm border px-2 py-1 text-xs uppercase tracking-widest ${
            isActive ? "border-signal-teal/40 text-signal-teal" : "border-line-700 text-fog-400"
          }`}
        >
          {stateLabel}
        </span>
      </div>

      {offer ? (
        <p data-testid="carpool-seats" className="text-sm text-fog-400">
          {t.seatsOffered}: <span className="font-mono text-paper-50">{offer.seatsOffered}</span> · {t.seatsAvailable}:{" "}
          <span className="font-mono text-paper-50">{offer.seatsAvailable}</span>
        </p>
      ) : null}

      {/* Enable / update / disable controls */}
      {isActive ? (
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <form action={hostUpdateOffer.bind(null, reservationId, offer!.id)} className="flex items-end gap-2">
            <label className="flex flex-col gap-1 text-xs text-fog-400">
              {t.seatsInput}
              <input
                type="number"
                name="seats"
                min={1}
                max={Math.max(maxSeats, offer!.seatsOffered)}
                defaultValue={offer!.seatsOffered}
                className={inputClass}
              />
            </label>
            <button type="submit" className={tealButton}>
              {t.update}
            </button>
          </form>
          <form action={hostDisableOffer.bind(null, reservationId, offer!.id)}>
            <ConfirmSubmitButton confirmMessage={t.disableConfirm} className={ghostButton}>
              {t.disable}
            </ConfirmSubmitButton>
          </form>
        </div>
      ) : canOffer && maxSeats >= 1 ? (
        <form
          action={hostEnableOffer.bind(null, reservationId, tripRequestId)}
          className="mt-3 flex flex-wrap items-end gap-2"
        >
          <label className="flex flex-col gap-1 text-xs text-fog-400">
            {t.seatsInput} ({fillTemplate(t.maxSeatsHint, { max: maxSeats })})
            <input type="number" name="seats" min={1} max={maxSeats} defaultValue={maxSeats} className={inputClass} />
          </label>
          <button type="submit" className={tealButton}>
            {t.enable}
          </button>
        </form>
      ) : (
        <p className="mt-3 text-xs text-fog-600">{t.cannotOfferHint}</p>
      )}

      {/* Confirmed passengers */}
      <h3 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-widest text-fog-400">{t.participantsTitle}</h3>
      {participants.length === 0 ? (
        <p className="text-sm text-fog-600">{t.noParticipants}</p>
      ) : (
        <ul data-testid="carpool-participants" className="flex flex-col gap-1.5">
          {participants.map((p) => (
            <li key={p.id} className="text-sm text-paper-50">
              {p.name ?? "—"}
              <span className="ml-2 text-xs text-fog-600">{fillTemplate(t.requestedSeats, { count: p.seats })}</span>
            </li>
          ))}
        </ul>
      )}

      {/* Pending requests */}
      <h3 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-widest text-signal-blue">{t.pendingTitle}</h3>
      {pending.length === 0 ? (
        <p className="text-sm text-fog-600">{t.noPending}</p>
      ) : (
        <ul data-testid="carpool-pending" className="flex flex-col gap-3">
          {pending.map((r) => (
            <li key={r.id} className="rounded-sm border border-line-800 bg-panel-900/60 p-3" data-testid="carpool-pending-request">
              <p className="text-sm text-paper-50">
                {r.riderName ?? "—"}
                <span className="ml-2 text-xs text-fog-600">
                  {fillTemplate(t.requestedSeats, { count: r.requestedSeats })} · {formatDateTimeShort(r.requestedDepartureAt, locale)}
                </span>
              </p>
              {r.pickupLabel || r.dropoffLabel ? (
                <p className="mt-1 text-xs text-fog-400">
                  {r.pickupLabel ? `${t.pickupLabel}: ${r.pickupLabel}` : null}
                  {r.pickupLabel && r.dropoffLabel ? " → " : null}
                  {r.dropoffLabel ? `${t.dropoffLabel}: ${r.dropoffLabel}` : null}
                </p>
              ) : null}
              {r.detourKm !== null && r.detourMin !== null ? (
                <p className="mt-1 text-xs text-fog-600">
                  {fillTemplate(t.detourLine, { km: Math.round(r.detourKm * 10) / 10, min: Math.round(r.detourMin) })}
                </p>
              ) : null}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <form action={hostAcceptRequest.bind(null, reservationId, r.id)}>
                  <button type="submit" className={tealButton}>
                    {t.accept}
                  </button>
                </form>
                <form action={hostRejectRequest.bind(null, reservationId, r.id)} className="flex items-center gap-2">
                  <input
                    name="reason"
                    maxLength={200}
                    placeholder={t.reasonPlaceholder}
                    className="w-44 rounded-sm border border-line-800 bg-panel-900 px-2 py-1.5 text-xs text-paper-50 outline-none focus-visible:border-gwm-accent"
                  />
                  <ConfirmSubmitButton confirmMessage={t.rejectConfirm} className={ghostButton}>
                    {t.reject}
                  </ConfirmSubmitButton>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* What happened to requests that are over (incl. invalidated by host trip changes) */}
      {history.length > 0 ? (
        <>
          <h3 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-widest text-fog-400">{t.historyTitle}</h3>
          <ul data-testid="carpool-history" className="flex flex-col gap-1.5">
            {history.map((r) => (
              <li key={r.id} className="text-sm text-fog-400">
                <span className="text-paper-50">{r.riderName ?? "—"}</span> ·{" "}
                <span data-testid="carpool-history-status">{carpoolStatusText(dict, r.status)}</span>
                {r.statusReason ? <span className="text-fog-600"> — {carpoolReasonText(dict, r.statusReason)}</span> : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
