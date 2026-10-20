import Link from "next/link";
import {OrderAdjustments} from "./OrderAdjustments";
import {
  loadOperationalWorkspace,
  type OperationalData,
} from "@/lib/operations/load";
import {
  ORDER_LABELS,
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
export async function MaintenanceWorkspace({
  view,
  params,
  managerView = false,
}: {
  view: "overview" | "planning" | "orders" | "vehicle";
  params: Params;
  managerView?: boolean;
}) {
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
    overview: managerView
      ? "Manutenção e Disponibilidade Inteligente"
      : "Manutenção — Command Center",
    planning: "Planejamento Inteligente de Manutenção",
    orders: "Manutenção — Ordens de Serviço",
    vehicle: "Prontuário Digital do Veículo",
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
      subtitle="Controle operacional, planejamento de disponibilidade e custos auditáveis da frota."
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
        items={[
          {
            label: "Veículos operacionais",
            value:
              vehicles?.filter(
                (v) => !["maintenance", "blocked"].includes(v.status),
              ).length ?? null,
            tone: "green",
          },
          {
            label: "Em manutenção",
            value:
              vehicles?.filter((v) => v.status === "maintenance").length ??
              null,
            tone: "red",
          },
          {
            label: "Ordens programadas",
            value:
              orders?.filter((o) => o.status === "scheduled").length ?? null,
            tone: "amber",
          },
          {
            label: "Ordens em execução",
            value:
              orders?.filter((o) =>
                ["in_progress", "partial"].includes(o.status),
              ).length ?? null,
          },
          {
            label: "Custo efetivo registrado",
            value: money(effective),
            detail: "Acumulado · linhas não anuladas",
          },
        ]}
      />
      <nav className="ow-tabs" aria-label="Manutenção">
        {[
          {
            href: managerView ? "/fleet/maintenance" : "/maintenance",
            label: "Visão geral",
            key: "overview",
          },
          {
            href: "/maintenance/planning",
            label: "Planejamento",
            key: "planning",
          },
          {
            href: "/maintenance/work-orders",
            label: "Ordens de serviço",
            key: "orders",
          },
          {
            href: "/maintenance/vehicles",
            label: "Prontuário",
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
            <Panel title="Identidade e histórico do veículo">
              <form className="ow-filters" method="get">
                <label className="ow-field">
                  <span>Veículo</span>
                  <select name="vehicle" defaultValue={selectedVehicle?.id}>
                    {vehicles?.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.plate} · {v.name ?? v.category?.name}
                      </option>
                    ))}
                  </select>
                </label>
                <Submit>Consultar</Submit>
              </form>
              {!selectedVehicle ? (
                <Empty>
                  {vehicles === null
                    ? "Frota indisponível."
                    : "Nenhum veículo cadastrado."}
                </Empty>
              ) : (
                <>
                  <div className="ow-detail-head">
                    <small>{selectedVehicle.category?.energy_type}</small>
                    <h3>
                      {selectedVehicle.name ?? selectedVehicle.category?.name}
                    </h3>
                    <strong>{selectedVehicle.plate}</strong><Link href={`/documents?target=vehicle&id=${selectedVehicle.id}`}>Documentos do veículo</Link><Link href={`/fleet/equipment?vehicle=${selectedVehicle.id}`}>Equipamentos e requisitos</Link><Link href={`/api/exports/vehicle/${selectedVehicle.id}`}>Exportar prontuário CSV</Link>
                    <p className="ow-vin">
                      VIN: {selectedVehicle.vin ?? "Não informado"}
                    </p>
                  </div>
                  <div className="ow-costs">
                    <div>
                      <small>Odômetro atual</small>
                      <strong>
                        {selectedVehicle.odometer_km.toLocaleString("pt-BR")} km
                      </strong>
                    </div>
                    <div>
                      <small>Próxima revisão por km</small>
                      <strong>
                        {selectedVehicle.next_service_odometer_km?.toLocaleString(
                          "pt-BR",
                        ) ?? "—"}
                      </strong>
                    </div>
                    <div>
                      <small>Próxima revisão por data</small>
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
                  />
                </>
              )}
            </Panel>
            <Panel title="Custos e histórico de manutenção">
              {!selectedVehicle || !orders || !lines ? (
                <Empty>Histórico indisponível.</Empty>
              ) : (
                <>
                  <CostSummary
                    lines={lines.filter((l) =>
                      orders.some(
                        (o) =>
                          o.vehicle_id === selectedVehicle.id &&
                          o.id === l.work_order_id,
                      ),
                    )}
                  />
                  <p className="ow-muted">
                    Correções financeiras são registradas por anulação com
                    justificativa; o lançamento original é preservado.
                  </p>
                </>
              )}
            </Panel>
          </div>
          <div className="ow-stack">
            <Panel title="Condição operacional">
              {selectedVehicle ? (
                <dl className="ow-data-grid">
                  <div>
                    <dt>Estado</dt>
                    <dd>{selectedVehicle.status}</dd>
                  </div>
                  <div>
                    <dt>Local atual</dt>
                    <dd>
                      {selectedVehicle.current_location?.name ??
                        "Não informado"}
                    </dd>
                  </div>
                  <div>
                    <dt>Revisão por tempo</dt>
                    <dd>{date(selectedVehicle.next_service_date)}</dd>
                  </div>
                  <div>
                    <dt>Revisão por km</dt>
                    <dd>
                      {selectedVehicle.next_service_odometer_km ??
                        "Não informado"}
                    </dd>
                  </div>
                </dl>
              ) : (
                <Empty />
              )}
              <p className="ow-note">
                A revisão vence por tempo ou quilometragem, o que ocorrer
                primeiro.
              </p>
            </Panel>
            {manager && selectedVehicle && (
              <Panel title="Identidade técnica e revisão">
                <OperationForm
                  command="vehicle.identity"
                  returnTo={`${base}?vehicle=${selectedVehicle.id}`}
                  values={{ vehicle_id: selectedVehicle.id }}
                >
                  <Field
                    label="VIN (imutável após registro)"
                    name="vin"
                    value={selectedVehicle.vin ?? ""}
                    maxLength={17}
                  />
                  <Field
                    label="Próxima revisão por data"
                    name="next_service_date"
                    type="date"
                    value={selectedVehicle.next_service_date ?? ""}
                  />
                  <Submit disabled={data.migrationUnavailable}>Salvar</Submit>
                </OperationForm>
              </Panel>
            )}
            <MaintenanceDue data={data} />
          </div>
        </div>
      ) : view === "orders" ? (
        <div className="ow-grid">
          <div className="ow-stack">
            <Panel
              title="Ordens de serviço"
              action={
                <Link className="ow-link" href="#new-order">
                  + Nova ordem
                </Link>
              }
            >
              <Filters params={params} />
              <OrderTable
                orders={filtered ?? null}
                data={data}
                selected={selected?.id}
              />
            </Panel>
            {selected && (
              <Panel
                title={`OS ${String(selected.number).padStart(6, "0")} · serviços e custos`}
              >
                <OrderDetail
                  order={selected}
                  lines={selectedLines}
                  data={data}
                  base={base}
                />
              </Panel>
            )}
            <Panel title="Nova ordem de serviço">
              <div id="new-order" />
              <OperationForm command="work_order.create" returnTo={base}>
                <VehicleSelect data={data} />
                <label className="ow-field">
                  <span>Tipo de manutenção</span>
                  <select name="kind" required>
                    <option value="preventive">Preventiva</option>
                    <option value="corrective">Corretiva</option>
                    <option value="inspection">Inspeção</option>
                  </select>
                </label>
                <label className="ow-field">
                  <span>Descrição / diagnóstico</span>
                  <textarea
                    name="description"
                    minLength={3}
                    maxLength={3000}
                    required
                  />
                </label>
                <Field
                  label="Fornecedor / oficina"
                  name="supplier"
                  maxLength={200}
                />
                <Field
                  label="Orçamento inicial (R$)"
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
                  Criar ordem
                </Submit>
              </OperationForm>
            </Panel>
          </div>
          <aside className="ow-stack">
            {selected ? (
              <>
                <Panel title="Resumo da ordem">
                  <div className="ow-detail-head">
                    <small>OS {selected.number}</small>
                    <h3>
                      {vehicles?.find((v) => v.id === selected.vehicle_id)
                        ?.plate ?? "Veículo"}
                    </h3>
                    <Tag
                      tone={selected.status === "completed" ? "green" : "blue"}
                    >
                      {ORDER_LABELS[selected.status]}
                    </Tag>
                    <p>{selected.description}</p>
                  </div>
                  <dl className="ow-data-grid">
                    <div>
                      <dt>Fornecedor</dt>
                      <dd>{selected.supplier || "Não informado"}</dd>
                    </div>
                    <div>
                      <dt>Criada em</dt>
                      <dd>{date(selected.created_at)}</dd>
                    </div>
                    <div>
                      <dt>Início programado</dt>
                      <dd>{date(selected.scheduled_start, true)}</dd>
                    </div>
                    <div>
                      <dt>Fim programado</dt>
                      <dd>{date(selected.scheduled_end, true)}</dd>
                    </div>
                  </dl>
                  <Link
                    className="ow-link"
                    href={`/maintenance/vehicles?vehicle=${selected.vehicle_id}`}
                  >
                    Abrir prontuário →
                  </Link>
                </Panel>
                <Panel title="Histórico e rastreabilidade">
                  <p className="ow-muted">
                    Versão atual: {selected.version}. Todas as transições e
                    alterações são auditadas na mesma transação.
                  </p>
                  {selected.completed_at && (
                    <p className="ow-note">
                      Concluída em {date(selected.completed_at, true)}
                    </p>
                  )}
                </Panel>
              </>
            ) : (
              <MaintenanceDue data={data} />
            )}
          </aside>
        </div>
      ) : (
        <>
          <div className="ow-grid">
            <div className="ow-stack">
              {view === "planning" && (
                <Panel title="Calendário de manutenção">
                  <Planning data={data} />
                </Panel>
              )}
              <Panel
                title={
                  view === "planning"
                    ? "Próximas manutenções e conflitos"
                    : "Visão da frota e ordens de serviço"
                }
                action={
                  <Link
                    className="ow-link"
                    href="/maintenance/work-orders#new-order"
                  >
                    + Nova ordem
                  </Link>
                }
              >
                <Filters params={params} />
                <OrderTable orders={filtered ?? null} data={data} />
                {orders?.length === 0 && (
                  <p className="ow-note">
                    Cadastre a primeira ordem para planejar uma janela de
                    serviço e os custos correspondentes.
                  </p>
                )}
              </Panel>
              <Panel title="Veículos da operação">
                <VehicleTable data={data} />
              </Panel>
            </div>
            <aside className="ow-stack">
              <MaintenanceDue data={data} />
              <Panel title="Alertas e prioridades">
                {vehicles === null ? (
                  <Empty>Frota indisponível.</Empty>
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
                                ? "Bloqueio ativo. A resolução deve seguir o fluxo operacional."
                                : "Manutenção em andamento."}
                            </p>
                          </Link>
                        </li>
                      ))}
                    {!vehicles.some((v) =>
                      ["blocked", "maintenance"].includes(v.status),
                    ) && (
                      <Empty>
                        Sem bloqueios ou manutenções no estado atual.
                      </Empty>
                    )}
                  </ul>
                )}
              </Panel>
              <Panel title="Custos de manutenção">
                {lines ? (
                  <CostSummary lines={lines} />
                ) : (
                  <Empty>Custos indisponíveis.</Empty>
                )}
              </Panel>
            </aside>
          </div>
          <div className="ow-grid-equal">
            <Panel title="Ordens por situação">
              {orders ? (
                <div
                  className="ow-bars"
                  role="img"
                  aria-label={ORDER_STATES.map(
                    (s) =>
                      `${ORDER_LABELS[s]}: ${orders.filter((o) => o.status === s).length}`,
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
                        <small>{ORDER_LABELS[s]}</small>
                      </div>
                    );
                  })}
                  {orders.length === 0 && <Empty />}
                </div>
              ) : (
                <Empty>Dados indisponíveis.</Empty>
              )}
            </Panel>
            <Panel title="Revisões previstas">
              {!dueVehicles ? (
                <Empty>Dados indisponíveis.</Empty>
              ) : (
                <ul className="ow-list">
                  {dueVehicles.slice(0, 6).map((v) => (
                    <li key={v.id}>
                      <Link href={`/maintenance/vehicles?vehicle=${v.id}`}>
                        <strong>{v.plate}</strong>
                        <small>
                          Data: {date(v.next_service_date)} · Km:{" "}
                          {v.next_service_odometer_km?.toLocaleString(
                            "pt-BR",
                          ) ?? "—"}
                        </small>
                      </Link>
                    </li>
                  ))}
                  {!dueVehicles.length && (
                    <Empty>Nenhuma revisão cadastrada por data ou km.</Empty>
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
function Filters({ params }: { params: Params }) {
  return (
    <form className="ow-filters" method="get">
      <label className="ow-field">
        <span>Buscar OS ou placa</span>
        <input name="q" type="search" defaultValue={params.q} maxLength={100} />
      </label>
      <label className="ow-field">
        <span>Situação</span>
        <select name="status" defaultValue={params.status ?? ""}>
          <option value="">Todas</option>
          {ORDER_STATES.map((s) => (
            <option key={s} value={s}>
              {ORDER_LABELS[s]}
            </option>
          ))}
        </select>
      </label>
      <Submit>Filtrar</Submit>
    </form>
  );
}
function OrderTable({
  orders,
  data,
  selected,
}: {
  orders: WorkOrder[] | null;
  data: OperationalData;
  selected?: string;
}) {
  if (!orders) return <Empty>Ordens indisponíveis.</Empty>;
  if (!orders.length) return <Empty />;
  return (
    <div className="ow-table-scroll">
      <table className="ow-table">
        <thead>
          <tr>
            <th>OS</th>
            <th>Veículo</th>
            <th>Tipo / descrição</th>
            <th>Programação</th>
            <th>Situação</th>
            <th>Custo GWM</th>
            <th>Detalhes</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id} data-selected={selected === o.id}>
              <td>OS {o.number}</td>
              <td>
                <strong>
                  {data.vehicles?.find((v) => v.id === o.vehicle_id)?.plate ??
                    "—"}
                </strong>
              </td>
              <td>
                {o.kind === "preventive"
                  ? "Preventiva"
                  : o.kind === "corrective"
                    ? "Corretiva"
                    : "Inspeção"}
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
                  {ORDER_LABELS[o.status]}
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
                  Abrir →
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function CostSummary({ lines }: { lines: Parameters<typeof orderCosts>[0] }) {
  const c = orderCosts(lines);
  return (
    <div className="ow-costs">
      <div>
        <small>Valor executado</small>
        <strong>{money(c.gross)}</strong>
      </div>
      <div>
        <small>Coberto por garantia</small>
        <strong>{money(c.warranty)}</strong>
      </div>
      <div>
        <small>Custo efetivo GWM</small>
        <strong>{money(c.effective)}</strong>
      </div>
    </div>
  );
}
function OrderDetail({
  order,
  lines,
  data,
  base,
}: {
  order: WorkOrder;
  lines: OperationalData["records"]["lines"];
  data: OperationalData;
  base: string;
}) {
  const returnTo = `${base}?order=${order.id}`;
  const mutable = !["completed", "cancelled"].includes(order.status);
  return (
    <>
      <OrderAdjustments adjustments={data.records.adjustments} order={order}/>
      <Link href={`/documents?target=work_order&id=${order.id}`}>Orçamentos, notas e documentos da OS</Link>
      <details><summary>Histórico de aprovações do orçamento</summary>{data.records.approvals==null?<p>Histórico de aprovações indisponível nesta consulta.</p>:data.records.approvals.filter(a=>a.work_order_id===order.id).length===0?<p>Nenhuma aprovação registrada na nova política. Aprovações legadas permanecem no histórico de auditoria.</p>:data.records.approvals.filter(a=>a.work_order_id===order.id).map(a=><p key={a.id}>{a.actor_name} · {money(a.amount)} · {date(a.created_at)} · Política revisão {a.policy_snapshot.policy_version}{a.policy_snapshot.superior_required?" · Superior autorizado":" · Gestor aprovador"}</p>)}</details>
      <div className="ow-timeline" aria-label="Etapas da ordem">
        {ORDER_STATES.filter(
          (s) => s !== "cancelled" || order.status === s,
        ).map((s) => (
          <span key={s} data-active={order.status === s}>
            {ORDER_LABELS[s]}
          </span>
        ))}
      </div>
      <div className="ow-costs">
        <div>
          <small>Orçamento</small>
          <strong>{money(order.quote_total)}</strong>
        </div>
        <div>
          <small>Aprovado</small>
          <strong>{money(order.approved_total)}</strong>
        </div>
        <div>
          <small>Efetivo GWM</small>
          <strong>{lines ? money(orderCosts(lines).effective) : "—"}</strong>
        </div>
      </div>
      {!lines ? (
        <Empty>Linhas indisponíveis.</Empty>
      ) : !lines.length ? (
        <Empty>Ainda não há serviços ou peças lançados.</Empty>
      ) : (
        <div className="ow-table-scroll">
          <table className="ow-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Tipo</th>
                <th>Qtd.</th>
                <th>Unitário</th>
                <th>Total</th>
                <th>Cobertura</th>
                <th>Correção</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id}>
                  <td>
                    {l.description}
                    <small>
                      {l.stage === "actual" ? "Executado" : "Orçado / previsto"}
                    </small>
                    {l.voided_at && <small>Anulado: {l.void_reason}</small>}
                  </td>
                  <td>
                    {
                      (
                        {
                          parts: "Peças",
                          labor: "Mão de obra",
                          service: "Serviço",
                          other: "Outros",
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
                        ? "Anulado"
                        : l.warranty
                          ? "Garantia"
                          : "Custo GWM"}
                    </Tag>
                  </td>
                  <td>
                    {mutable && !l.voided_at && (
                      <details>
                        <summary>Anular lançamento</summary>
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
                            label="Justificativa"
                            name="reason"
                            required
                            maxLength={500}
                          />
                          <Submit>Anular com registro</Submit>
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
          <summary>+ Adicionar item / serviço</summary>
          <OperationForm
            command="work_order.line"
            returnTo={returnTo}
            values={{ id: order.id, version: order.version }}
          >
            <Field
              label="Descrição"
              name="description"
              required
              maxLength={500}
            />
            <label className="ow-field">
              <span>Natureza do lançamento</span>
              <select name="stage">
                <option value="planned">Orçado / previsto</option>
                {["in_progress", "partial"].includes(order.status) && (
                  <option value="actual">Executado</option>
                )}
              </select>
            </label>
            <label className="ow-field">
              <span>Categoria</span>
              <select name="category">
                <option value="parts">Peças</option>
                <option value="labor">Mão de obra</option>
                <option value="service">Serviço</option>
                <option value="other">Outros</option>
              </select>
            </label>
            <Field
              label="Quantidade"
              name="quantity"
              type="number"
              min={0.001}
              step="0.001"
              value={1}
              required
            />
            <Field
              label="Preço unitário (R$)"
              name="unit_price"
              type="number"
              min={0}
              step="0.01"
              required
            />
            <label className="ow-checkbox">
              <input type="checkbox" name="warranty" />
              Coberto por garantia (sem custo GWM)
            </label>
            <Submit>Registrar item</Submit>
          </OperationForm>
        </details>
      )}
      {mutable &&
        (data.manager || ["draft", "budgeted"].includes(order.status)) && (
          <details>
            <summary>
              Revisar orçamento
            </summary>
            <OperationForm
              command="work_order.budget"
              returnTo={returnTo}
              values={{ id: order.id, version: order.version }}
            >
              <Field
                label="Novo valor (R$)"
                name="quote_total"
                type="number"
                min={0}
                step="0.01"
                value={order.quote_total}
                required
              />
              <Field
                label="Justificativa da revisão"
                name="reason"
                required
                maxLength={500}
              />
              <p className="ow-wide">
                Revisar o orçamento não altera o limite aprovado. A revisão aguarda aprovação independente conforme a política da unidade.
              </p>
              <Submit>Registrar revisão</Submit>
            </OperationForm>
          </details>
        )}
      {order.budget_pending&&!["draft","budgeted","completed","cancelled"].includes(order.status)&&<p role="status">Revisão de orçamento pendente. Limite aprovado preservado até nova aprovação.</p>}
      {data.manager&&order.budget_pending&&!["draft","budgeted","completed","cancelled"].includes(order.status)&&<OperationForm command="work_order.approve_budget" returnTo={returnTo} values={{id:order.id,version:order.version}}><p>A aprovação exige pessoa independente e autorização vigente na unidade.</p><Submit>Aprovar orçamento revisado</Submit></OperationForm>}
      <div className="ow-actions">
        {orderActions(order.status, data.manager).map((status) =>
          status === "scheduled" ? (
            <details key={status}>
              <summary>
                {order.status === "scheduled"
                  ? "Reprogramar janela"
                  : "Programar manutenção"}
              </summary>
              <OperationForm
                command="work_order.transition"
                returnTo={returnTo}
                values={{ id: order.id, version: order.version, status }}
              >
                <Field
                  label="Início · horário de Brasília"
                  name="scheduled_start"
                  type="datetime-local"
                  required
                />
                <Field
                  label="Fim · horário de Brasília"
                  name="scheduled_end"
                  type="datetime-local"
                  required
                />
                <Submit>Validar conflitos e programar</Submit>
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
                  ? "Cancelar ordem"
                  : status === "in_progress"
                    ? "Iniciar / retomar execução"
                    : status === "completed"
                      ? "Concluir serviço"
                      : status === "approved"
                        ? "Aprovar orçamento"
                        : status === "budgeted"
                          ? "Enviar orçamento"
                          : "Registrar execução parcial"}
              </Submit>
            </OperationForm>
          ),
        )}
      </div>
      <p className="ow-note">
        Uma janela programada bloqueia novas reservas nesse intervalo. O início
        do serviço usa o fluxo de tarefas existente; a conclusão reconcilia a
        disponibilidade. Ações concorrentes exigem recarregar a versão atual.
      </p>
    </>
  );
}
function VehicleTable({ data }: { data: OperationalData }) {
  if (!data.vehicles) return <Empty>Frota indisponível.</Empty>;
  return (
    <div className="ow-table-scroll">
      <table className="ow-table">
        <thead>
          <tr>
            <th>Veículo</th>
            <th>Estado</th>
            <th>Local</th>
            <th>Odômetro</th>
            <th>Próxima revisão</th>
            <th>Prontuário</th>
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
                  {v.status}
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
                  Consultar →
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function MaintenanceDue({ data }: { data: OperationalData }) {
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
    <Panel title="Revisões atingidas">
      {!due ? (
        <Empty>Dados indisponíveis.</Empty>
      ) : !due.length ? (
        <Empty>Nenhuma revisão vencida nos limites cadastrados.</Empty>
      ) : (
        <ul className="ow-list">
          {due.map((v) => (
            <li key={v.id}>
              <Tag tone="red">Revisão</Tag>
              <Link href={`/maintenance/vehicles?vehicle=${v.id}`}>
                <strong>{v.plate}</strong>
                <small>
                  Data: {date(v.next_service_date)} · Km limite:{" "}
                  {v.next_service_odometer_km?.toLocaleString("pt-BR") ?? "—"}
                </small>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
function Planning({ data }: { data: OperationalData }) {
  const scheduled = data.records.orders?.filter(
    (o) =>
      o.scheduled_start &&
      o.scheduled_end &&
      !["cancelled", "completed"].includes(o.status),
  );
  if (!scheduled) return <Empty>Planejamento indisponível.</Empty>;
  if (!scheduled.length)
    return (
      <Empty>
        Nenhuma janela programada. Abra uma ordem aprovada para programar.
      </Empty>
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
        <span>{date(new Date(to).toISOString(), true)} · Brasília</span>
      </div>
      <div className="ow-calendar">
        {scheduled.map((o) => (
          <div className="ow-calendar-row" key={o.id}>
            <Link href={`/maintenance/work-orders?order=${o.id}`}>
              OS {o.number}
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
                title={`${date(o.scheduled_start, true)} a ${date(o.scheduled_end, true)}`}
              >
                {ORDER_LABELS[o.status]}
              </Link>
            </div>
          </div>
        ))}
      </div>
      <p className="ow-note">
        Janelas reais cadastradas. Conflitos são verificados novamente no banco
        ao programar e ao reservar.
      </p>
    </>
  );
}
