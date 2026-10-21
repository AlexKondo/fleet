import Link from "next/link";
import { OrderAdjustments } from "./OrderAdjustments";
import { getDictionary } from "@/lib/i18n/getLocale";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import {
  loadOperationalWorkspace,
  type OperationalData,
} from "@/lib/operations/load";
import {
  ORDER_STATES,
  orderActions,
  orderCosts,
  lineTotal,
  type WorkOrder,
} from "@/lib/operations/models";
import {
  Workspace,
  Metrics,
  Panel,
  Tag,
  Empty,
  OperationForm,
  VehicleSelect,
  Field,
  Submit,
  money,
  date,
} from "./Workspace";

type Params = {
  order?: string;
  vehicle?: string;
  status?: string;
  q?: string;
  error?: string;
  success?: string;
};
const fmt = (text: string, values: Record<string, string | number>) =>
  text.replace(/\{(\w+)\}/g, (_, k) => String(values[k] ?? ""));
export async function MaintenanceWorkspace({
  view,
  params,
  managerView = false,
}: {
  view: "overview" | "planning" | "orders" | "vehicle";
  params: Params;
  managerView?: boolean;
}) {
  const dict = await getDictionary();
  const t = dict.maintenance;
  const labels = t.orderStates;
  const data = await loadOperationalWorkspace(
    managerView
      ? ["fleet_manager", "administrator"]
      : ["fleet_manager", "administrator", "maintenance_operator"],
  );
  const { vehicles, records, manager } = data;
  const { orders, lines } = records;
  const selected = orders?.find((o) => o.id === params.order) ?? orders?.[0];
  const selectedVehicle =
    vehicles?.find((v) => v.id === (params.vehicle ?? selected?.vehicle_id)) ??
    vehicles?.[0];
  const base = managerView
    ? "/fleet/maintenance"
    : view === "overview"
      ? "/maintenance"
      : view === "planning"
        ? "/maintenance/planning"
        : view === "orders"
          ? "/maintenance/work-orders"
          : "/maintenance/vehicles";
  const titles = {
    overview: managerView ? t.titleOverviewManager : t.titleOverview,
    planning: t.titlePlanning,
    orders: t.titleOrders,
    vehicle: t.titleVehicle,
  };
  const filtered = orders?.filter(
    (o) =>
      (!params.status || o.status === params.status) &&
      (!params.q ||
        `${o.number} ${o.description} ${vehicles?.find((v) => v.id === o.vehicle_id)?.plate}`
          .toLowerCase()
          .includes(params.q.toLowerCase())),
  );
  const effective = lines ? orderCosts(lines).effective : null;
  const dueVehicles = vehicles
    ?.filter((v) => v.next_service_date || v.next_service_odometer_km !== null)
    .sort(
      (a, b) =>
        (a.next_service_odometer_km ?? Infinity) -
        a.odometer_km -
        ((b.next_service_odometer_km ?? Infinity) - b.odometer_km),
    );
  const selectedLines =
    selected && lines
      ? lines.filter((l) => l.work_order_id === selected.id)
      : null;
  return (
    <Workspace
      data={data}
      title={titles[view]}
      subtitle={t.subtitle}
      active={
        view === "overview"
          ? "maintenance"
          : view === "planning"
            ? "planning"
            : view === "orders"
              ? "orders"
              : "vehicleHistory"
      }
      error={params.error}
      success={params.success}
      managerView={managerView}
    >
      <Metrics
        ariaLabel={dict.opsShell.metricsAria}
        items={[
          {
            label: t.mOperational,
            value:
              vehicles?.filter(
                (v) => !["maintenance", "blocked"].includes(v.status),
              ).length ?? null,
            tone: "green",
          },
          {
            label: t.mInMaintenance,
            value:
              vehicles?.filter((v) => v.status === "maintenance").length ??
              null,
            tone: "red",
          },
          {
            label: t.mScheduled,
            value:
              orders?.filter((o) => o.status === "scheduled").length ?? null,
            tone: "amber",
          },
          {
            label: t.mInProgress,
            value:
              orders?.filter((o) =>
                ["in_progress", "partial"].includes(o.status),
              ).length ?? null,
          },
          {
            label: t.mEffectiveCost,
            value: money(effective),
            detail: t.mEffectiveCostDetail,
          },
        ]}
      />
      <nav className="ow-tabs" aria-label={t.tabsAria}>
        {[
          {
            href: managerView ? "/fleet/maintenance" : "/maintenance",
            label: t.tabOverview,
            key: "overview",
          },
          {
            href: "/maintenance/planning",
            label: t.tabPlanning,
            key: "planning",
          },
          {
            href: "/maintenance/work-orders",
            label: t.tabOrders,
            key: "orders",
          },
          {
            href: "/maintenance/vehicles",
            label: t.tabRecord,
            key: "vehicle",
          },
        ].map((t) => (
          <Link
            key={t.key}
            href={t.href}
            aria-current={view === t.key ? "page" : undefined}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      {view === "vehicle" ? (
        <div className="ow-grid">
          <div className="ow-stack">
            <Panel title={t.identityPanel}>
              <form className="ow-filters" method="get">
                <label className="ow-field">
                  <span>{t.vehicleLabel}</span>
                  <select name="vehicle" defaultValue={selectedVehicle?.id}>
                    {vehicles?.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.plate} · {v.name ?? v.category?.name}
                      </option>
                    ))}
                  </select>
                </label>
                <Submit>{t.consult}</Submit>
              </form>
              {!selectedVehicle ? (
                <Empty>
                  {vehicles === null ? t.fleetUnavailable : t.noVehicles}
                </Empty>
              ) : (
                <>
                  <div className="ow-detail-head">
                    <small>{selectedVehicle.category?.energy_type}</small>
                    <h3>
                      {selectedVehicle.name ?? selectedVehicle.category?.name}
                    </h3>
                    <strong>{selectedVehicle.plate}</strong><Link href={`/documents?target=vehicle&id=${selectedVehicle.id}`}>{t.vehicleDocs}</Link><Link href={`/fleet/equipment?vehicle=${selectedVehicle.id}`}>{t.equipmentLink}</Link><Link href={`/api/exports/vehicle/${selectedVehicle.id}`}>{t.exportCsv}</Link>
                    <p className="ow-vin">
                      {fmt(t.vinLine, {
                        vin: selectedVehicle.vin ?? t.notInformed,
                      })}
                    </p>
                  </div>
                  <div className="ow-costs">
                    <div>
                      <small>{t.odometer}</small>
                      <strong>
                        {selectedVehicle.odometer_km.toLocaleString("pt-BR")} km
                      </strong>
                    </div>
                    <div>
                      <small>{t.nextServiceKm}</small>
                      <strong>
                        {selectedVehicle.next_service_odometer_km?.toLocaleString(
                          "pt-BR",
                        ) ?? "—"}
                      </strong>
                    </div>
                    <div>
                      <small>{t.nextServiceDate}</small>
                      <strong>{date(selectedVehicle.next_service_date)}</strong>
                    </div>
                  </div>
                  <OrderTable
                    orders={
                      orders?.filter(
                        (o) => o.vehicle_id === selectedVehicle.id,
                      ) ?? null
                    }
                    data={data}
                    dict={dict}
                  />
                </>
              )}
            </Panel>
            <Panel title={t.costsPanel}>
              {!selectedVehicle || !orders || !lines ? (
                <Empty>{t.historyUnavailable}</Empty>
              ) : (
                <>
                  <CostSummary
                    dict={dict}
                    lines={lines.filter((l) =>
                      orders.some(
                        (o) =>
                          o.vehicle_id === selectedVehicle.id &&
                          o.id === l.work_order_id,
                      ),
                    )}
                  />
                  <p className="ow-muted">
                    {t.voidNote}
                  </p>
                </>
              )}
            </Panel>
          </div>
          <div className="ow-stack">
            <Panel title={t.conditionPanel}>
              {selectedVehicle ? (
                <dl className="ow-data-grid">
                  <div>
                    <dt>{t.state}</dt>
                    <dd>{dict.status.vehicle[selectedVehicle.status]}</dd>
                  </div>
                  <div>
                    <dt>{t.currentLocation}</dt>
                    <dd>
                      {selectedVehicle.current_location?.name ?? t.notInformed}
                    </dd>
                  </div>
                  <div>
                    <dt>{t.serviceByTime}</dt>
                    <dd>{date(selectedVehicle.next_service_date)}</dd>
                  </div>
                  <div>
                    <dt>{t.serviceByKm}</dt>
                    <dd>
                      {selectedVehicle.next_service_odometer_km ??
                        t.notInformed}
                    </dd>
                  </div>
                </dl>
              ) : (
                <Empty />
              )}
              <p className="ow-note">
                {t.serviceNote}
              </p>
            </Panel>
            {manager && selectedVehicle && (
              <Panel title={t.techPanel}>
                <OperationForm
                  command="vehicle.identity"
                  returnTo={`${base}?vehicle=${selectedVehicle.id}`}
                  values={{ vehicle_id: selectedVehicle.id }}
                >
                  <Field
                    label={t.vinField}
                    name="vin"
                    value={selectedVehicle.vin ?? ""}
                    maxLength={17}
                  />
                  <Field
                    label={t.nextServiceDate}
                    name="next_service_date"
                    type="date"
                    value={selectedVehicle.next_service_date ?? ""}
                  />
                  <Submit disabled={data.migrationUnavailable}>{t.save}</Submit>
                </OperationForm>
              </Panel>
            )}
            <MaintenanceDue data={data} dict={dict} />
          </div>
        </div>
      ) : view === "orders" ? (
        <div className="ow-grid">
          <div className="ow-stack">
            <Panel
              title={t.ordersPanel}
              action={
                <Link className="ow-link" href="#new-order">
                  {t.newOrderLink}
                </Link>
              }
            >
              <Filters params={params} dict={dict} />
              <OrderTable
                orders={filtered ?? null}
                data={data}
                dict={dict}
                selected={selected?.id}
              />
            </Panel>
            {selected && (
              <Panel
                title={fmt(t.orderServicesCosts, {
                  n: String(selected.number).padStart(6, "0"),
                })}
              >
                <OrderDetail
                  order={selected}
                  lines={selectedLines}
                  data={data}
                  dict={dict}
                  base={base}
                />
              </Panel>
            )}
            <Panel title={t.newOrderPanel}>
              <div id="new-order" />
              <OperationForm command="work_order.create" returnTo={base}>
                <VehicleSelect
                  data={data}
                  labels={{ vehicle: t.vehicleLabel, select: dict.opsShell.select }}
                />
                <label className="ow-field">
                  <span>{t.maintKind}</span>
                  <select name="kind" required>
                    <option value="preventive">{t.kindPreventive}</option>
                    <option value="corrective">{t.kindCorrective}</option>
                    <option value="inspection">{t.kindInspection}</option>
                  </select>
                </label>
                <label className="ow-field">
                  <span>{t.descDiagnosis}</span>
                  <textarea
                    name="description"
                    minLength={3}
                    maxLength={3000}
                    required
                  />
                </label>
                <Field
                  label={t.supplierShop}
                  name="supplier"
                  maxLength={200}
                />
                <Field
                  label={t.initialQuote}
                  name="quote_total"
                  type="number"
                  min={0}
                  step="0.01"
                  value={0}
                  required
                />
                <Submit
                  disabled={data.migrationUnavailable || vehicles === null}
                >
                  {t.createOrder}
                </Submit>
              </OperationForm>
            </Panel>
          </div>
          <aside className="ow-stack">
            {selected ? (
              <>
                <Panel title={t.summaryPanel}>
                  <div className="ow-detail-head">
                    <small>{fmt(t.osShort, { n: selected.number })}</small>
                    <h3>
                      {vehicles?.find((v) => v.id === selected.vehicle_id)
                        ?.plate ?? t.vehicleLabel}
                    </h3>
                    <Tag
                      tone={selected.status === "completed" ? "green" : "blue"}
                    >
                      {labels[selected.status]}
                    </Tag>
                    <p>{selected.description}</p>
                  </div>
                  <dl className="ow-data-grid">
                    <div>
                      <dt>{t.supplier}</dt>
                      <dd>{selected.supplier || t.notInformed}</dd>
                    </div>
                    <div>
                      <dt>{t.createdAt}</dt>
                      <dd>{date(selected.created_at)}</dd>
                    </div>
                    <div>
                      <dt>{t.scheduledStart}</dt>
                      <dd>{date(selected.scheduled_start, true)}</dd>
                    </div>
                    <div>
                      <dt>{t.scheduledEnd}</dt>
                      <dd>{date(selected.scheduled_end, true)}</dd>
                    </div>
                  </dl>
                  <Link
                    className="ow-link"
                    href={`/maintenance/vehicles?vehicle=${selected.vehicle_id}`}
                  >
                    {t.openRecord}
                  </Link>
                </Panel>
                <Panel title={t.historyPanel}>
                  <p className="ow-muted">
                    {fmt(t.versionNote, { v: selected.version })}
                  </p>
                  {selected.completed_at && (
                    <p className="ow-note">
                      {fmt(t.completedOn, {
                        date: date(selected.completed_at, true),
                      })}
                    </p>
                  )}
                </Panel>
              </>
            ) : (
              <MaintenanceDue data={data} dict={dict} />
            )}
          </aside>
        </div>
      ) : (
        <>
          <div className="ow-grid">
            <div className="ow-stack">
              {view === "planning" && (
                <Panel title={t.calendarPanel}>
                  <Planning data={data} dict={dict} />
                </Panel>
              )}
              <Panel
                title={
                  view === "planning" ? t.upcomingConflicts : t.fleetAndOrders
                }
                action={
                  <Link
                    className="ow-link"
                    href="/maintenance/work-orders#new-order"
                  >
                    {t.newOrderLink}
                  </Link>
                }
              >
                <Filters params={params} dict={dict} />
                <OrderTable orders={filtered ?? null} data={data} dict={dict} />
                {orders?.length === 0 && (
                  <p className="ow-note">
                    {t.firstOrderNote}
                  </p>
                )}
              </Panel>
              <Panel title={t.operationVehicles}>
                <VehicleTable data={data} dict={dict} />
              </Panel>
            </div>
            <aside className="ow-stack">
              <MaintenanceDue data={data} dict={dict} />
              <Panel title={t.alertsPanel}>
                {vehicles === null ? (
                  <Empty>{t.fleetUnavailable}</Empty>
                ) : (
                  <ul className="ow-list">
                    {vehicles
                      .filter((v) =>
                        ["blocked", "maintenance"].includes(v.status),
                      )
                      .slice(0, 8)
                      .map((v) => (
                        <li key={v.id}>
                          <Tag tone="red">!</Tag>
                          <Link href={`/maintenance/vehicles?vehicle=${v.id}`}>
                            <strong>{v.plate}</strong>
                            <p>
                              {v.status === "blocked"
                                ? t.activeBlock
                                : t.inProgressNote}
                            </p>
                          </Link>
                        </li>
                      ))}
                    {!vehicles.some((v) =>
                      ["blocked", "maintenance"].includes(v.status),
                    ) && (
                      <Empty>{t.noBlocks}</Empty>
                    )}
                  </ul>
                )}
              </Panel>
              <Panel title={t.costsSidePanel}>
                {lines ? (
                  <CostSummary lines={lines} dict={dict} />
                ) : (
                  <Empty>{t.costsUnavailable}</Empty>
                )}
              </Panel>
            </aside>
          </div>
          <div className="ow-grid-equal">
            <Panel title={t.ordersByStatus}>
              {orders ? (
                <div
                  className="ow-bars"
                  role="img"
                  aria-label={ORDER_STATES.map(
                    (s) =>
                      `${labels[s]}: ${orders.filter((o) => o.status === s).length}`,
                  ).join("; ")}
                >
                  {ORDER_STATES.filter((s) =>
                    orders.some((o) => o.status === s),
                  ).map((s) => {
                    const n = orders.filter((o) => o.status === s).length;
                    return (
                      <div key={s}>
                        <strong>{n}</strong>
                        <span
                          style={{
                            height: `${(n / Math.max(orders.length, 1)) * 110}px`,
                          }}
                        />
                        <small>{labels[s]}</small>
                      </div>
                    );
                  })}
                  {orders.length === 0 && <Empty />}
                </div>
              ) : (
                <Empty>{t.dataUnavailable}</Empty>
              )}
            </Panel>
            <Panel title={t.plannedReviews}>
              {!dueVehicles ? (
                <Empty>{t.dataUnavailable}</Empty>
              ) : (
                <ul className="ow-list">
                  {dueVehicles.slice(0, 6).map((v) => (
                    <li key={v.id}>
                      <Link href={`/maintenance/vehicles?vehicle=${v.id}`}>
                        <strong>{v.plate}</strong>
                        <small>
                          {fmt(t.dateKm, {
                            date: date(v.next_service_date),
                            km:
                              v.next_service_odometer_km?.toLocaleString(
                                "pt-BR",
                              ) ?? "—",
                          })}
                        </small>
                      </Link>
                    </li>
                  ))}
                  {!dueVehicles.length && (
                    <Empty>{t.noReviews}</Empty>
                  )}
                </ul>
              )}
            </Panel>
          </div>
        </>
      )}
    </Workspace>
  );
}
function Filters({ params, dict }: { params: Params; dict: Dictionary }) {
  const t = dict.maintenance;
  return (
    <form className="ow-filters" method="get">
      <label className="ow-field">
        <span>{t.searchOrder}</span>
        <input name="q" type="search" defaultValue={params.q} maxLength={100} />
      </label>
      <label className="ow-field">
        <span>{t.status}</span>
        <select name="status" defaultValue={params.status ?? ""}>
          <option value="">{t.all}</option>
          {ORDER_STATES.map((s) => (
            <option key={s} value={s}>
              {t.orderStates[s]}
            </option>
          ))}
        </select>
      </label>
      <Submit>{t.filter}</Submit>
    </form>
  );
}
function OrderTable({
  orders,
  data,
  dict,
  selected,
}: {
  orders: WorkOrder[] | null;
  data: OperationalData;
  dict: Dictionary;
  selected?: string;
}) {
  const t = dict.maintenance;
  if (!orders) return <Empty>{t.ordersUnavailable}</Empty>;
  if (!orders.length) return <Empty>{dict.opsShell.noRecords}</Empty>;
  return (
    <div className="ow-table-scroll">
      <table className="ow-table">
        <thead>
          <tr>
            <th>{t.colOrder}</th>
            <th>{t.colVehicle}</th>
            <th>{t.colKindDesc}</th>
            <th>{t.colSchedule}</th>
            <th>{t.colStatus}</th>
            <th>{t.colGwmCost}</th>
            <th>{t.colDetails}</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id} data-selected={selected === o.id}>
              <td>{fmt(t.osShort, { n: o.number })}</td>
              <td>
                <strong>
                  {data.vehicles?.find((v) => v.id === o.vehicle_id)?.plate ??
                    "—"}
                </strong>
              </td>
              <td>
                {o.kind === "preventive"
                  ? t.kindPreventive
                  : o.kind === "corrective"
                    ? t.kindCorrective
                    : t.kindInspection}
                <small>{o.description}</small>
              </td>
              <td>
                {date(o.scheduled_start)}
                <small>{date(o.scheduled_end)}</small>
              </td>
              <td>
                <Tag
                  tone={
                    o.status === "completed"
                      ? "green"
                      : o.status === "cancelled"
                        ? "red"
                        : o.status === "in_progress"
                          ? "amber"
                          : "blue"
                  }
                >
                  {t.orderStates[o.status]}
                </Tag>
              </td>
              <td className="ow-amount">
                {data.records.lines
                  ? money(
                      orderCosts(
                        data.records.lines.filter(
                          (l) => l.work_order_id === o.id,
                        ),
                      ).effective,
                    )
                  : "—"}
              </td>
              <td>
                <Link href={`/maintenance/work-orders?order=${o.id}`}>
                  {t.open}
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function CostSummary({
  lines,
  dict,
}: {
  lines: Parameters<typeof orderCosts>[0];
  dict: Dictionary;
}) {
  const t = dict.maintenance;
  const c = orderCosts(lines);
  return (
    <div className="ow-costs">
      <div>
        <small>{t.costExecuted}</small>
        <strong>{money(c.gross)}</strong>
      </div>
      <div>
        <small>{t.costWarranty}</small>
        <strong>{money(c.warranty)}</strong>
      </div>
      <div>
        <small>{t.costEffective}</small>
        <strong>{money(c.effective)}</strong>
      </div>
    </div>
  );
}
function OrderDetail({
  order,
  lines,
  data,
  dict,
  base,
}: {
  order: WorkOrder;
  lines: OperationalData["records"]["lines"];
  data: OperationalData;
  dict: Dictionary;
  base: string;
}) {
  const t = dict.maintenance;
  const returnTo = `${base}?order=${order.id}`;
  const mutable = !["completed", "cancelled"].includes(order.status);
  return (
    <>
      <OrderAdjustments
        adjustments={data.records.adjustments}
        order={order}
        dict={dict}
      />
      <Link href={`/documents?target=work_order&id=${order.id}`}>{t.orderDocs}</Link>
      <details>
        <summary>{t.approvalHistory}</summary>
        {data.records.approvals == null ? (
          <p>{t.approvalsUnavailable}</p>
        ) : data.records.approvals.filter((a) => a.work_order_id === order.id)
            .length === 0 ? (
          <p>{t.noApprovals}</p>
        ) : (
          data.records.approvals
            .filter((a) => a.work_order_id === order.id)
            .map((a) => (
              <p key={a.id}>
                {a.actor_name} · {money(a.amount)} · {date(a.created_at)} ·{" "}
                {fmt(t.policyRevision, { v: a.policy_snapshot.policy_version })}
                {" · "}
                {a.policy_snapshot.superior_required
                  ? t.superiorAuthorized
                  : t.managerApprover}
              </p>
            ))
        )}
      </details>
      <div className="ow-timeline" aria-label={t.stagesAria}>
        {ORDER_STATES.filter(
          (s) => s !== "cancelled" || order.status === s,
        ).map((s) => (
          <span key={s} data-active={order.status === s}>
            {t.orderStates[s]}
          </span>
        ))}
      </div>
      <div className="ow-costs">
        <div>
          <small>{t.quote}</small>
          <strong>{money(order.quote_total)}</strong>
        </div>
        <div>
          <small>{t.approved}</small>
          <strong>{money(order.approved_total)}</strong>
        </div>
        <div>
          <small>{t.effectiveGwm}</small>
          <strong>{lines ? money(orderCosts(lines).effective) : "—"}</strong>
        </div>
      </div>
      {!lines ? (
        <Empty>{t.linesUnavailable}</Empty>
      ) : !lines.length ? (
        <Empty>{t.noLines}</Empty>
      ) : (
        <div className="ow-table-scroll">
          <table className="ow-table">
            <thead>
              <tr>
                <th>{t.colItem}</th>
                <th>{t.colType}</th>
                <th>{t.colQty}</th>
                <th>{t.colUnit}</th>
                <th>{t.colTotal}</th>
                <th>{t.colCoverage}</th>
                <th>{t.colCorrection}</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id}>
                  <td>
                    {l.description}
                    <small>
                      {l.stage === "actual" ? t.stageActual : t.stagePlanned}
                    </small>
                    {l.voided_at && (
                      <small>
                        {fmt(t.voidedReason, { reason: l.void_reason ?? "" })}
                      </small>
                    )}
                  </td>
                  <td>
                    {
                      (
                        {
                          parts: t.catParts,
                          labor: t.catLabor,
                          service: t.catService,
                          other: t.catOther,
                        } as Record<string, string>
                      )[l.category]
                    }
                  </td>
                  <td>{l.quantity}</td>
                  <td>{money(l.unit_price)}</td>
                  <td>{money(lineTotal(l))}</td>
                  <td>
                    <Tag
                      tone={l.voided_at ? "red" : l.warranty ? "green" : "blue"}
                    >
                      {l.voided_at
                        ? t.covVoided
                        : l.warranty
                          ? t.covWarranty
                          : t.covGwm}
                    </Tag>
                  </td>
                  <td>
                    {mutable && !l.voided_at && (
                      <details>
                        <summary>{t.voidEntry}</summary>
                        <OperationForm
                          command="work_order.void_line"
                          returnTo={returnTo}
                          values={{
                            id: order.id,
                            version: order.version,
                            line_id: l.id,
                          }}
                        >
                          <Field
                            label={t.justification}
                            name="reason"
                            required
                            maxLength={500}
                          />
                          <Submit>{t.voidWithRecord}</Submit>
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
      {mutable && (
        <details>
          <summary>{t.addItem}</summary>
          <OperationForm
            command="work_order.line"
            returnTo={returnTo}
            values={{ id: order.id, version: order.version }}
          >
            <Field
              label={t.description}
              name="description"
              required
              maxLength={500}
            />
            <label className="ow-field">
              <span>{t.nature}</span>
              <select name="stage">
                <option value="planned">{t.stagePlanned}</option>
                {["in_progress", "partial"].includes(order.status) && (
                  <option value="actual">{t.stageActual}</option>
                )}
              </select>
            </label>
            <label className="ow-field">
              <span>{t.category}</span>
              <select name="category">
                <option value="parts">{t.catParts}</option>
                <option value="labor">{t.catLabor}</option>
                <option value="service">{t.catService}</option>
                <option value="other">{t.catOther}</option>
              </select>
            </label>
            <Field
              label={t.quantity}
              name="quantity"
              type="number"
              min={0.001}
              step="0.001"
              value={1}
              required
            />
            <Field
              label={t.unitPrice}
              name="unit_price"
              type="number"
              min={0}
              step="0.01"
              required
            />
            <label className="ow-checkbox">
              <input type="checkbox" name="warranty" />
              {t.warrantyCheck}
            </label>
            <Submit>{t.registerItem}</Submit>
          </OperationForm>
        </details>
      )}
      {mutable &&
        (data.manager || ["draft", "budgeted"].includes(order.status)) && (
          <details>
            <summary>{t.reviewBudget}</summary>
            <OperationForm
              command="work_order.budget"
              returnTo={returnTo}
              values={{ id: order.id, version: order.version }}
            >
              <Field
                label={t.newValue}
                name="quote_total"
                type="number"
                min={0}
                step="0.01"
                value={order.quote_total}
                required
              />
              <Field
                label={t.revisionReason}
                name="reason"
                required
                maxLength={500}
              />
              <p className="ow-wide">
                {t.revisionNote}
              </p>
              <Submit>{t.registerRevision}</Submit>
            </OperationForm>
          </details>
        )}
      {order.budget_pending&&!["draft","budgeted","completed","cancelled"].includes(order.status)&&<p role="status">{t.budgetPending}</p>}
      {data.manager&&order.budget_pending&&!["draft","budgeted","completed","cancelled"].includes(order.status)&&<OperationForm command="work_order.approve_budget" returnTo={returnTo} values={{id:order.id,version:order.version}}><p>{t.approveRevisedNote}</p><Submit>{t.approveRevised}</Submit></OperationForm>}
      <div className="ow-actions">
        {orderActions(order.status, data.manager).map((status) =>
          status === "scheduled" ? (
            <details key={status}>
              <summary>
                {order.status === "scheduled" ? t.reschedule : t.scheduleMaint}
              </summary>
              <OperationForm
                command="work_order.transition"
                returnTo={returnTo}
                values={{ id: order.id, version: order.version, status }}
              >
                <Field
                  label={t.startBrasilia}
                  name="scheduled_start"
                  type="datetime-local"
                  required
                />
                <Field
                  label={t.endBrasilia}
                  name="scheduled_end"
                  type="datetime-local"
                  required
                />
                <Submit>{t.validateSchedule}</Submit>
              </OperationForm>
            </details>
          ) : (
            <OperationForm
              key={status}
              command="work_order.transition"
              returnTo={returnTo}
              values={{ id: order.id, version: order.version, status }}
              className="ow-inline"
            >
              <Submit>
                {status === "cancelled"
                  ? t.actCancel
                  : status === "in_progress"
                    ? t.actStart
                    : status === "completed"
                      ? t.actComplete
                      : status === "approved"
                        ? t.actApprove
                        : status === "budgeted"
                          ? t.actSend
                          : t.actPartial}
              </Submit>
            </OperationForm>
          ),
        )}
      </div>
      <p className="ow-note">
        {t.windowNote}
      </p>
    </>
  );
}
function VehicleTable({
  data,
  dict,
}: {
  data: OperationalData;
  dict: Dictionary;
}) {
  const t = dict.maintenance;
  if (!data.vehicles) return <Empty>{t.fleetUnavailable}</Empty>;
  return (
    <div className="ow-table-scroll">
      <table className="ow-table">
        <thead>
          <tr>
            <th>{t.colVehicle}</th>
            <th>{t.colState}</th>
            <th>{t.colLocation}</th>
            <th>{t.colOdometer}</th>
            <th>{t.colNextReview}</th>
            <th>{t.colRecord}</th>
          </tr>
        </thead>
        <tbody>
          {data.vehicles.map((v) => (
            <tr key={v.id}>
              <td>
                <strong>{v.plate}</strong>
                <small>{v.name ?? v.category?.name}</small>
              </td>
              <td>
                <Tag
                  tone={
                    ["blocked", "maintenance"].includes(v.status)
                      ? "red"
                      : "green"
                  }
                >
                  {dict.status.vehicle[v.status]}
                </Tag>
              </td>
              <td>{v.current_location?.name ?? "—"}</td>
              <td>{v.odometer_km.toLocaleString("pt-BR")} km</td>
              <td>
                {date(v.next_service_date)}
                <small>
                  {v.next_service_odometer_km?.toLocaleString("pt-BR") ?? "—"}{" "}
                  km
                </small>
              </td>
              <td>
                <Link href={`/maintenance/vehicles?vehicle=${v.id}`}>
                  {t.consultArrow}
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function MaintenanceDue({
  data,
  dict,
}: {
  data: OperationalData;
  dict: Dictionary;
}) {
  const t = dict.maintenance;
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
  }).format(new Date());
  const due = data.vehicles?.filter(
    (v) =>
      (v.next_service_date && v.next_service_date <= today) ||
      (v.next_service_odometer_km !== null &&
        v.odometer_km >= v.next_service_odometer_km),
  );
  return (
    <Panel title={t.reviewsReached}>
      {!due ? (
        <Empty>{t.dataUnavailable}</Empty>
      ) : !due.length ? (
        <Empty>{t.noneDue}</Empty>
      ) : (
        <ul className="ow-list">
          {due.map((v) => (
            <li key={v.id}>
              <Tag tone="red">{t.reviewTag}</Tag>
              <Link href={`/maintenance/vehicles?vehicle=${v.id}`}>
                <strong>{v.plate}</strong>
                <small>
                  {fmt(t.dueLine, {
                    date: date(v.next_service_date),
                    km: v.next_service_odometer_km?.toLocaleString("pt-BR") ?? "—",
                  })}
                </small>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
function Planning({
  data,
  dict,
}: {
  data: OperationalData;
  dict: Dictionary;
}) {
  const t = dict.maintenance;
  const scheduled = data.records.orders?.filter(
    (o) =>
      o.scheduled_start &&
      o.scheduled_end &&
      !["cancelled", "completed"].includes(o.status),
  );
  if (!scheduled) return <Empty>{t.planningUnavailable}</Empty>;
  if (!scheduled.length)
    return (
      <Empty>{t.noWindows}</Empty>
    );
  const from = Math.min(
      ...scheduled.map((o) => Date.parse(o.scheduled_start!)),
    ),
    to = Math.max(...scheduled.map((o) => Date.parse(o.scheduled_end!))),
    span = Math.max(to - from, 3600000);
  return (
    <>
      <div className="ow-inline ow-muted">
        <span>{date(new Date(from).toISOString(), true)}</span>
        <span>→</span>
        <span>
          {date(new Date(to).toISOString(), true)} · {t.brasiliaSuffix}
        </span>
      </div>
      <div className="ow-calendar">
        {scheduled.map((o) => (
          <div className="ow-calendar-row" key={o.id}>
            <Link href={`/maintenance/work-orders?order=${o.id}`}>
              {fmt(t.osShort, { n: o.number })}
              <small>
                {data.vehicles?.find((v) => v.id === o.vehicle_id)?.plate}
              </small>
            </Link>
            <div>
              <Link
                href={`/maintenance/work-orders?order=${o.id}`}
                style={{
                  left: `${((Date.parse(o.scheduled_start!) - from) / span) * 100}%`,
                  width: `${Math.max(((Date.parse(o.scheduled_end!) - Date.parse(o.scheduled_start!)) / span) * 100, 1)}%`,
                }}
                title={fmt(t.toRange, {
                  from: date(o.scheduled_start, true),
                  to: date(o.scheduled_end, true),
                })}
              >
                {t.orderStates[o.status]}
              </Link>
            </div>
          </div>
        ))}
      </div>
      <p className="ow-note">
        {t.planningNote}
      </p>
    </>
  );
}
