import Link from "next/link";
import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { FmShell } from "@/app/carpool/FmShell";
import { Panel, Empty, Tag, Submit, date } from "@/app/operations/Workspace";
import { submitPrivacy } from "./actions";
export default async function PrivacyPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const params = await searchParams;
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
      title="Perfil e Privacidade"
      subtitle="Acompanhe solicitações relacionadas aos seus dados."
      wide
    >
      <div className="ow"><p><a href="/api/exports/personal">Baixar meus dados em JSON</a></p><p>A exportação reúne seus registros estruturados. Fotos e arquivos binários não são incluídos neste JSON; seus documentos continuam nos acessos autenticados correspondentes.</p>
        {params.error && (
          <p role="alert" className="ow-banner ow-error">
            Não foi possível registrar a solicitação. Confira os dados e tente
            novamente.
          </p>
        )}
        {params.success && (
          <p role="status" className="ow-banner">
            Solicitação registrada. Acompanhe o tratamento abaixo.
          </p>
        )}
        <div className="ow-grid">
          <Panel title="Minhas solicitações">
            {records === null ? (
              <Empty>Não foi possível consultar suas solicitações.</Empty>
            ) : !records.length ? (
              <Empty>Nenhuma solicitação enviada.</Empty>
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
                              access: "Acesso aos dados",
                              correction: "Correção",
                              export: "Exportação",
                              deletion: "Exclusão",
                            } as Record<string, string>
                          )[r.kind]
                        }
                      </strong>
                      <p>{r.summary}</p>
                      <small>{date(r.created_at, true)}</small>
                      {r.response && <p>Resposta: {r.response}</p>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title="Nova solicitação">
            <form action={submitPrivacy} className="ow-form">
              <input type="hidden" name="request_id" value={randomUUID()} />
              <label className="ow-field">
                <span>Tipo</span>
                <select name="kind">
                  <option value="access">Acesso aos dados</option>
                  <option value="correction">Correção de dados</option>
                  <option value="export">Exportação</option>
                  <option value="deletion">Exclusão</option>
                </select>
              </label>
              <label className="ow-field">
                <span>Descreva sua solicitação</span>
                <textarea
                  name="summary"
                  minLength={3}
                  maxLength={3000}
                  required
                />
              </label>
              <p className="ow-wide">
                Pedidos são analisados conforme finalidade, base legal e
                retenção aplicável. O envio não apaga automaticamente históricos
                operacionais.
              </p>
              <Submit disabled={records === null}>Enviar solicitação</Submit>
            </form>
            <p className="ow-note">
              <Link className="ow-link" href="/account/profile">
                Editar meus dados de perfil →
              </Link>
            </p>
          </Panel>
        </div>
      </div>
    </FmShell>
  );
}
