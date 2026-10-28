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
import { getDictionary } from "@/lib/i18n/getLocale";
import { auditActionLabel } from "@/lib/i18n/auditActionLabel";
import { fmt, getAreaText } from "@/lib/i18n/areaText";
import { adminWorkspaceTexts } from "@/lib/i18n/areas/adminWorkspace";
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
export async function AdminWorkspace({
  view,
  params,
}: {
  view: "overview" | "integrations" | "audit" | "ai";
  params: { q?: string; action?: string; error?: string; success?: string };
}) {
  const data = await loadOperationalWorkspace(["administrator"]);
  const dict = await getDictionary();
  const T = await getAreaText(adminWorkspaceTexts);
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
    overview: T.titleOverview,
    integrations: T.titleIntegrations,
    audit: T.titleAudit,
    ai: T.titleAi,
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
      T.linkUsers,
      T.linkUsersD,
    ],
    [
      "/settings/approvals",
      T.linkApprovals,
      T.linkApprovalsD,
    ],
    [
      "/settings",
      T.linkPolicies,
      T.linkPoliciesD,
    ],
    [
      "/admin/integrations",
      T.linkIntegrations,
      T.linkIntegrationsD,
    ],
    [
      "/admin/audit",
      T.linkAudit,
      T.linkAuditD,
    ],
    [
      "/admin/ai",
      T.linkAi,
      T.linkAiD,
    ],
    [
      "/settings/mobility-points",
      T.linkMobility,
      T.linkMobilityD,
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
      subtitle={T.subtitle}
      active="settings"
      error={params.error}
      success={params.success}
    >
      <nav className="ow-tabs" aria-label={T.navAria}>
        {[
          ["overview", "/admin", T.tabOverview],
          ["integrations", "/admin/integrations", T.tabIntegrations],
          ["audit", "/admin/audit", T.tabAudit],
          ["ai", "/admin/ai", T.tabAi],
          ["units", "/admin/units", T.tabUnits],
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
          {T.govUnavailable}
        </p>
      )}
      <Metrics
        items={[
          {
            label: T.mVehicles,
            value: data.vehicles?.length ?? null,
          },
          { label: T.mUsers, value: users?.length ?? null },
          {
            label: T.mLocations,
            value: data.locations?.length ?? null,
          },
          {
            label: T.mPrivacyOpen,
            value:
              state?.privacy_requests.filter(
                (r) => !["completed", "rejected"].includes(r.status),
              ).length ?? null,
            tone: "amber",
          },
          { label: T.mAudited, value: audit?.length ?? null },
        ]}
      />
      {view === "overview" ? (
        <>
          <Panel title={T.modulesPanel}>
            <nav className="ow-links" aria-label={T.modulesAria}>
              {links.map(([url, label, detail]) => (
                <Link href={url!} key={url}>
                  {label}
                  <small>{detail}</small>
                </Link>
              ))}
            </nav>
          </Panel>
          <div className="ow-grid-equal">
            <Panel title={T.recentPanel}>
              {!audit ? (
                <Empty>{T.auditUnavailable}</Empty>
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
                          <strong>{auditActionLabel(dict, a.action)}</strong>
                          <small>
                            {date(a.created_at, true)} ·{" "}
                            {a.actor_role ?? T.system}
                          </small>
                        </div>
                      </li>
                    ))}
                  {!audit.length && <Empty />}
                </ul>
              )}
            </Panel>
            <Panel title={T.govPanel}>
              <ul className="ow-list">
                <li>
                  <strong>{T.fleetmindAssistant}</strong>
                  <Tag tone={state?.policy.enabled ? "green" : "amber"}>
                    {state
                      ? state.policy.enabled
                        ? T.enabled
                        : T.disabled
                      : T.unavailable}
                  </Tag>
                </li>
                <li>
                  <strong>Google Maps / Routes</strong>
                  <span>
                    {google
                      ? T.googleOk
                      : T.googleNo}
                  </span>
                </li>
                <li>
                  <strong>SMTP</strong>
                  <span>
                    {smtp
                      ? T.smtpOk
                      : T.smtpNo}
                  </span>
                </li>
              </ul>
              <p className="ow-note">
                {T.credNote}
              </p>
            </Panel>
          </div>
        </>
      ) : view === "integrations" ? (
        <div className="ow-grid">
          <div className="ow-stack">
            <Panel
              title={T.intStatusPanel}
              action={
                <Link className="ow-link" href="/admin/integrations">
                  {T.refreshReadings}
                </Link>
              }
            >
              <div className="ow-table-scroll">
                <table className="ow-table">
                  <thead>
                    <tr>
                      <th>{T.thIntegration}</th>
                      <th>{T.thConfig}</th>
                      <th>{T.thEvidence}</th>
                      <th>{T.thNote}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Supabase</td>
                      <td>
                        <Tag tone={dbConfig ? "green" : "amber"}>
                          {dbConfig ? T.configured : T.notConfigured}
                        </Tag>
                      </td>
                      <td>
                        {users
                          ? T.dbQueryDone
                          : T.dbQueryUnconfirmed}
                      </td>
                      <td>{T.dbNote}</td>
                    </tr>
                    <tr>
                      <td>Google Maps / Routes</td>
                      <td>
                        <Tag tone={google ? "green" : "amber"}>
                          {google ? T.configured : T.notConfigured}
                        </Tag>
                      </td>
                      <td>
                        {calls === null
                          ? T.readingsUnavailable
                          : fmt(T.callsErrors, { calls: calls, failures: failures ?? 0 })}
                      </td>
                      <td>
                        {T.googleNote}
                      </td>
                    </tr>
                    <tr>
                      <td>SMTP transacional</td>
                      <td>
                        <Tag tone={smtp ? "green" : "amber"}>
                          {smtp ? T.configured : T.notConfigured}
                        </Tag>
                      </td>
                      <td>{T.smtpEvidence}</td>
                      <td>
                        {T.smtpNote}
                      </td>
                    </tr>
                    <tr>
                      <td>SAP</td>
                      <td>
                        <Tag>{T.futureConditional}</Tag>
                      </td>
                      <td>{T.noValidatedAdapter}</td>
                      <td>{T.notDeclaredActive}</td>
                    </tr>
                    <tr>
                      <td>WhatsApp</td>
                      <td>
                        <Tag>{T.notIntegrated}</Tag>
                      </td>
                      <td>{T.noValidatedProvider}</td>
                      <td>{T.inAppAvailable}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </Panel>
            <Panel title={T.geoPanel}>
              {!quota ? (
                <Empty>{T.countersUnavailable}</Empty>
              ) : !quota.length ? (
                <Empty>{T.noCallsYet}</Empty>
              ) : (
                <div className="ow-table-scroll">
                  <table className="ow-table">
                    <thead>
                      <tr>
                        <th>{T.thDate}</th>
                        <th>{T.thOperation}</th>
                        <th>{T.thCalls}</th>
                        <th>{T.thErrors}</th>
                        <th>{T.thLatency}</th>
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
          <Panel title={T.intSecurityPanel}>
            <p className="ow-muted">
              {T.intSecurityText}
            </p>
          </Panel>
        </div>
      ) : view === "ai" ? (
        <div className="ow-grid">
          <div className="ow-stack">
            <Panel title={T.aiResourcesPanel}>
              <div className="ow-links">
                <div className="ow-panel">
                  <strong>{T.fleetmindAssistant}</strong>
                  <p className="ow-note">
                    {T.assistantControl}
                  </p>
                  <Tag tone={state?.policy.enabled ? "green" : "amber"}>
                    {state
                      ? state.policy.enabled
                        ? T.enabled
                        : T.disabled
                      : T.unavailable}
                  </Tag>
                </div>
                <div className="ow-panel">
                  <strong>{T.smartBooking}</strong>
                  <p className="ow-note">
                    {T.smartBookingText}
                  </p>
                  <Link className="ow-link" href="/settings">
                    {T.openPolicies}
                  </Link>
                </div>
                <div className="ow-panel">
                  <strong>{T.smartCarpool}</strong>
                  <p className="ow-note">
                    {T.smartCarpoolText}
                  </p>
                  <Link className="ow-link" href="/settings">
                    {T.openCarpoolPolicy}
                  </Link>
                </div>
              </div>
            </Panel>
            <Panel title={T.versionsPanel}>
              {state ? (
                <>
                  <div className="ow-table-scroll">
                    <table className="ow-table">
                      <thead>
                        <tr>
                          <th>{T.thVersion}</th>
                          <th>{T.thAssistant}</th>
                          <th>{T.thReason}</th>
                          <th>{T.thDate}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {state.policy_versions.map((v) => (
                          <tr key={v.id}>
                            <td>{v.version}</td>
                            <td>
                              {v.assistant_enabled
                                ? T.enabled
                                : T.disabled}
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
                      {T.noChange}
                    </Empty>
                  )}
                </>
              ) : (
                <Empty>{T.historyUnavailable}</Empty>
              )}
            </Panel>
          </div>
          <Panel title={T.publishPanel}>
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
                {T.assistantEnabledLabel}
              </label>
              <label className="ow-field">
                <span>{T.justification}</span>
                <textarea
                  name="reason"
                  minLength={3}
                  maxLength={1000}
                  required
                />
              </label>
              <p className="ow-wide">
                {T.criticalActions}
              </p>
              <Submit disabled={!state}>{T.publishNew}</Submit>
            </form>
          </Panel>
        </div>
      ) : (
        <>
          <div className="ow-grid">
            <Panel title={T.auditListPanel}>
              <form className="ow-filters" method="get">
                <Field
                  label={T.searchLabel}
                  name="q"
                  value={params.q}
                  maxLength={100}
                />
                <label className="ow-field">
                  <span>{T.actionLabel}</span>
                  <select name="action" defaultValue={params.action ?? ""}>
                    <option value="">{T.all}</option>
                    {[...new Set(audit?.map((a) => a.action))]
                      .sort()
                      .map((a) => (
                        <option key={a} value={a}>
                          {auditActionLabel(dict, a)}
                        </option>
                      ))}
                  </select>
                </label>
                <Submit>{T.filter}</Submit>
              </form>
              {!filtered ? (
                <Empty>{T.auditUnavailable}</Empty>
              ) : !filtered.length ? (
                <Empty />
              ) : (
                <div className="ow-table-scroll">
                  <table className="ow-table">
                    <thead>
                      <tr>
                        <th>{T.thDate}</th>
                        <th>{T.thAction}</th>
                        <th>{T.thProfile}</th>
                        <th>{T.thEntity}</th>
                        <th>{T.thCorrelation}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((a) => (
                        <tr key={a.id}>
                          <td>{date(a.created_at, true)}</td>
                          <td>{auditActionLabel(dict, a.action)}</td>
                          <td>{a.actor_role ?? T.system}</td>
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
            <Panel title={T.auditPrivacyPanel}>
              <p className="ow-muted">
                {T.auditImmutable}
              </p>
              <p className="ow-note">
                {T.deletionNote}
              </p>
            </Panel>
          </div>
          <Panel title={T.privacyPanel}>
            {!state ? (
              <Empty>{T.requestsUnavailable}</Empty>
            ) : !state.privacy_requests.length ? (
              <Empty>{T.noRequests}</Empty>
            ) : (
              <ul className="ow-list">
                {state.privacy_requests.map((r) => (
                  <li key={r.id}>
                    <div style={{ flex: 1 }}>
                      <strong>
                        {
                          (
                            {
                              access: T.kindAccess,
                              correction: T.kindCorrection,
                              export: T.kindExport,
                              deletion: T.kindDeletion,
                            } as Record<string, string>
                          )[r.kind]
                        }{" "}
                        ·{" "}
                        {users?.find((u) => u.id === r.subject_id)?.full_name ??
                          T.subject}
                      </strong>
                      <p>{r.summary}</p>
                      <small>
                        {date(r.created_at, true)} · {r.status}
                      </small>
                      {r.response && <p>{fmt(T.responseLine, { response: r.response })}</p>}
                      {!["completed", "rejected"].includes(r.status) && (
                        <details>
                          <summary>{T.handleRequest}</summary>
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
                              <span>{T.situation}</span>
                              <select name="status">
                                <option value="in_review">{T.inReview}</option>
                                <option value="completed">{T.completed}</option>
                                <option value="rejected">
                                  {T.rejectedJustified}
                                </option>
                              </select>
                            </label>
                            <label className="ow-field">
                              <span>{T.responseBasis}</span>
                              <textarea
                                name="response"
                                minLength={3}
                                maxLength={5000}
                                required
                              />
                            </label>
                            <Submit>{T.registerHandling}</Submit>
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
