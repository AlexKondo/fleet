import Link from "next/link";
import { loadOperationalWorkspace } from "@/lib/operations/load";
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
      title="Abastecimento e Recarga Inteligente"
      subtitle="Registros reais por motorização, custos e rastreabilidade dos lançamentos."
      active="energy"
      managerView
      error={params.error}
      success={params.success}
    >
      <Metrics
        items={[
          { label: "Lançamentos válidos", value: valid?.length ?? null },
          {
            label: "Combustível registrado",
            value: fuel === null ? null : fuel.toLocaleString("pt-BR") + " L",
            tone: "amber",
          },
          {
            label: "Energia registrada",
            value:
              charge === null ? null : charge.toLocaleString("pt-BR") + " kWh",
            tone: "green",
          },
          { label: "Custo no filtro", value: money(total) },
          {
            label: "Veículos com registros",
            value: valid ? new Set(valid.map((e) => e.vehicle_id)).size : null,
          },
        ]}
      />
      <div className="ow-grid">
        <div className="ow-stack">
          <Panel title="Últimos abastecimentos e recargas">
            <form method="get" className="ow-filters">
              <label className="ow-field">
                <span>Veículo</span>
                <select name="vehicle" defaultValue={params.vehicle ?? ""}>
                  <option value="">Todos</option>
                  {data.vehicles?.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.plate}
                    </option>
                  ))}
                </select>
              </label>
              <label className="ow-field">
                <span>Tipo</span>
                <select name="kind" defaultValue={params.kind ?? ""}>
                  <option value="">Todos</option>
                  <option value="fuel">Combustível</option>
                  <option value="charge">Recarga elétrica</option>
                </select>
              </label>
              <Field label="De" name="from" type="date" value={params.from} />
              <Field label="Até" name="to" type="date" value={params.to} />
              <Submit>Filtrar</Submit>
            </form>
            {events === undefined ? (
              <Empty>Registros indisponíveis.</Empty>
            ) : !events.length ? (
              <Empty />
            ) : (
              <div className="ow-table-scroll">
                <table className="ow-table">
                  <thead>
                    <tr>
                      <th>Data</th>
                      <th>Veículo</th>
                      <th>Tipo</th>
                      <th>Quantidade</th>
                      <th>Custo</th>
                      <th>Odômetro</th>
                      <th>Fornecedor</th>
                      <th>Correção</th>
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
                              ? "Anulado"
                              : e.kind === "charge"
                                ? "Recarga"
                                : (
                                    {
                                      gasoline: "Gasolina",
                                      ethanol: "Etanol",
                                      diesel: "Diesel",
                                    } as Record<string, string>
                                  )[e.fuel_type ?? ""]}
                          </Tag>
                          {e.voided_at && <small>{e.void_reason}</small>}
                        </td>
                        <td>
                          {e.quantity.toLocaleString("pt-BR")}{" "}
                          {e.kind === "fuel" ? "L" : "kWh"}
                        </td>
                        <td>
                          {money(e.total_cost)}
                          <small>
                            {money(e.total_cost / e.quantity)} /{" "}
                            {e.kind === "fuel" ? "L" : "kWh"}
                          </small>
                        </td>
                        <td>{e.odometer_km.toLocaleString("pt-BR")} km</td>
                        <td>{e.supplier || "—"}<br/><Link href={`/documents?target=energy_event&id=${e.id}`}>Comprovantes</Link></td>
                        <td>
                          {!e.voided_at && (
                            <details>
                              <summary>Anular</summary>
                              <OperationForm
                                command="energy.void"
                                returnTo="/fleet/energy"
                                values={{ id: e.id }}
                              >
                                <Field
                                  label="Justificativa"
                                  name="reason"
                                  required
                                  maxLength={500}
                                />
                                <Submit>Registrar anulação</Submit>
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
          <Panel title="Custos por veículo">
            {!byVehicle || !valid ? (
              <Empty>Dados indisponíveis.</Empty>
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
          <Panel title="Novo lançamento">
            <OperationForm command="energy.record" returnTo="/fleet/energy">
              <VehicleSelect data={data} />
              <label className="ow-field">
                <span>Tipo</span>
                <select name="kind">
                  <option value="fuel">Abastecimento</option>
                  <option value="charge">Recarga elétrica</option>
                </select>
              </label>
              <label className="ow-field">
                <span>Combustível · somente abastecimento</span>
                <select name="fuel_type">
                  <option value="gasoline">Gasolina</option>
                  <option value="ethanol">Etanol</option>
                  <option value="diesel">Diesel</option>
                </select>
              </label>
              <Field
                label="Quantidade · litros ou kWh"
                name="quantity"
                type="number"
                min={0.001}
                step="0.001"
                required
              />
              <Field
                label="Valor total (R$)"
                name="total_cost"
                type="number"
                min={0}
                step="0.01"
                required
              />
              <Field
                label="Odômetro (km)"
                name="odometer_km"
                type="number"
                min={0}
                step="1"
                required
              />
              <Field
                label="Data e hora · Brasília"
                name="event_at"
                type="datetime-local"
                required
              />
              <Field
                label="Fornecedor / estação"
                name="supplier"
                maxLength={200}
              />
              <p className="ow-wide">
                BEV aceita recarga; ICE aceita combustível; PHEV aceita ambos. O
                registro não altera automaticamente o nível atual de combustível
                ou bateria.
              </p>
              <Submit disabled={data.migrationUnavailable || !data.vehicles}>
                Registrar lançamento
              </Submit>
            </OperationForm>
          </Panel>
          <Panel title="Indicadores com fonte validada">
            <p className="ow-muted">
              Economia contra gasolina, eficiência real e CO₂ evitado precisam
              de distância efetivamente percorrida e fatores aprovados. Nenhum
              valor é estimado a partir destes lançamentos isoladamente.
            </p>
          </Panel>
        </aside>
      </div>
    </Workspace>
  );
}
