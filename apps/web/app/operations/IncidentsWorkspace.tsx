import Link from "next/link";
import {IncidentCases} from "./IncidentCases";
import {incidentCommand} from "@/app/fleet/incidents/actions";
import {randomUUID} from "node:crypto";
import { loadOperationalWorkspace } from "@/lib/operations/load";
import { pageAll } from "@/lib/carpool/kpi/loadKpis";
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
  const casePanel=!gate?await IncidentCases({data,params}):null;
  return (
    <Workspace
      data={data}
      title={
        gate
          ? "Portaria — Ocorrências e Exceções"
          : "Gestão Inteligente de Ocorrências e Checklists"
      }
      subtitle={
        gate
          ? "Análise dos relatos de checklist, bloqueios e registro de ciência da portaria."
          : "Evidências, equipamentos e ações operacionais vinculadas aos checklists da frota."
      }
      active={gate ? "gateExceptions" : "incidents"}
      managerView={!gate}
      error={params.error}
      success={params.success}
    >
      {casePanel}
      <Metrics
        items={[
          {
            label: "Relatos identificados",
            value: incidents?.length ?? null,
            tone: "red",
          },
          {
            label: "Checklists consultados",
            value: inspections?.length ?? null,
          },
          {
            label: "Relatos de dano",
            value: incidents?.filter((i) => i.has_new_damage).length ?? null,
            tone: "amber",
          },
          {
            label: "Equipamento ausente",
            value:
              incidents?.filter((i) => (i.missing_safety_equipment?.length ?? 0))
                .length ?? null,
          },
          {
            label: "Ciências registradas",
            value: acks?.length ?? null,
            tone: "green",
          },
        ]}
      />
      {gate && (
        <nav className="ow-tabs" aria-label="Portaria">
          <Link href="/gate">Fila operacional</Link>
          <Link href="/gate/exceptions" aria-current="page">
            Ocorrências e exceções
          </Link>
          <Link href="/gate/history">Histórico e auditoria</Link>
        </nav>
      )}
      <div className="ow-grid">
        <div className="ow-stack">
          <Panel title="Ocorrências registradas nos checklists">
            <form method="get" className="ow-filters">
              <Field
                label="Buscar placa ou relato"
                name="q"
                value={params.q}
                maxLength={100}
              />
              <label className="ow-field">
                <span>Tipo de relato</span>
                <select name="type" defaultValue={params.type ?? ""}>
                  <option value="">Todos</option>
                  <option value="damage">Dano</option>
                  <option value="equipment">Equipamento</option>
                  <option value="cleaning">Limpeza</option>
                </select>
              </label>
              <Submit>Filtrar</Submit>
            </form>
            {inspections === null ? (
              <Empty>Não foi possível consultar os checklists.</Empty>
            ) : !filtered?.length ? (
              <Empty>
                Nenhum relato de dano, limpeza ou equipamento neste filtro.
              </Empty>
            ) : (
              <div className="ow-table-scroll">
                <table className="ow-table">
                  <thead>
                    <tr>
                      <th>Data / hora</th>
                      <th>Veículo</th>
                      <th>Relato</th>
                      <th>Checklist</th>
                      <th>Origem</th>
                      <th>Ciência</th>
                      <th>Abrir</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((i) => (
                      <tr key={i.id} data-selected={i.id === selected?.id}>
                        <td>{date(i.created_at, true)}</td>
                        <td>
                          <strong>
                            {data.vehicles?.find((v) => v.id === i.vehicle_id)
                              ?.plate ?? "—"}
                          </strong>
                        </td>
                        <td>
                          {i.has_new_damage && <Tag tone="red">Dano</Tag>}{" "}
                          {(i.missing_safety_equipment?.length ?? 0) > 0 && (
                            <Tag tone="amber">Equipamento</Tag>
                          )}{" "}
                          {(i.is_dirty_exterior || i.is_dirty_interior) && (
                            <Tag>Limpeza</Tag>
                          )}
                        </td>
                        <td>
                          {i.type === "pickup" ? "Retirada" : "Devolução"}
                        </td>
                        <td>
                          {i.performed_by_role === "security"
                            ? "Portaria"
                            : "Colaborador"}
                        </td>
                        <td>
                          {acks === null
                            ? "—"
                            : acks.some((a) => a.inspection_id === i.id)
                              ? "Registrada"
                              : "Sem ciência"}
                        </td>
                        <td>
                          <Link href={`${base}?inspection=${i.id}`}>
                            Analisar →
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
          <Panel title="Integridade das inspeções">
            <p className="ow-muted">
              Os registros do colaborador e da portaria permanecem
              independentes. Dar ciência não encerra o relato, não apaga
              evidências e não libera um veículo bloqueado.
            </p>
          </Panel>
        </div>
        <aside className="ow-stack">
          <Panel title="Análise da ocorrência">
            {!selected ? (
              <Empty>Selecione um relato.</Empty>
            ) : (
              <>
                <div className="ow-detail-head">
                  <small>
                    {selected.performed_by_role === "security"
                      ? "Portaria"
                      : "Colaborador"}{" "}
                    · {date(selected.created_at, true)}
                  </small>
                  <h3>
                    {data.vehicles?.find((v) => v.id === selected.vehicle_id)
                      ?.plate ?? "—"}
                  </h3>
                  <p>{selected.damage_notes || "Sem descrição adicional."}</p>
                </div>
                <dl className="ow-data-grid">
                  <div>
                    <dt>Odômetro</dt>
                    <dd>{selected.odometer_km===null ? "Não observado nesta conferência" : `${selected.odometer_km.toLocaleString("pt-BR")} km`}</dd>
                  </div>
                  <div>
                    <dt>Checklist</dt>
                    <dd>
                      {selected.type === "pickup" ? "Retirada" : "Devolução"}
                    </dd>
                  </div>
                  <div>
                    <dt>Equipamentos ausentes</dt>
                    <dd>
                      {(selected.missing_safety_equipment ?? []).join(", ") ||
                        "Nenhum registrado"}
                    </dd>
                  </div>
                  <div>
                    <dt>Limpeza</dt>
                    <dd>
                      {[
                        selected.is_dirty_exterior ? "Externa" : null,
                        selected.is_dirty_interior ? "Interna" : null,
                      ]
                        .filter(Boolean)
                        .join(" / ") || "Sem relato"}
                    </dd>
                  </div>
                </dl>
                <Link
                  className="ow-link"
                  href={`/reservations/${selected.reservation_id}`}
                >
                  Abrir reserva, fotos e checklists →
                </Link>
                {!gate&&<details><summary>Abrir tratamento deste relato</summary><form action={incidentCommand} className="ow-form"><input type="hidden" name="command" value="create"/><input type="hidden" name="request_id" value={randomUUID()}/><input type="hidden" name="vehicle_id" value={selected.vehicle_id}/><input type="hidden" name="inspection_id" value={selected.id}/><input type="hidden" name="reservation_id" value={selected.reservation_id}/><input type="hidden" name="kind" value={selected.has_new_damage?'damage':selected.missing_safety_equipment?.length?'equipment':'cleaning'}/><Field label="Título da ocorrência" name="title" required maxLength={160} value={selected.has_new_damage?'Relato de dano no checklist':selected.missing_safety_equipment?.length?'Equipamento ausente no checklist':'Relato de limpeza no checklist'}/><label className="ow-field">Severidade<select name="severity"><option value="low">Baixa</option><option value="medium">Média</option><option value="high">Alta</option><option value="critical">Crítica</option></select></label><label className="ow-field">Descrição e contexto<textarea name="notes" required minLength={3} maxLength={3000} defaultValue={selected.damage_notes??''}/></label><Submit>Registrar ocorrência vinculada</Submit></form></details>}
                {acks === null ? (
                  <Empty>Ciências indisponíveis.</Empty>
                ) : acks.some(
                    (a) =>
                      a.inspection_id === selected.id &&
                      a.actor_id === data.profile.id,
                  ) ? (
                  <p className="ow-banner">
                    Você já registrou ciência deste relato.
                  </p>
                ) : (
                  <details open>
                    <summary>Registrar ciência</summary>
                    <OperationForm
                      command="incident.ack"
                      returnTo={`${base}?inspection=${selected.id}`}
                      values={{ inspection_id: selected.id }}
                    >
                      <label className="ow-field">
                        <span>Observação</span>
                        <textarea name="notes" maxLength={1000} />
                      </label>
                      <Submit disabled={data.migrationUnavailable}>
                        Confirmar ciência
                      </Submit>
                    </OperationForm>
                  </details>
                )}
                <ul className="ow-list">
                  {acks
                    ?.filter((a) => a.inspection_id === selected.id)
                    .map((a) => (
                      <li key={a.id}>
                        <Tag tone="green">Ciência</Tag>
                        <div>
                          <strong>{date(a.created_at, true)}</strong>
                          <p>{a.notes || "Relato analisado."}</p>
                        </div>
                      </li>
                    ))}
                </ul>
              </>
            )}
          </Panel>
          <Panel title="Ações operacionais">
            <div className="ow-actions">
              <Link className="ow-button ow-button-secondary" href="/gate">
                Abrir fila da portaria
              </Link>
              {data.manager && (
                <Link className="ow-button" href="/dashboard#open-tasks">
                  Tratar tarefas e bloqueios
                </Link>
              )}
            </div>
            <p className="ow-note">
              A ciência não substitui a resolução operacional das pendências.
            </p>
          </Panel>
        </aside>
      </div>
    </Workspace>
  );
}
