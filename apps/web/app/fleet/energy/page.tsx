import Link from "next/link";
import { loadOperationalWorkspace } from "@/lib/operations/load";
import { getAreaText } from "@/lib/i18n/areaText";
import { getLocale } from "@/lib/i18n/getLocale";
import { fleetEnergyTexts } from "@/lib/i18n/areas/fleetEnergy";
import {
  Workspace,
  Metrics,
  Panel,
  Empty,
  Tag,
  OperationForm,
  VehicleSelect,
  Field,
  Submit,
  money,
  date,
} from "@/app/operations/Workspace";
export default async function EnergyPage({
  searchParams,
}: {
  searchParams: Promise<{
    vehicle?: string;
    kind?: string;
    from?: string;
    to?: string;
    error?: string;
    success?: string;
  }>;
}) {
  const params = await searchParams;
  const T = await getAreaText(fleetEnergyTexts);
  const locale = await getLocale();
  const data = await loadOperationalWorkspace([
    "fleet_manager",
    "administrator",
  ]);
  const events = data.records.energy?.filter(
    (e) =>
      (!params.vehicle || e.vehicle_id === params.vehicle) &&
      (!params.kind || e.kind === params.kind) &&
      (!params.from || e.event_at >= params.from + "T03:00:00.000Z") &&
      (!params.to ||
        new Date(e.event_at).getTime() <
          new Date(params.to + "T00:00:00-03:00").getTime() + 86400000),
  );
  const valid = events?.filter((e) => !e.voided_at);
  const total = valid?.reduce((s, e) => s + e.total_cost, 0) ?? null;
  const fuel =
      valid
        ?.filter((e) => e.kind === "fuel")
        .reduce((s, e) => s + e.quantity, 0) ?? null,
    charge =
      valid
        ?.filter((e) => e.kind === "charge")
        .reduce((s, e) => s + e.quantity, 0) ?? null;
  const byVehicle = data.vehicles
    ?.map((v) => ({
      v,
      cost:
        valid
          ?.filter((e) => e.vehicle_id === v.id)
          .reduce((s, e) => s + e.total_cost, 0) ?? null,
    }))
    .sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0));
  return (
    <Workspace
      data={data}
      title={T.title}
      subtitle={T.subtitle}
      active="energy"
      managerView
      error={params.error}
      success={params.success}
    >
      <Metrics
        items={[
          { label: T.metricValidEntries, value: valid?.length ?? null },
          {
            label: T.metricFuel,
            value: fuel === null ? null : fuel.toLocaleString(locale) + " L",
            tone: "amber",
          },
          {
            label: T.metricEnergy,
            value:
              charge === null ? null : charge.toLocaleString(locale) + " kWh",
            tone: "green",
          },
          { label: T.metricCostFilter, value: money(total) },
          {
            label: T.metricVehicles,
            value: valid ? new Set(valid.map((e) => e.vehicle_id)).size : null,
          },
        ]}
      />
      <div className="ow-grid">
        <div className="ow-stack">
          <Panel title={T.panelRecent}>
            <form method="get" className="ow-filters">
              <label className="ow-field">
                <span>{T.vehicle}</span>
                <select name="vehicle" defaultValue={params.vehicle ?? ""}>
                  <option value="">{T.all}</option>
                  {data.vehicles?.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.plate}
                    </option>
                  ))}
                </select>
              </label>
              <label className="ow-field">
                <span>{T.type}</span>
                <select name="kind" defaultValue={params.kind ?? ""}>
                  <option value="">{T.all}</option>
                  <option value="fuel">{T.fuel}</option>
                  <option value="charge">{T.electricCharge}</option>
                </select>
              </label>
              <Field label={T.from} name="from" type="date" value={params.from} />
              <Field label={T.to} name="to" type="date" value={params.to} />
              <Submit>{T.filter}</Submit>
            </form>
            {events === undefined ? (
              <Empty>{T.recordsUnavailable}</Empty>
            ) : !events.length ? (
              <Empty />
            ) : (
              <div className="ow-table-scroll">
                <table className="ow-table">
                  <thead>
                    <tr>
                      <th>{T.colDate}</th>
                      <th>{T.colVehicle}</th>
                      <th>{T.colType}</th>
                      <th>{T.colQuantity}</th>
                      <th>{T.colCost}</th>
                      <th>{T.colOdometer}</th>
                      <th>{T.colSupplier}</th>
                      <th>{T.colCorrection}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {events.map((e) => (
                      <tr key={e.id}>
                        <td>{date(e.event_at, true)}</td>
                        <td>
                          <Link
                            href={`/maintenance/vehicles?vehicle=${e.vehicle_id}`}
                          >
                            {data.vehicles?.find((v) => v.id === e.vehicle_id)
                              ?.plate ?? "—"}
                          </Link>
                        </td>
                        <td>
                          <Tag
                            tone={
                              e.voided_at
                                ? "red"
                                : e.kind === "charge"
                                  ? "green"
                                  : "amber"
                            }
                          >
                            {e.voided_at
                              ? T.voided
                              : e.kind === "charge"
                                ? T.charge
                                : (
                                    {
                                      gasoline: T.gasoline,
                                      ethanol: T.ethanol,
                                      diesel: T.diesel,
                                    } as Record<string, string>
                                  )[e.fuel_type ?? ""]}
                          </Tag>
                          {e.voided_at && <small>{e.void_reason}</small>}
                        </td>
                        <td>
                          {e.quantity.toLocaleString(locale)}{" "}
                          {e.kind === "fuel" ? "L" : "kWh"}
                        </td>
                        <td>
                          {money(e.total_cost)}
                          <small>
                            {money(e.total_cost / e.quantity)} /{" "}
                            {e.kind === "fuel" ? "L" : "kWh"}
                          </small>
                        </td>
                        <td>{e.odometer_km.toLocaleString(locale)} km</td>
                        <td>{e.supplier || "—"}<br/><Link href={`/documents?target=energy_event&id=${e.id}`}>{T.receipts}</Link></td>
                        <td>
                          {!e.voided_at && (
                            <details>
                              <summary>{T.void}</summary>
                              <OperationForm
                                command="energy.void"
                                returnTo="/fleet/energy"
                                values={{ id: e.id }}
                              >
                                <Field
                                  label={T.reason}
                                  name="reason"
                                  required
                                  maxLength={500}
                                />
                                <Submit>{T.registerVoid}</Submit>
                              </OperationForm>
                            </details>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
          <Panel title={T.panelCosts}>
            {!byVehicle || !valid ? (
              <Empty>{T.dataUnavailable}</Empty>
            ) : (
              <ul className="ow-list">
                {byVehicle
                  .filter((v) => v.cost !== 0)
                  .map(({ v, cost }) => (
                    <li key={v.id}>
                      <Link href={`/fleet/energy?vehicle=${v.id}`}>
                        <strong>{v.plate}</strong>
                        <small>
                          {v.category?.name} · {v.category?.energy_type}
                        </small>
                      </Link>
                      <strong>{money(cost)}</strong>
                    </li>
                  ))}
                {!valid.length && <Empty />}
              </ul>
            )}
          </Panel>
        </div>
        <aside className="ow-stack">
          <Panel title={T.panelNew}>
            <OperationForm command="energy.record" returnTo="/fleet/energy">
              <VehicleSelect data={data} />
              <label className="ow-field">
                <span>{T.type}</span>
                <select name="kind">
                  <option value="fuel">{T.refuel}</option>
                  <option value="charge">{T.electricCharge}</option>
                </select>
              </label>
              <label className="ow-field">
                <span>{T.fuelTypeLabel}</span>
                <select name="fuel_type">
                  <option value="gasoline">{T.gasoline}</option>
                  <option value="ethanol">{T.ethanol}</option>
                  <option value="diesel">{T.diesel}</option>
                </select>
              </label>
              <Field
                label={T.quantityLabel}
                name="quantity"
                type="number"
                min={0.001}
                step="0.001"
                required
              />
              <Field
                label={T.totalValueLabel}
                name="total_cost"
                type="number"
                min={0}
                step="0.01"
                required
              />
              <Field
                label={T.odometerLabel}
                name="odometer_km"
                type="number"
                min={0}
                step="1"
                required
              />
              <Field
                label={T.eventAtLabel}
                name="event_at"
                type="datetime-local"
                required
              />
              <Field
                label={T.supplierLabel}
                name="supplier"
                maxLength={200}
              />
              <p className="ow-wide">
                {T.newEntryNote}
              </p>
              <Submit disabled={data.migrationUnavailable || !data.vehicles}>
                {T.registerEntry}
              </Submit>
            </OperationForm>
          </Panel>
          <Panel title={T.panelIndicators}>
            <p className="ow-muted">
              {T.indicatorsNote}
            </p>
          </Panel>
        </aside>
      </div>
    </Workspace>
  );
}
