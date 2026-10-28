import Link from "next/link";
import { TeamTabs } from "@/app/settings/TeamTabs";
import { loadOperationalWorkspace } from "@/lib/operations/load";
import { pageAll } from "@/lib/carpool/kpi/loadKpis";
import { getAreaText } from "@/lib/i18n/areaText";
import { fleetDriversTexts } from "@/lib/i18n/areas/fleetDrivers";
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
  const T = await getAreaText(fleetDriversTexts);
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
    unknown: T.stateUnknown,
    missing: T.stateMissing,
    expired: T.stateExpired,
    unauthorized: T.stateUnauthorized,
    ready: T.stateReady,
  };
  return (
    <Workspace
      data={data}
      title={T.title}
      subtitle={T.subtitle}
      active="drivers"
      managerView
    >
      <TeamTabs active="drivers" isAdministrator={data.profile.role === "administrator"} />
      {!licenseAvailable && (
        <p role="alert" className="ow-banner ow-error">
          {T.licenseLookupFailed}
        </p>
      )}
      <Metrics
        items={[
          { label: T.metricMembers, value: rows?.length ?? null },
          {
            label: T.metricReady,
            value: licenseAvailable
              ? (rows?.filter((r) => r.state === "ready").length ?? null)
              : null,
            tone: "green",
          },
          {
            label: T.stateExpired,
            value: licenseAvailable
              ? (rows?.filter((r) => r.state === "expired").length ?? null)
              : null,
            tone: "red",
          },
          {
            label: T.stateMissing,
            value: licenseAvailable
              ? (rows?.filter((r) => r.state === "missing").length ?? null)
              : null,
            tone: "amber",
          },
          {
            label: T.stateUnauthorized,
            value: licenseAvailable
              ? (rows?.filter((r) => r.state === "unauthorized").length ?? null)
              : null,
          },
        ]}
      />
      <div className="ow-grid">
        <Panel title={T.panelDrivers}>
          <form method="get" className="ow-filters">
            <Field
              label={T.searchName}
              name="q"
              value={params.q}
              maxLength={100}
            />
            <label className="ow-field">
              <span>{T.situation}</span>
              <select name="status" defaultValue={params.status ?? ""}>
                <option value="">{T.all}</option>
                {Object.entries(label).map(([key, text]) => (
                  <option key={key} value={key}>
                    {text}
                  </option>
                ))}
              </select>
            </label>
            <Submit>{T.filter}</Submit>
          </form>
          {members === null ? (
            <Empty>{T.membersUnavailable}</Empty>
          ) : !filtered?.length ? (
            <Empty />
          ) : (
            <div className="ow-table-scroll">
              <table className="ow-table">
                <thead>
                  <tr>
                    <th>{T.colMember}</th>
                    <th>{T.colProfile}</th>
                    <th>{T.colLicense}</th>
                    <th>{T.colCategory}</th>
                    <th>{T.colExpiry}</th>
                    <th>{T.colAuthorization}</th>
                    <th>{T.colDetails}</th>
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
                              employee: T.roleEmployee,
                              fleet_manager: T.roleFleetManager,
                              administrator: T.roleAdministrator,
                              maintenance_operator: T.roleMaintenance,
                              security: T.roleSecurity,
                            } as Record<string, string>
                          )[r.role]
                        }
                      </td>
                      <td>
                        {licenseAvailable
                          ? r.license?.drivers_license_number
                            ? "••••" +
                              r.license.drivers_license_number.slice(-4)
                            : T.notInformed
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
                          {T.open}
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
          <Panel title={T.panelDriverDetails}>
            {!selected ? (
              <Empty>{T.selectMember}</Empty>
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
                    <dt>{T.licenseCategory}</dt>
                    <dd>
                      {licenseAvailable
                        ? (selected.license?.drivers_license_category ?? "—")
                        : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt>{T.expiry}</dt>
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
                    <dt>{T.registeredAuthorization}</dt>
                    <dd>
                      {licenseAvailable
                        ? selected.license?.driver_authorized
                          ? T.yes
                          : T.no
                        : T.unavailable}
                    </dd>
                  </div>
                </dl>
                {data.profile.role === "administrator" ? (
                  <Link className="ow-button" href="/settings/users">
                    {T.manageDocs}
                  </Link>
                ) : (
                  <p className="ow-note">
                    {T.adminOnlyNote}
                  </p>
                )}
              </>
            )}
          </Panel>
          <Panel title={T.panelPrivacy}>
            <p className="ow-muted">
              {T.privacyNote}
            </p>
          </Panel>
        </aside>
      </div>
    </Workspace>
  );
}
