import "../gate.css";
import Link from "next/link";
import { loadOperationalWorkspace } from "@/lib/operations/load";
import {
  Workspace,
  Metrics,
  Panel,
  Empty,
  Tag,
  Field,
  Submit,
  date,
  OperationForm,
} from "@/app/operations/Workspace";
import { pageAll } from "@/lib/carpool/kpi/loadKpis";
import { getAreaText } from "@/lib/i18n/areaText";
import { getDictionary, getLocale } from "@/lib/i18n/getLocale";
import { gateHistoryTexts } from "@/lib/i18n/areas/gateHistory";
export default async function GateHistory({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    kind?: string;
    reservation?: string;
    error?: string;
    success?: string;
  }>;
}) {
  const params = await searchParams;
  const T = await getAreaText(gateHistoryTexts);
  const locale = await getLocale();
  const opsShell = (await getDictionary()).opsShell;
  const data = await loadOperationalWorkspace([
    "security",
    "fleet_manager",
    "administrator",
  ]);
  const rows = data.records.gate?.filter(
    (e) =>
      (!params.kind || e.kind === params.kind) &&
      (!params.q ||
        data.vehicles
          ?.find((v) => v.id === e.vehicle_id)
          ?.plate.toLowerCase()
          .includes(params.q.toLowerCase())),
  );
  const selected =
    rows?.find((e) => e.reservation_id === params.reservation) ?? rows?.[0];
  const reservations = await pageAll("gate available reservations", (a, b) =>
    (data.manager ? data.db.from("fm_managed_reservations") : data.db.from("reservations"))
      .select(
        "id,status,vehicle_id,start_at,end_at,trip_request:trip_requests(origin,destination,requester:profiles(full_name))",
      )
      .eq("organization_id", data.profile.organization_id)
      .in("status", ["confirmed", "completed"])
      .order("id")
      .range(a, b),
  ).catch(() => null);
  return (
    <Workspace
      data={data}
      title={T.title}
      subtitle={T.subtitle}
      active="gateHistory"
      error={params.error}
      success={params.success}
    >
      <Metrics
        ariaLabel={opsShell.metricsAria}
        items={[
          {
            label: T.mMovements,
            value: rows?.filter((e) => e.kind !== "denied").length ?? null,
          },
          {
            label: T.mDepartures,
            value: rows?.filter((e) => e.kind === "departure").length ?? null,
            tone: "green",
          },
          {
            label: T.mArrivals,
            value: rows?.filter((e) => e.kind === "arrival").length ?? null,
          },
          {
            label: T.mDenied,
            value: rows?.filter((e) => e.kind === "denied").length ?? null,
            tone: "red",
          },
        ]}
      />
      <div className="ow-grid">
        <div className="ow-stack">
          <Panel title={T.historyPanel}>
            <form className="ow-filters" method="get">
              <Field
                label={T.searchPlate}
                name="q"
                value={params.q}
                maxLength={20}
              />
              <label className="ow-field">
                <span>{T.movement}</span>
                <select name="kind" defaultValue={params.kind ?? ""}>
                  <option value="">{T.all}</option>
                  <option value="departure">{T.optDeparture}</option>
                  <option value="arrival">{T.optArrival}</option>
                  <option value="denied">{T.optDenied}</option>
                </select>
              </label>
              <Submit>{T.filter}</Submit>
            </form>
            {rows === undefined ? (
              <Empty>{T.historyUnavailable}</Empty>
            ) : !rows.length ? (
              <Empty>{T.noMovements}</Empty>
            ) : (
              <div className="ow-table-scroll">
                <table className="ow-table">
                  <thead>
                    <tr>
                      <th>{T.thDateTime}</th>
                      <th>{T.thMovement}</th>
                      <th>{T.thVehicle}</th>
                      <th>{T.thRecord}</th>
                      <th>{T.thReservation}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((e) => (
                      <tr key={e.id} data-selected={e.id === selected?.id}>
                        <td>{date(e.created_at, true, locale)}</td>
                        <td>
                          <Tag
                            tone={
                              e.kind === "denied"
                                ? "red"
                                : e.kind === "arrival"
                                  ? "green"
                                  : "blue"
                            }
                          >
                            {e.kind === "departure"
                              ? T.tagDeparture
                              : e.kind === "arrival"
                                ? T.tagArrival
                                : T.tagDenied}
                          </Tag>
                        </td>
                        <td>
                          <strong>
                            {data.vehicles?.find((v) => v.id === e.vehicle_id)
                              ?.plate ?? "—"}
                          </strong>
                        </td>
                        <td>
                          {e.reason || T.operationalConfirmation}
                          {e.legacy_arrival && (
                            <small>
                              {T.legacyArrival}
                            </small>
                          )}
                        </td>
                        <td>
                          <Link
                            href={`/gate/history?reservation=${e.reservation_id}`}
                          >
                            {T.timeline}
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
          <Panel title={T.recordPanel}>
            <p className="ow-muted">
              {T.recordNote}
            </p>
            <OperationForm command="gate.record" returnTo="/gate/history">
              <label className="ow-field">
                <span>{T.reservationTrip}</span>
                <select name="reservation_id" required defaultValue={params.reservation ?? ""}>
                  <option value="">{T.select}</option>
                  {reservations?.map((r) => (
                    <option key={r.id} value={r.id}>
                      {data.vehicles?.find((v) => v.id === r.vehicle_id)?.plate}{" "}
                      · {r.trip_request?.requester?.full_name} ·{" "}
                      {date(r.start_at, true, locale)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="ow-field">
                <span>{T.movement}</span>
                <select name="kind" defaultValue={params.kind === "arrival" ? "arrival" : params.kind === "denied" ? "denied" : "departure"}>
                  <option value="departure">{T.confirmDeparture}</option>
                  <option value="arrival">{T.confirmArrival}</option>
                  <option value="denied">{T.recordDenied}</option>
                </select>
              </label>
              <label className="ow-field">
                <span>{T.reasonNote}</span>
                <textarea name="reason" maxLength={1000} />
              </label>
              <p className="ow-wide">
                {T.legacyNote}
              </p>
              <Submit
                disabled={data.migrationUnavailable || reservations === null}
              >
                {T.confirmAudit}
              </Submit>
            </OperationForm>
            {reservations === null && (
              <p role="alert" className="ow-note">
                {T.reservationsFail}
              </p>
            )}
          </Panel>
        </div>
        <aside className="ow-stack">
          <Panel title={T.timelinePanel}>
            {!selected ? (
              <Empty>{T.selectMovement}</Empty>
            ) : (
              <>
                <div className="ow-detail-head">
                  <small>{T.vehicle}</small>
                  <h3>
                    {data.vehicles?.find((v) => v.id === selected.vehicle_id)
                      ?.plate ?? "—"}
                  </h3>
                  <Link
                    className="ow-link"
                    href={`/reservations/${selected.reservation_id}`}
                  >
                    {T.openReservation}
                  </Link>
                </div>
                <ul className="ow-list">
                  {data.records.gate
                    ?.filter(
                      (e) => e.reservation_id === selected.reservation_id,
                    )
                    .slice()
                    .reverse()
                    .map((e) => (
                      <li key={e.id}>
                        <Tag tone={e.kind === "denied" ? "red" : "blue"}>
                          {e.kind === "departure"
                            ? T.tagDeparture
                            : e.kind === "arrival"
                              ? T.tagArrival
                              : T.tagDenied}
                        </Tag>
                        <div>
                          <strong>{date(e.created_at, true, locale)}</strong>
                          <p>{e.reason}</p>
                        </div>
                      </li>
                    ))}
                </ul>
              </>
            )}
          </Panel>
          <Panel title={T.integrityPanel}>
            <p className="ow-muted">
              {T.integrityNote}
            </p>
          </Panel>
        </aside>
      </div>
    </Workspace>
  );
}
