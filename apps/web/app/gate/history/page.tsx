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
      title="Portaria — Histórico de Movimentações"
      subtitle="Saídas e chegadas físicas confirmadas, tentativas impedidas e trilha imutável."
      active="gateHistory"
      error={params.error}
      success={params.success}
    >
      <Metrics
        items={[
          {
            label: "Movimentações no filtro",
            value: rows?.filter((e) => e.kind !== "denied").length ?? null,
          },
          {
            label: "Saídas confirmadas",
            value: rows?.filter((e) => e.kind === "departure").length ?? null,
            tone: "green",
          },
          {
            label: "Chegadas confirmadas",
            value: rows?.filter((e) => e.kind === "arrival").length ?? null,
          },
          {
            label: "Saídas impedidas",
            value: rows?.filter((e) => e.kind === "denied").length ?? null,
            tone: "red",
          },
        ]}
      />
      <nav className="ow-tabs" aria-label="Portaria">
        <Link href="/gate">Fila operacional</Link>
        <Link href="/gate/exceptions">Ocorrências e exceções</Link>
        <Link href="/gate/history" aria-current="page">
          Histórico e auditoria
        </Link>
      </nav>
      <div className="ow-grid">
        <div className="ow-stack">
          <Panel title="Histórico de movimentos">
            <form className="ow-filters" method="get">
              <Field
                label="Buscar placa"
                name="q"
                value={params.q}
                maxLength={20}
              />
              <label className="ow-field">
                <span>Movimento</span>
                <select name="kind" defaultValue={params.kind ?? ""}>
                  <option value="">Todos</option>
                  <option value="departure">Saída</option>
                  <option value="arrival">Chegada</option>
                  <option value="denied">Saída impedida</option>
                </select>
              </label>
              <Submit>Filtrar</Submit>
            </form>
            {rows === undefined ? (
              <Empty>Histórico indisponível.</Empty>
            ) : !rows.length ? (
              <Empty>
                Nenhuma movimentação física registrada neste módulo.
              </Empty>
            ) : (
              <div className="ow-table-scroll">
                <table className="ow-table">
                  <thead>
                    <tr>
                      <th>Data / hora</th>
                      <th>Movimento</th>
                      <th>Veículo</th>
                      <th>Registro</th>
                      <th>Reserva</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((e) => (
                      <tr key={e.id} data-selected={e.id === selected?.id}>
                        <td>{date(e.created_at, true)}</td>
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
                              ? "Saída"
                              : e.kind === "arrival"
                                ? "Chegada"
                                : "Impedida"}
                          </Tag>
                        </td>
                        <td>
                          <strong>
                            {data.vehicles?.find((v) => v.id === e.vehicle_id)
                              ?.plate ?? "—"}
                          </strong>
                        </td>
                        <td>
                          {e.reason || "Confirmação operacional"}
                          {e.legacy_arrival && (
                            <small>
                              Sem saída anterior registrada · chegada legada
                              justificada
                            </small>
                          )}
                        </td>
                        <td>
                          <Link
                            href={`/gate/history?reservation=${e.reservation_id}`}
                          >
                            Linha do tempo →
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
          <Panel title="Registrar movimento físico">
            <p className="ow-muted">
              Saída exige reserva válida, veículo sem bloqueios e os dois
              checklists de retirada. Chegada real pode ser registrada mesmo com
              veículo bloqueado. Uma tentativa impedida nunca conta como saída.
            </p>
            <OperationForm command="gate.record" returnTo="/gate/history">
              <label className="ow-field">
                <span>Reserva / viagem</span>
                <select name="reservation_id" required defaultValue={params.reservation ?? ""}>
                  <option value="">Selecione</option>
                  {reservations?.map((r) => (
                    <option key={r.id} value={r.id}>
                      {data.vehicles?.find((v) => v.id === r.vehicle_id)?.plate}{" "}
                      · {r.trip_request?.requester?.full_name} ·{" "}
                      {date(r.start_at, true)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="ow-field">
                <span>Movimento</span>
                <select name="kind" defaultValue={params.kind === "arrival" ? "arrival" : params.kind === "denied" ? "denied" : "departure"}>
                  <option value="departure">Confirmar saída física</option>
                  <option value="arrival">Confirmar chegada física</option>
                  <option value="denied">Registrar saída impedida</option>
                </select>
              </label>
              <label className="ow-field">
                <span>Motivo / observação</span>
                <textarea name="reason" maxLength={1000} />
              </label>
              <p className="ow-wide">
                Se a viagem começou antes da implantação deste registro,
                justifique a chegada sem saída prévia. A confirmação física não
                substitui os checklists.
              </p>
              <Submit
                disabled={data.migrationUnavailable || reservations === null}
              >
                Confirmar e auditar movimento
              </Submit>
            </OperationForm>
            {reservations === null && (
              <p role="alert" className="ow-note">
                Não foi possível consultar as reservas.
              </p>
            )}
          </Panel>
        </div>
        <aside className="ow-stack">
          <Panel title="Linha do tempo da viagem">
            {!selected ? (
              <Empty>Selecione uma movimentação.</Empty>
            ) : (
              <>
                <div className="ow-detail-head">
                  <small>Veículo</small>
                  <h3>
                    {data.vehicles?.find((v) => v.id === selected.vehicle_id)
                      ?.plate ?? "—"}
                  </h3>
                  <Link
                    className="ow-link"
                    href={`/reservations/${selected.reservation_id}`}
                  >
                    Abrir reserva e checklists →
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
                            ? "Saída"
                            : e.kind === "arrival"
                              ? "Chegada"
                              : "Impedida"}
                        </Tag>
                        <div>
                          <strong>{date(e.created_at, true)}</strong>
                          <p>{e.reason}</p>
                        </div>
                      </li>
                    ))}
                </ul>
              </>
            )}
          </Panel>
          <Panel title="Integridade do histórico">
            <p className="ow-muted">
              Registros físicos não são editáveis ou excluíveis pela interface.
              O horário vem do servidor e o responsável vem da sessão
              autenticada.
            </p>
          </Panel>
        </aside>
      </div>
    </Workspace>
  );
}
