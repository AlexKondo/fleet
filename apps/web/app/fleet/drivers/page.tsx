import { FmAlertIcon, FmBanIcon, FmCalendarIcon, FmCheckIcon, FmUsersIcon } from "@/app/fmIcons";
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
  searchParams: Promise<{ q?: string; status?: string }>;
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
      {!licenseAvailable && (
        <p role="alert" className="ow-banner ow-error">
          {T.licenseLookupFailed}
        </p>
      )}
      <Metrics
        items={[
          { label: T.metricMembers, value: rows?.length ?? null, icon: <FmUsersIcon /> },
          {
            label: T.metricReady,
            value: licenseAvailable
              ? (rows?.filter((r) => r.state === "ready").length ?? null)
              : null,
            tone: "green",
            icon: <FmCheckIcon />,
          },
          {
            label: T.stateExpired,
            value: licenseAvailable
              ? (rows?.filter((r) => r.state === "expired").length ?? null)
              : null,
            tone: "red",
            icon: <FmCalendarIcon />,
          },
          {
            label: T.stateMissing,
            value: licenseAvailable
              ? (rows?.filter((r) => r.state === "missing").length ?? null)
              : null,
            tone: "amber",
            icon: <FmAlertIcon />,
          },
          {
            label: T.stateUnauthorized,
            icon: <FmBanIcon />,
            value: licenseAvailable
              ? (rows?.filter((r) => r.state === "unauthorized").length ?? null)
              : null,
          },
        ]}
      />
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
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id}>
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </Workspace>
  );
}
