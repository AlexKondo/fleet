import { respondTakeover } from "./takeoverActions";
import { fmt } from "@/lib/i18n/areaText";
import type { TakeoverKey } from "@/lib/i18n/areas/takeover";

export interface TakeoverInfo {
  takeover_id: string;
  status: "offered" | "accepted";
  role: "candidate" | "owner";
  expires_at: string;
  other_name: string | null;
}

/** What the member needs to know / answer about the takeover of this reservation: the invitation (Aceitar / Recusar), the wait for the manager, or "it was passed on". */
export function TakeoverCard({ info, reservationId, T, whenLabel, failed }: { info: TakeoverInfo; reservationId: string; T: Record<TakeoverKey, string>; whenLabel: string; failed: boolean }) {
  const name = info.other_name ?? "—";
  if (info.role === "owner") {
    return (
      <section className="fm-card rd-takeover" data-testid="takeover-owner">
        <h2 className="fm-h2">{T.passedTitle}</h2>
        <p>{fmt(T.passedBody, { name })}</p>
      </section>
    );
  }
  if (info.status === "accepted") {
    return (
      <section className="fm-card rd-takeover" data-testid="takeover-waiting">
        <h2 className="fm-h2">{T.waitingTitle}</h2>
        <p>{T.waitingBody}</p>
      </section>
    );
  }
  return (
    <section className="fm-card rd-takeover" data-testid="takeover-invite">
      <h2 className="fm-h2">{T.inviteTitle}</h2>
      <p>{fmt(T.inviteBody, { name })}</p>
      <p className="fm-muted">{fmt(T.deadline, { date: whenLabel })}</p>
      {failed ? <p role="alert" className="fm-banner fm-banner-danger">{T.failed}</p> : null}
      <form action={respondTakeover} className="rd-takeover-actions">
        <input type="hidden" name="reservationId" value={reservationId} />
        <input type="hidden" name="takeoverId" value={info.takeover_id} />
        <button type="submit" name="answer" value="accept" className="fm-btn fm-btn-primary">{T.accept}</button>
        <button type="submit" name="answer" value="decline" className="fm-btn fm-btn-ghost">{T.decline}</button>
      </form>
    </section>
  );
}

