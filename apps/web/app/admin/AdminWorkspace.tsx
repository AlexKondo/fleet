import Link from "next/link";
import { randomUUID } from "node:crypto";
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
import { adminCommand } from "./actions";
type Governance = {
  policy: { enabled: boolean; version: number; confirmation_required: boolean };
  policy_versions: {
    id: string;
    version: number;
    assistant_enabled: boolean;
    reason: string;
    created_at: string;
  }[];
  privacy_requests: {
    id: string;
    subject_id: string;
    kind: string;
    summary: string;
    status: string;
    response: string | null;
    version: number;
    created_at: string;
  }[];
};
function governance(v: unknown): Governance | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const r = v as Partial<Governance>;
  return r.policy &&
    typeof r.policy.enabled === "boolean" &&
    typeof r.policy.version === "number" &&
    Array.isArray(r.policy_versions) &&
    Array.isArray(r.privacy_requests)
    ? (r as Governance)
    : null;
}
const auditLabels: Record<string, string> = {
  "maintenance.policy": "Política de aprovação de manutenção alterada",
  "work_order.approval": "Orçamento aprovado pela pessoa autorizada",
  "work_order.approve_budget": "Revisão do orçamento aprovada",
  "work_order.create": "OS criada",
  "work_order.transition": "Estado da OS alterado",
  "work_order.line": "Item da OS registrado",
  "work_order.budget": "Orçamento revisado",
  "work_order.void_line": "Item anulado",
  "gate.record": "Movimento físico registrado",
  "incident.ack": "Ciência registrada",
  "energy.record": "Energia registrada",
  "energy.void": "Lançamento anulado",
  "vehicle.identity": "Identidade técnica atualizada",
  "ai.policy": "Política do assistente alterada",
  "privacy.submitted": "Solicitação de privacidade",
  "privacy.respond": "Tratamento de solicitação",
};
export async function AdminWorkspace({
  view,
  params,
}: {
  view: "overview" | "integrations" | "audit" | "ai";
  params: { q?: string; action?: string; error?: string; success?: string };
}) {
  const data = await loadOperationalWorkspace(["administrator"]);
  const org = data.profile.organization_id;
  const [audit, users, quota, adminResult] = await Promise.all([
    pageAll("admin audit", (a, b) =>
      data.db
        .from("audit_log")
        .select(
          "id,actor_role,action,entity_type,entity_id,created_at,correlation_id",
        )
        .eq("organization_id", org)
        .order("id")
        .range(a, b),
    ).catch(() => null),
    pageAll("admin profiles", (a, b) =>
      data.db
        .from("profiles")
        .select("id,full_name,role")
        .eq("organization_id", org)
        .order("id")
        .range(a, b),
    ).catch(() => null),
    pageAll("admin provider counters", (a, b) =>
      data.db
        .from("geo_provider_quota_counters")
        .select(
          "id,day,provider_call_kind,call_count,error_count,total_latency_ms",
        )
        .eq("organization_id", org)
        .order("id")
        .range(a, b),
    ).catch(() => null),
    data.db.rpc("fm_admin_snapshot"),
  ]);
  const state = adminResult.error ? null : governance(adminResult.data);
  const titles = {
    overview: "Administração do Sistema — Command Center",
    integrations: "Integrações e Saúde do Sistema",
    audit: "Auditoria, Segurança e Privacidade",
    ai: "Configuração de Inteligência Artificial",
  };
  const filtered = audit
    ?.filter(
      (a) =>
        (!params.action || a.action === params.action) &&
        (!params.q ||
          `${a.action} ${a.entity_type} ${a.correlation_id}`
            .toLowerCase()
            .includes(params.q.toLowerCase())),
    )
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const links = [
    [
      "/settings/users",
      "Usuários, Perfis e Permissões",
      "Gestão existente de contas, CNH e autorização",
    ],
    [
      "/settings",
      "Políticas Operacionais",
      "Configurações existentes da organização",
    ],
    [
      "/admin/integrations",
      "Integrações e Saúde",
      "Configuração e leituras reais dos adapters",
    ],
    [
      "/admin/audit",
      "Auditoria e Privacidade",
      "Trilha imutável e solicitações dos titulares",
    ],
    [
      "/admin/ai",
      "Governança de IA",
      "Controle efetivo do assistente e versões",
    ],
    [
      "/settings/mobility-points",
      "Locais de Mobilidade",
      "Pontos corporativos já cadastrados",
    ],
  ];
  const google = Boolean(process.env.GOOGLE_MAPS_API_KEY),
    smtp = Boolean(
      process.env.BREVO_SMTP_HOST &&
        process.env.BREVO_SMTP_LOGIN &&
        process.env.BREVO_SMTP_PASSWORD,
    ),
    dbConfig = Boolean(
      process.env.NEXT_PUBLIC_SUPABASE_URL &&
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    );
  const calls = quota?.reduce((s, q) => s + q.call_count, 0) ?? null,
    failures = quota?.reduce((s, q) => s + q.error_count, 0) ?? null;
  return (
    <Workspace
      data={data}
      title={titles[view]}
      subtitle="Visão geral, configuração segura, rastreabilidade e governança da plataforma."
      active="settings"
      error={params.error}
      success={params.success}
    >
      <nav className="ow-tabs" aria-label="Administração">
        {[
          ["overview", "/admin", "Visão geral"],
          ["integrations", "/admin/integrations", "Integrações"],
          ["audit", "/admin/audit", "Auditoria e privacidade"],
          ["ai", "/admin/ai", "Governança de IA"],
          ["units", "/admin/units", "Unidades e chaves"],
        ].map(([k, url, label]) => (
          <Link
            href={url!}
            key={k}
            aria-current={view === k ? "page" : undefined}
          >
            {label}
          </Link>
        ))}
      </nav>
      {!state && (
        <p role="alert" className="ow-banner ow-error">
          A governança não pôde ser consultada. Verifique a migração 0075 e a
          conexão. Nenhuma política foi presumida como ativa.
        </p>
      )}
      <Metrics
        items={[
          {
            label: "Veículos cadastrados",
            value: data.vehicles?.length ?? null,
          },
          { label: "Usuários no escopo", value: users?.length ?? null },
          {
            label: "Locais cadastrados",
            value: data.locations?.length ?? null,
          },
          {
            label: "Solicitações de privacidade abertas",
            value:
              state?.privacy_requests.filter(
                (r) => !["completed", "rejected"].includes(r.status),
              ).length ?? null,
            tone: "amber",
          },
          { label: "Eventos auditados", value: audit?.length ?? null },
        ]}
      />
      {view === "overview" ? (
        <>
          <Panel title="Módulos administrativos">
            <nav className="ow-links" aria-label="Módulos">
              {links.map(([url, label, detail]) => (
                <Link href={url!} key={url}>
                  {label}
                  <small>{detail}</small>
                </Link>
              ))}
            </nav>
          </Panel>
          <div className="ow-grid-equal">
            <Panel title="Atividade recente">
              {!audit ? (
                <Empty>Auditoria indisponível.</Empty>
              ) : (
                <ul className="ow-list">
                  {audit
                    .slice()
                    .sort((a, b) => b.created_at.localeCompare(a.created_at))
                    .slice(0, 8)
                    .map((a) => (
                      <li key={a.id}>
                        <Tag>{a.entity_type}</Tag>
                        <div>
                          <strong>{auditLabels[a.action] ?? a.action}</strong>
                          <small>
                            {date(a.created_at, true)} ·{" "}
                            {a.actor_role ?? "Sistema"}
                          </small>
                        </div>
                      </li>
                    ))}
                  {!audit.length && <Empty />}
                </ul>
              )}
            </Panel>
            <Panel title="Governança e saúde observada">
              <ul className="ow-list">
                <li>
                  <strong>Assistente FleetMind</strong>
                  <Tag tone={state?.policy.enabled ? "green" : "amber"}>
                    {state
                      ? state.policy.enabled
                        ? "Habilitado"
                        : "Desativado"
                      : "Indisponível"}
                  </Tag>
                </li>
                <li>
                  <strong>Google Maps / Routes</strong>
                  <span>
                    {google
                      ? "Credencial configurada; conferir leituras"
                      : "Credencial não configurada"}
                  </span>
                </li>
                <li>
                  <strong>SMTP</strong>
                  <span>
                    {smtp
                      ? "Configurado; entrega não comprovada"
                      : "Não configurado"}
                  </span>
                </li>
              </ul>
              <p className="ow-note">
                A presença de uma credencial não comprova disponibilidade ou
                entrega.
              </p>
            </Panel>
          </div>
        </>
      ) : view === "integrations" ? (
        <div className="ow-grid">
          <div className="ow-stack">
            <Panel
              title="Status das integrações"
              action={
                <Link className="ow-link" href="/admin/integrations">
                  Atualizar leituras
                </Link>
              }
            >
              <div className="ow-table-scroll">
                <table className="ow-table">
                  <thead>
                    <tr>
                      <th>Integração</th>
                      <th>Configuração</th>
                      <th>Evidência disponível</th>
                      <th>Observação</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Supabase</td>
                      <td>
                        <Tag tone={dbConfig ? "green" : "amber"}>
                          {dbConfig ? "Configurado" : "Não configurado"}
                        </Tag>
                      </td>
                      <td>
                        {users
                          ? "Consulta autenticada concluída"
                          : "Consulta não confirmada"}
                      </td>
                      <td>Autenticação, dados e armazenamento</td>
                    </tr>
                    <tr>
                      <td>Google Maps / Routes</td>
                      <td>
                        <Tag tone={google ? "green" : "amber"}>
                          {google ? "Configurado" : "Não configurado"}
                        </Tag>
                      </td>
                      <td>
                        {calls === null
                          ? "Leituras indisponíveis"
                          : `${calls} chamadas · ${failures} erros registrados`}
                      </td>
                      <td>
                        Contadores operacionais; sem teste sintético faturável
                      </td>
                    </tr>
                    <tr>
                      <td>SMTP transacional</td>
                      <td>
                        <Tag tone={smtp ? "green" : "amber"}>
                          {smtp ? "Configurado" : "Não configurado"}
                        </Tag>
                      </td>
                      <td>Entrega não comprovada por esta consulta</td>
                      <td>
                        Configuração permanece no ambiente; valores não expostos
                      </td>
                    </tr>
                    <tr>
                      <td>SAP</td>
                      <td>
                        <Tag>Futuro / condicional</Tag>
                      </td>
                      <td>Sem adapter validado</td>
                      <td>Integração não declarada ativa</td>
                    </tr>
                    <tr>
                      <td>WhatsApp</td>
                      <td>
                        <Tag>Não integrado</Tag>
                      </td>
                      <td>Sem fornecedor validado</td>
                      <td>Comunicação in-app permanece disponível</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </Panel>
            <Panel title="Leituras do provedor geográfico">
              {!quota ? (
                <Empty>Contadores indisponíveis.</Empty>
              ) : !quota.length ? (
                <Empty>Ainda não há chamadas registradas.</Empty>
              ) : (
                <div className="ow-table-scroll">
                  <table className="ow-table">
                    <thead>
                      <tr>
                        <th>Data</th>
                        <th>Operação</th>
                        <th>Chamadas</th>
                        <th>Erros</th>
                        <th>Latência média observada</th>
                      </tr>
                    </thead>
                    <tbody>
                      {quota
                        .slice()
                        .sort((a, b) => b.day.localeCompare(a.day))
                        .map((q) => (
                          <tr key={q.id}>
                            <td>{date(q.day)}</td>
                            <td>{q.provider_call_kind}</td>
                            <td>{q.call_count}</td>
                            <td>{q.error_count}</td>
                            <td>
                              {q.call_count
                                ? Math.round(
                                    Number(q.total_latency_ms) / q.call_count,
                                  ) + " ms"
                                : "—"}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          </div>
          <Panel title="Segurança das integrações">
            <p className="ow-muted">
              Credenciais ficam no ambiente e não são retornadas ao navegador. A
              atualização desta tela consulta evidências existentes; não envia
              mensagens, não reprocessa transações e não altera as cotas.
            </p>
          </Panel>
        </div>
      ) : view === "ai" ? (
        <div className="ow-grid">
          <div className="ow-stack">
            <Panel title="Recursos de inteligência e automação">
              <div className="ow-links">
                <div className="ow-panel">
                  <strong>Assistente FleetMind</strong>
                  <p className="ow-note">
                    O controle é verificado no servidor antes de mensagens e
                    confirmações.
                  </p>
                  <Tag tone={state?.policy.enabled ? "green" : "amber"}>
                    {state
                      ? state.policy.enabled
                        ? "Habilitado"
                        : "Desativado"
                      : "Indisponível"}
                  </Tag>
                </div>
                <div className="ow-panel">
                  <strong>Reserva inteligente</strong>
                  <p className="ow-note">
                    Política determinística configurada na organização; os
                    fluxos manuais permanecem disponíveis.
                  </p>
                  <Link className="ow-link" href="/settings">
                    Abrir políticas
                  </Link>
                </div>
                <div className="ow-panel">
                  <strong>Smart Carpool</strong>
                  <p className="ow-note">
                    Matching explicável, tolerâncias e consentimento
                    preservados.
                  </p>
                  <Link className="ow-link" href="/settings">
                    Abrir política de caronas
                  </Link>
                </div>
              </div>
            </Panel>
            <Panel title="Histórico de versões">
              {state ? (
                <>
                  <div className="ow-table-scroll">
                    <table className="ow-table">
                      <thead>
                        <tr>
                          <th>Versão</th>
                          <th>Assistente</th>
                          <th>Motivo</th>
                          <th>Data</th>
                        </tr>
                      </thead>
                      <tbody>
                        {state.policy_versions.map((v) => (
                          <tr key={v.id}>
                            <td>{v.version}</td>
                            <td>
                              {v.assistant_enabled
                                ? "Habilitado"
                                : "Desativado"}
                            </td>
                            <td>{v.reason}</td>
                            <td>{date(v.created_at, true)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {state && state.policy_versions.length === 0 && (
                    <Empty>
                      Nenhuma alteração publicada. A política inicial preserva o
                      funcionamento existente.
                    </Empty>
                  )}
                </>
              ) : (
                <Empty>Histórico indisponível.</Empty>
              )}
            </Panel>
          </div>
          <Panel title="Publicar política do assistente">
            <form action={adminCommand} className="ow-form">
              <input type="hidden" name="command" value="ai.policy" />
              <input type="hidden" name="request_id" value={randomUUID()} />
              <input
                type="hidden"
                name="version"
                value={state?.policy.version ?? -1}
              />
              <label className="ow-checkbox">
                <input
                  name="enabled"
                  type="checkbox"
                  defaultChecked={state?.policy.enabled ?? false}
                  disabled={!state}
                />
                Assistente habilitado
              </label>
              <label className="ow-field">
                <span>Justificativa</span>
                <textarea
                  name="reason"
                  minLength={3}
                  maxLength={1000}
                  required
                />
              </label>
              <p className="ow-wide">
                Ações críticas continuam exigindo confirmação humana. Esta tela
                não habilita autonomia para aprovar, reservar ou liberar
                veículos.
              </p>
              <Submit disabled={!state}>Publicar nova versão</Submit>
            </form>
          </Panel>
        </div>
      ) : (
        <>
          <div className="ow-grid">
            <Panel title="Lista de eventos de auditoria">
              <form className="ow-filters" method="get">
                <Field
                  label="Buscar ação, entidade ou correlação"
                  name="q"
                  value={params.q}
                  maxLength={100}
                />
                <label className="ow-field">
                  <span>Ação</span>
                  <select name="action" defaultValue={params.action ?? ""}>
                    <option value="">Todas</option>
                    {[...new Set(audit?.map((a) => a.action))]
                      .sort()
                      .map((a) => (
                        <option key={a} value={a}>
                          {auditLabels[a] ?? a}
                        </option>
                      ))}
                  </select>
                </label>
                <Submit>Filtrar</Submit>
              </form>
              {!filtered ? (
                <Empty>Auditoria indisponível.</Empty>
              ) : !filtered.length ? (
                <Empty />
              ) : (
                <div className="ow-table-scroll">
                  <table className="ow-table">
                    <thead>
                      <tr>
                        <th>Data</th>
                        <th>Ação</th>
                        <th>Perfil</th>
                        <th>Entidade</th>
                        <th>Correlação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((a) => (
                        <tr key={a.id}>
                          <td>{date(a.created_at, true)}</td>
                          <td>{auditLabels[a.action] ?? a.action}</td>
                          <td>{a.actor_role ?? "Sistema"}</td>
                          <td>
                            {a.entity_type}
                            <small>{a.entity_id}</small>
                          </td>
                          <td>
                            <small>{a.correlation_id}</small>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
            <Panel title="Auditoria e privacidade">
              <p className="ow-muted">
                Eventos são imutáveis nos fluxos normais. O relatório não expõe
                números de CNH, segredos nem payloads completos de dados
                pessoais.
              </p>
              <p className="ow-note">
                Solicitações de exclusão exigem análise de finalidade, base
                legal e retenção; sua conclusão não executa uma exclusão
                automática.
              </p>
            </Panel>
          </div>
          <Panel title="Solicitações de privacidade dos titulares">
            {!state ? (
              <Empty>Solicitações indisponíveis.</Empty>
            ) : !state.privacy_requests.length ? (
              <Empty>Nenhuma solicitação registrada.</Empty>
            ) : (
              <ul className="ow-list">
                {state.privacy_requests.map((r) => (
                  <li key={r.id}>
                    <div style={{ flex: 1 }}>
                      <strong>
                        {
                          (
                            {
                              access: "Acesso aos dados",
                              correction: "Correção",
                              export: "Exportação",
                              deletion: "Exclusão",
                            } as Record<string, string>
                          )[r.kind]
                        }{" "}
                        ·{" "}
                        {users?.find((u) => u.id === r.subject_id)?.full_name ??
                          "Titular"}
                      </strong>
                      <p>{r.summary}</p>
                      <small>
                        {date(r.created_at, true)} · {r.status}
                      </small>
                      {r.response && <p>Resposta: {r.response}</p>}
                      {!["completed", "rejected"].includes(r.status) && (
                        <details>
                          <summary>Tratar solicitação</summary>
                          <form action={adminCommand} className="ow-form">
                            <input
                              type="hidden"
                              name="command"
                              value="privacy.respond"
                            />
                            <input
                              type="hidden"
                              name="request_id"
                              value={randomUUID()}
                            />
                            <input type="hidden" name="id" value={r.id} />
                            <input
                              type="hidden"
                              name="version"
                              value={r.version}
                            />
                            <label className="ow-field">
                              <span>Situação</span>
                              <select name="status">
                                <option value="in_review">Em análise</option>
                                <option value="completed">Concluída</option>
                                <option value="rejected">
                                  Indeferida com justificativa
                                </option>
                              </select>
                            </label>
                            <label className="ow-field">
                              <span>Resposta / fundamentação</span>
                              <textarea
                                name="response"
                                minLength={3}
                                maxLength={5000}
                                required
                              />
                            </label>
                            <Submit>Registrar tratamento</Submit>
                          </form>
                        </details>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </>
      )}
    </Workspace>
  );
}
