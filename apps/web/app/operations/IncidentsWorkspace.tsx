import Link from "next/link";
import {IncidentCases} from "./IncidentCases";
import {incidentCommand} from "@/app/fleet/incidents/actions";
import {randomUUID} from "node:crypto";
import { loadOperationalWorkspace } from "@/lib/operations/load";
import { pageAll } from "@/lib/carpool/kpi/loadKpis";
import { fmt, getAreaText } from "@/lib/i18n/areaText";
import { getDictionary, getLocale } from "@/lib/i18n/getLocale";
import { incidentsTexts } from "@/lib/i18n/areas/incidents";
import {
  Workspace,
  Metrics,
  Panel,
  Empty,
  Tag,
  OperationForm,
  Field,
  Submit,
  date,
} from "./Workspace";
export async function IncidentsWorkspace({
  gate,
  params,
}: {
  gate: boolean;
  params: {
    q?: string;
    inspection?: string;
    type?: string;
    error?: string;
    success?: string;
    case?: string;
    caseStatus?: string;
    caseError?: string;
  };
}) {
  const T = await getAreaText(incidentsTexts);
  const locale = await getLocale();
  const opsShell = (await getDictionary()).opsShell;
  const data = await loadOperationalWorkspace(
    gate
      ? ["security", "fleet_manager", "administrator"]
      : ["fleet_manager", "administrator"],
  );
  const inspections = await pageAll("incident inspections", (a, b) =>
    (data.manager ? data.db.from("fm_managed_inspections") : data.db.from("inspections"))
      .select(
        "id,vehicle_id,reservation_id,type,performed_by_role,odometer_km,has_new_damage,damage_notes,missing_safety_equipment,is_dirty_exterior,is_dirty_interior,created_at",
      )
      .eq("organization_id", data.profile.organization_id)
      .order("id")
      .range(a, b),
  ).catch(() => null);
  const incidents = inspections?.filter(
    (i) =>
      i.has_new_damage ||
      (i.missing_safety_equipment?.length ?? 0) ||
      i.is_dirty_exterior ||
      i.is_dirty_interior,
  );
  const filtered = incidents?.filter(
    (i) =>
      (!params.q ||
        `${data.vehicles?.find((v) => v.id === i.vehicle_id)?.plate} ${i.damage_notes ?? ""}`
          .toLowerCase()
          .includes(params.q.toLowerCase())) &&
      (!params.type ||
        (params.type === "damage"
          ? i.has_new_damage
          : params.type === "equipment"
            ? (i.missing_safety_equipment?.length ?? 0)
            : i.is_dirty_exterior || i.is_dirty_interior)),
  );
  const selected =
    filtered?.find((i) => i.id === params.inspection) ?? filtered?.[0];
  const base = gate ? "/gate/exceptions" : "/fleet/incidents";
  const acks = data.records.acknowledgements;
  const casePanel=!gate?await IncidentCases({data,params,T,locale}):null;
  return (
    <Workspace
      data={data}
      title={
        gate
          ? T.gateTitle
          : T.title
      }
      subtitle={
        gate
          ? T.gateSubtitle
          : T.subtitle
      }
      active={gate ? "gateExceptions" : "incidents"}
      managerView={!gate}
      error={params.error}
      success={params.success}
    >
      {casePanel}
      <Metrics
        ariaLabel={opsShell.metricsAria}
        items={[
          {
            label: T.mReports,
            value: incidents?.length ?? null,
            tone: "red",
          },
          {
            label: T.mChecklists,
            value: inspections?.length ?? null,
          },
          {
            label: T.mDamage,
            value: incidents?.filter((i) => i.has_new_damage).length ?? null,
            tone: "amber",
          },
          {
            label: T.mEquipment,
            value:
              incidents?.filter((i) => (i.missing_safety_equipment?.length ?? 0))
                .length ?? null,
          },
          {
            label: T.mAcks,
            value: acks?.length ?? null,
            tone: "green",
          },
        ]}
      />
      {gate && (
        <nav className="ow-tabs" aria-label={T.gateNavAria}>
          <Link href="/gate">{T.tabQueue}</Link>
          <Link href="/gate/exceptions" aria-current="page">
            {T.tabExceptions}
          </Link>
          <Link href="/gate/history">{T.tabHistory}</Link>
        </nav>
      )}
      <div className="ow-grid">
        <div className="ow-stack">
          <Panel title={T.panelRegistered}>
            <form method="get" className="ow-filters">
              <Field
                label={T.searchLabel}
                name="q"
                value={params.q}
                maxLength={100}
              />
              <label className="ow-field">
                <span>{T.reportType}</span>
                <select name="type" defaultValue={params.type ?? ""}>
                  <option value="">{T.all}</option>
                  <option value="damage">{T.typeDamage}</option>
                  <option value="equipment">{T.typeEquipment}</option>
                  <option value="cleaning">{T.typeCleaning}</option>
                </select>
              </label>
              <Submit>{T.filter}</Submit>
            </form>
            {inspections === null ? (
              <Empty>{T.loadFail}</Empty>
            ) : !filtered?.length ? (
              <Empty>{T.noneInFilter}</Empty>
            ) : (
              <div className="ow-table-scroll">
                <table className="ow-table">
                  <thead>
                    <tr>
                      <th>{T.thDateTime}</th>
                      <th>{T.thVehicle}</th>
                      <th>{T.thReport}</th>
                      <th>{T.thChecklist}</th>
                      <th>{T.thOrigin}</th>
                      <th>{T.thAck}</th>
                      <th>{T.thOpen}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((i) => (
                      <tr key={i.id} data-selected={i.id === selected?.id}>
                        <td>{date(i.created_at, true, locale)}</td>
                        <td>
                          <strong>
                            {data.vehicles?.find((v) => v.id === i.vehicle_id)
                              ?.plate ?? "—"}
                          </strong>
                        </td>
                        <td>
                          {i.has_new_damage && <Tag tone="red">{T.typeDamage}</Tag>}{" "}
                          {(i.missing_safety_equipment?.length ?? 0) > 0 && (
                            <Tag tone="amber">{T.typeEquipment}</Tag>
                          )}{" "}
                          {(i.is_dirty_exterior || i.is_dirty_interior) && (
                            <Tag>{T.typeCleaning}</Tag>
                          )}
                        </td>
                        <td>
                          {i.type === "pickup" ? T.pickup : T.returnTrip}
                        </td>
                        <td>
                          {i.performed_by_role === "security"
                            ? T.security
                            : T.employee}
                        </td>
                        <td>
                          {acks === null
                            ? "—"
                            : acks.some((a) => a.inspection_id === i.id)
                              ? T.ackDone
                              : T.ackNone}
                        </td>
                        <td>
                          <Link href={`${base}?inspection=${i.id}`}>
                            {T.analyze}
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
          <Panel title={T.integrityPanel}>
            <p className="ow-muted">
              {T.integrityNote}
            </p>
          </Panel>
        </div>
        <aside className="ow-stack">
          <Panel title={T.analysisPanel}>
            {!selected ? (
              <Empty>{T.selectReport}</Empty>
            ) : (
              <>
                <div className="ow-detail-head">
                  <small>
                    {selected.performed_by_role === "security"
                      ? T.security
                      : T.employee}{" "}
                    · {date(selected.created_at, true, locale)}
                  </small>
                  <h3>
                    {data.vehicles?.find((v) => v.id === selected.vehicle_id)
                      ?.plate ?? "—"}
                  </h3>
                  <p>{selected.damage_notes || T.noExtraDescription}</p>
                </div>
                <dl className="ow-data-grid">
                  <div>
                    <dt>{T.odometer}</dt>
                    <dd>{selected.odometer_km===null ? T.odometerNotObserved : fmt(T.odometerValue, { km: selected.odometer_km.toLocaleString(locale) })}</dd>
                  </div>
                  <div>
                    <dt>{T.thChecklist}</dt>
                    <dd>
                      {selected.type === "pickup" ? T.pickup : T.returnTrip}
                    </dd>
                  </div>
                  <div>
                    <dt>{T.missingEquipment}</dt>
                    <dd>
                      {(selected.missing_safety_equipment ?? []).join(", ") ||
                        T.noneRecorded}
                    </dd>
                  </div>
                  <div>
                    <dt>{T.cleaning}</dt>
                    <dd>
                      {[
                        selected.is_dirty_exterior ? T.exterior : null,
                        selected.is_dirty_interior ? T.interior : null,
                      ]
                        .filter(Boolean)
                        .join(" / ") || T.noReport}
                    </dd>
                  </div>
                </dl>
                <Link
                  className="ow-link"
                  href={`/reservations/${selected.reservation_id}`}
                >
                  {T.openReservation}
                </Link>
                {!gate&&<details><summary>{T.openTreatment}</summary><form action={incidentCommand} className="ow-form"><input type="hidden" name="command" value="create"/><input type="hidden" name="request_id" value={randomUUID()}/><input type="hidden" name="vehicle_id" value={selected.vehicle_id}/><input type="hidden" name="inspection_id" value={selected.id}/><input type="hidden" name="reservation_id" value={selected.reservation_id}/><input type="hidden" name="kind" value={selected.has_new_damage?'damage':selected.missing_safety_equipment?.length?'equipment':'cleaning'}/><Field label={T.incidentTitleLabel} name="title" required maxLength={160} value={selected.has_new_damage?T.titleDamage:selected.missing_safety_equipment?.length?T.titleEquipment:T.titleCleaning}/><label className="ow-field">{T.severity}<select name="severity"><option value="low">{T.sevLow}</option><option value="medium">{T.sevMedium}</option><option value="high">{T.sevHigh}</option><option value="critical">{T.sevCritical}</option></select></label><label className="ow-field">{T.descContext}<textarea name="notes" required minLength={3} maxLength={3000} defaultValue={selected.damage_notes??''}/></label><Submit>{T.registerLinked}</Submit></form></details>}
                {acks === null ? (
                  <Empty>{T.acksUnavailable}</Empty>
                ) : acks.some(
                    (a) =>
                      a.inspection_id === selected.id &&
                      a.actor_id === data.profile.id,
                  ) ? (
                  <p className="ow-banner">
                    {T.alreadyAcked}
                  </p>
                ) : (
                  <details open>
                    <summary>{T.registerAck}</summary>
                    <OperationForm
                      command="incident.ack"
                      returnTo={`${base}?inspection=${selected.id}`}
                      values={{ inspection_id: selected.id }}
                    >
                      <label className="ow-field">
                        <span>{T.note}</span>
                        <textarea name="notes" maxLength={1000} />
                      </label>
                      <Submit disabled={data.migrationUnavailable}>
                        {T.confirmAck}
                      </Submit>
                    </OperationForm>
                  </details>
                )}
                <ul className="ow-list">
                  {acks
                    ?.filter((a) => a.inspection_id === selected.id)
                    .map((a) => (
                      <li key={a.id}>
                        <Tag tone="green">{T.ackTag}</Tag>
                        <div>
                          <strong>{date(a.created_at, true, locale)}</strong>
                          <p>{a.notes || T.reportAnalyzed}</p>
                        </div>
                      </li>
                    ))}
                </ul>
              </>
            )}
          </Panel>
          <Panel title={T.actionsPanel}>
            <div className="ow-actions">
              <Link className="ow-button ow-button-secondary" href="/gate">
                {T.openGateQueue}
              </Link>
              {data.manager && (
                <Link className="ow-button" href="/dashboard#open-tasks">
                  {T.treatTasks}
                </Link>
              )}
            </div>
            <p className="ow-note">
              {T.ackNote}
            </p>
          </Panel>
        </aside>
      </div>
    </Workspace>
  );
}
