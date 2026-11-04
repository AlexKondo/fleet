import Link from "next/link";
import { FmChevronIcon } from "../fmIcons";

/**
 * The buttons of a reservation card: Ver detalhes, then Saída and Retorno (only for a confirmed reservation). A button that does not apply now is shown grey
 * and disabled (e.g. Saída once the vehicle already left), so the person sees both steps of the trip.
 */
export function ReservationActions({
  id, viewDetails, pickup, returnLabel, showOps, canPickup, canReturn, hint,
}: { id: string; viewDetails: string; pickup: string; returnLabel: string; showOps: boolean; canPickup: boolean; canReturn: boolean; hint?: string | null }) {
  return (
    <>
    <div className="hm-next-actions">
      <Link href={`/reservations/${id}`} className="fm-btn fm-btn-ghost">
        {viewDetails} <FmChevronIcon />
      </Link>
      {showOps ? (
        canPickup
          ? <Link href={`/reservations/${id}/pickup`} className="fm-btn fm-btn-primary">{pickup}</Link>
          : <span className="fm-btn fm-btn-primary hm-btn-off" aria-disabled="true" data-testid="home-pickup-off">{pickup}</span>
      ) : null}
      {showOps ? (
        canReturn
          ? <Link href={`/reservations/${id}/return`} className="fm-btn fm-btn-primary">{returnLabel}</Link>
          : <span className="fm-btn fm-btn-primary hm-btn-off" aria-disabled="true" data-testid="home-return-off">{returnLabel}</span>
      ) : null}
    </div>
    {hint ? <p className="hm-muted hm-gate-hint" data-testid="home-awaiting-gate">{hint}</p> : null}
    </>
  );
}
