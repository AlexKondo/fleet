import Link from "next/link";
import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { FmShell } from "@/app/carpool/FmShell";
import { Panel, Empty, Tag, Submit, date } from "@/app/operations/Workspace";
import { getAreaText, fmt } from "@/lib/i18n/areaText";
import { accountPrivacyTexts } from "@/lib/i18n/areas/accountPrivacy";
import { submitPrivacy } from "./actions";
export default async function PrivacyPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const params = await searchParams;
  const T = await getAreaText(accountPrivacyTexts);
  const db = await createSupabaseServerClient();
  const user = await getCurrentUser(db);
  if (!user) redirect("/login");
  const { data: p } = await db
    .from("profiles")
    .select("full_name,role,organization:organizations(name)")
    .eq("id", user.id)
    .single();
  if (!p) redirect("/login");
  const result = await db.rpc("fm_my_privacy_requests");
  type Request = {
    id: string;
    kind: string;
    summary: string;
    status: string;
    response: string | null;
    created_at: string;
  };
  const records =
    !result.error && Array.isArray(result.data)
      ? (result.data as unknown as Request[])
      : null;
  return (
    <FmShell
      active="dashboard"
      orgName={p.organization?.name ?? "—"}
      userName={p.full_name}
      role={p.role}
      isFleetManager={["fleet_manager", "administrator"].includes(p.role)}
      isAdministrator={p.role === "administrator"}
      title={T.pageTitle}
      subtitle={T.pageSubtitle}
      wide
    >
      <div className="ow"><p><a href="/api/exports/personal">{T.download}</a></p><p>{T.exportNote}</p>
        {params.error && (
          <p role="alert" className="ow-banner ow-error">
            {T.error}
          </p>
        )}
        {params.success && (
          <p role="status" className="ow-banner">
            {T.success}
          </p>
        )}
        <div className="ow-grid">
          <Panel title={T.myRequests}>
            {records === null ? (
              <Empty>{T.loadFail}</Empty>
            ) : !records.length ? (
              <Empty>{T.none}</Empty>
            ) : (
              <ul className="ow-list">
                {records.map((r) => (
                  <li key={r.id}>
                    <div>
                      <Tag>{r.status}</Tag>
                      <strong>
                        {
                          (
                            {
                              access: T.kAccess,
                              correction: T.kCorrection,
                              export: T.kExport,
                              deletion: T.kDeletion,
                            } as Record<string, string>
                          )[r.kind]
                        }
                      </strong>
                      <p>{r.summary}</p>
                      <small>{date(r.created_at, true)}</small>
                      {r.response && <p>{fmt(T.response, { r: r.response })}</p>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title={T.newRequest}>
            <form action={submitPrivacy} className="ow-form">
              <input type="hidden" name="request_id" value={randomUUID()} />
              <label className="ow-field">
                <span>{T.type}</span>
                <select name="kind">
                  <option value="access">{T.kAccess}</option>
                  <option value="correction">{T.oCorrection}</option>
                  <option value="export">{T.kExport}</option>
                  <option value="deletion">{T.kDeletion}</option>
                </select>
              </label>
              <label className="ow-field">
                <span>{T.describe}</span>
                <textarea
                  name="summary"
                  minLength={3}
                  maxLength={3000}
                  required
                />
              </label>
              <p className="ow-wide">
                {T.legal}
              </p>
              <Submit disabled={records === null}>{T.submit}</Submit>
            </form>
            <p className="ow-note">
              <Link className="ow-link" href="/account/profile">
                {T.editProfile}
              </Link>
            </p>
          </Panel>
        </div>
      </div>
    </FmShell>
  );
}
