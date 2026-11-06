import "../gate.css";
import { redirect } from "next/navigation";
import { loadOperationalWorkspace } from "@/lib/operations/load";
import { OperationForm, Panel, Submit, Workspace, date } from "@/app/operations/Workspace";
import { getAreaText } from "@/lib/i18n/areaText";
import { getLocale } from "@/lib/i18n/getLocale";
import { gateMovementTexts } from "@/lib/i18n/areas/gateMovement";

/**
 * The porter confirms that a vehicle left or arrived, from its button on Portaria. Only the gate records a movement (fm_verified_departure_checks refuses anyone
 * else), and a trip cannot go on without it.
 */
export default async function GateMovement({
  searchParams,
}: {
  searchParams: Promise<{ reservation?: string; kind?: string; error?: string; success?: string }>;
}) {
  const params = await searchParams;
  if (!params.reservation) redirect("/gate");
  const M = await getAreaText(gateMovementTexts);
  const locale = await getLocale();
  const data = await loadOperationalWorkspace(["security"]);
  const { data: picked, error } = await data.db
    .from("reservations")
    .select("id,vehicle_id,start_at,trip_request:trip_requests(requester:profiles(full_name))")
    .eq("organization_id", data.profile.organization_id)
    .eq("id", params.reservation)
    .in("status", ["confirmed", "completed"])
    .maybeSingle();
  if (!picked && !error) redirect("/gate");
  const arrival = params.kind === "arrival";
  const kind = arrival ? "arrival" : "departure";
  return (
    <Workspace
      data={data}
      title={arrival ? M.titleArrival : M.titleDeparture}
      subtitle={arrival ? M.noteArrival : M.noteDeparture}
      active="gate"
      error={params.error}
      success={params.success}
    >
      <div className="ow-grid">
        <div className="ow-stack">
          <Panel title={M.reservationTrip}>
            {picked ? (
              <OperationForm command="gate.record" returnTo="/gate">
                <input type="hidden" name="reservation_id" value={picked.id} />
                <div className="ow-field" data-testid="gate-fixed-reservation">
                  <span>{M.reservationTrip}</span>
                  <p>
                    <strong>{data.vehicles?.find((v) => v.id === picked.vehicle_id)?.plate}</strong> · {picked.trip_request?.requester?.full_name} · {date(picked.start_at, true, locale)}
                  </p>
                </div>
                <label className="ow-field">
                  <span>{M.movement}</span>
                  <select name="kind" defaultValue={kind}>
                    <option value={kind}>{arrival ? M.optionArrival : M.optionDeparture}</option>
                    <option value="denied">{M.optionDenied}</option>
                  </select>
                </label>
                <label className="ow-field">
                  <span>{M.noteLabel}</span>
                  <textarea name="reason" maxLength={1000} />
                </label>
                <Submit disabled={data.migrationUnavailable}>{arrival ? M.confirmArrival : M.confirmDeparture}</Submit>
              </OperationForm>
            ) : (
              <p role="alert" className="ow-note">{M.reservationsFail}</p>
            )}
          </Panel>
        </div>
      </div>
    </Workspace>
  );
}
