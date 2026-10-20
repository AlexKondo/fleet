import Link from "next/link";
import { loadOperationalWorkspace } from "@/lib/operations/load";
import { pageAll } from "@/lib/carpool/kpi/loadKpis";
import {
  Workspace,
  Metrics,
  Panel,
  Empty,
  Tag,
  Field,
  Submit,
  date,
} from "@/app/operations/Workspace";
export default async function Drivers({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; driver?: string; status?: string }>;
}) {
  const params = await searchParams;
  const data = await loadOperationalWorkspace([
    "fleet_manager",
    "administrator",
  ]);
  const [members, licenses] = await Promise.all([
    pageAll("driver profiles", (a, b) =>
      data.db
        .from("fm_managed_people")
        .select("id,full_name,role")
        .eq("organization_id", data.profile.organization_id)
        .order("id")
        .range(a, b),
    ).catch(() => null),
    data.db.rpc("list_member_licenses"),
  ]);
  const licenseAvailable = !licenses.error && Array.isArray(licenses.data);
  const byId = new Map((licenses.data ?? []).map((l) => [l.id, l]));
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
  }).format(new Date());
  const rows = members?.map((p) => {
    const l = byId.get(p.id);
    const state =
      !licenseAvailable || !l
        ? "unknown"
        : !l.drivers_license_number || !l.drivers_license_expiration
          ? "missing"
          : l.drivers_license_expiration < today
            ? "expired"
            : !l.driver_authorized
              ? "unauthorized"
              : "ready";
    return { ...p, license: l, state };
  });
  const filtered = rows?.filter(
    (r) =>
      (!params.q ||
        r.full_name
          .toLocaleLowerCase("pt-BR")
          .includes(params.q.toLocaleLowerCase("pt-BR"))) &&
      (!params.status || r.state === params.status),
  );
  const selected =
    filtered?.find((r) => r.id === params.driver) ?? filtered?.[0];
  const label: Record<string, string> = {
    unknown: "Indisponível",
    missing: "Documentação pendente",
    expired: "CNH vencida",
    unauthorized: "Sem autorização",
    ready: "Habilitação e autorização válidas",
  };
  return (
    <Workspace
      data={data}
      title="Gestão Inteligente de Motoristas e Condutores"
      subtitle="Habilitação, validade documental e autorização para conduzir veículos da frota."
      active="drivers"
      managerView
    >
      {!licenseAvailable && (
        <p role="alert" className="ow-banner ow-error">
          Não foi possível consultar as habilitações. Nenhuma ausência ou
          autorização foi inferida a partir dessa falha.
        </p>
      )}
      <Metrics
        items={[
          { label: "Colaboradores no escopo", value: rows?.length ?? null },
          {
            label: "Aptos nos registros atuais",
            value: licenseAvailable
              ? (rows?.filter((r) => r.state === "ready").length ?? null)
              : null,
            tone: "green",
          },
          {
            label: "CNH vencida",
            value: licenseAvailable
              ? (rows?.filter((r) => r.state === "expired").length ?? null)
              : null,
            tone: "red",
          },
          {
            label: "Documentação pendente",
            value: licenseAvailable
              ? (rows?.filter((r) => r.state === "missing").length ?? null)
              : null,
            tone: "amber",
          },
          {
            label: "Sem autorização",
            value: licenseAvailable
              ? (rows?.filter((r) => r.state === "unauthorized").length ?? null)
              : null,
          },
        ]}
      />
      <div className="ow-grid">
        <Panel title="Motoristas e colaboradores">
          <form method="get" className="ow-filters">
            <Field
              label="Buscar nome"
              name="q"
              value={params.q}
              maxLength={100}
            />
            <label className="ow-field">
              <span>Situação</span>
              <select name="status" defaultValue={params.status ?? ""}>
                <option value="">Todas</option>
                {Object.entries(label).map(([key, text]) => (
                  <option key={key} value={key}>
                    {text}
                  </option>
                ))}
              </select>
            </label>
            <Submit>Filtrar</Submit>
          </form>
          {members === null ? (
            <Empty>Colaboradores indisponíveis.</Empty>
          ) : !filtered?.length ? (
            <Empty />
          ) : (
            <div className="ow-table-scroll">
              <table className="ow-table">
                <thead>
                  <tr>
                    <th>Colaborador</th>
                    <th>Perfil</th>
                    <th>CNH</th>
                    <th>Categoria</th>
                    <th>Validade</th>
                    <th>Autorização</th>
                    <th>Detalhes</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr key={r.id} data-selected={r.id === selected?.id}>
                      <td>
                        <strong>{r.full_name}</strong>
                      </td>
                      <td>
                        {
                          (
                            {
                              employee: "Colaborador",
                              fleet_manager: "Gestor de Frota",
                              administrator: "Administrador",
                              maintenance_operator: "Manutenção",
                              security: "Portaria",
                            } as Record<string, string>
                          )[r.role]
                        }
                      </td>
                      <td>
                        {licenseAvailable
                          ? r.license?.drivers_license_number
                            ? "••••" +
                              r.license.drivers_license_number.slice(-4)
                            : "Não informada"
                          : "—"}
                      </td>
                      <td>
                        {licenseAvailable
                          ? (r.license?.drivers_license_category ?? "—")
                          : "—"}
                      </td>
                      <td>
                        {licenseAvailable
                          ? date(r.license?.drivers_license_expiration ?? null)
                          : "—"}
                      </td>
                      <td>
                        <Tag
                          tone={
                            r.state === "ready"
                              ? "green"
                              : r.state === "expired"
                                ? "red"
                                : "amber"
                          }
                        >
                          {label[r.state]}
                        </Tag>
                      </td>
                      <td>
                        <Link href={`/fleet/drivers?driver=${r.id}`}>
                          Abrir →
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
        <aside className="ow-stack">
          <Panel title="Detalhes do condutor">
            {!selected ? (
              <Empty>Selecione um colaborador.</Empty>
            ) : (
              <>
                <div className="ow-detail-head">
                  <h3>{selected.full_name}</h3>
                  <Tag tone={selected.state === "ready" ? "green" : "amber"}>
                    {label[selected.state]}
                  </Tag>
                </div>
                <dl className="ow-data-grid">
                  <div>
                    <dt>Categoria da CNH</dt>
                    <dd>
                      {licenseAvailable
                        ? (selected.license?.drivers_license_category ?? "—")
                        : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt>Validade</dt>
                    <dd>
                      {licenseAvailable
                        ? date(
                            selected.license?.drivers_license_expiration ??
                              null,
                          )
                        : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt>Autorização cadastrada</dt>
                    <dd>
                      {licenseAvailable
                        ? selected.license?.driver_authorized
                          ? "Sim"
                          : "Não"
                        : "Indisponível"}
                    </dd>
                  </div>
                </dl>
                {data.profile.role === "administrator" ? (
                  <Link className="ow-button" href="/settings/users">
                    Administrar documentos e autorização
                  </Link>
                ) : (
                  <p className="ow-note">
                    A alteração dos documentos e da autorização permanece
                    restrita ao administrador, conforme a permissão existente.
                  </p>
                )}
              </>
            )}
          </Panel>
          <Panel title="Privacidade e elegibilidade">
            <p className="ow-muted">
              Número da CNH mascarado. As validações da reserva e da retirada
              continuam sendo executadas no backend; a consulta desta tela não
              concede autorização.
            </p>
          </Panel>
        </aside>
      </div>
    </Workspace>
  );
}
