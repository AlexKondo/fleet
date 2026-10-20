import Link from "next/link";
import {FmShell} from "@/app/carpool/FmShell";
import {Panel,date} from "@/app/operations/Workspace";
import {KeyHistory} from "@/app/account/keys/KeyHistory";
import {loadKeySession} from "@/lib/operations/keyCustodyLoad";
import {parseKeyWorkspace} from "@/lib/operations/keyCustody";
import {redirect} from "next/navigation";
import "@/app/operations/operations.css";
export default async function KeyManagementPage(){
 const {db,profile}=await loadKeySession();
 if(!["fleet_manager","administrator"].includes(profile.role))redirect("/dashboard");
 const {data,error}=await db.rpc("fm_key_management_workspace");const state=error?null:parseKeyWorkspace(data);
 return <FmShell orgName={profile.organization?.name??"—"} userName={profile.full_name} role={profile.role} isFleetManager isAdministrator={profile.role==="administrator"} active="keyManagement" workspace="manager" wide><div className="ow">
 <header className="ow-heading"><div><h1>Acompanhamento das chaves</h1><p>Acompanhe a custódia local e as exceções, mantendo a confirmação física com o responsável da unidade.</p></div>{profile.role==="administrator"&&<Link href="/admin/units">Configurar unidades e responsáveis</Link>}</header>
 {!state?<p role="alert">Não foi possível consultar a custódia. Nenhum estado foi presumido.</p>:<>
 <Panel title="Reservas e chaves pendentes"><p>Reservas nos próximos sete dias e chaves entregues sem recebimento confirmado, inclusive de reservas canceladas. Esta visão não confirma entrega ou recebimento à distância.</p>{!state.reservations.length?<p>Nenhuma reserva nesta janela e nenhuma chave pendente.</p>:<div className="ow-table-scroll"><table className="ow-table"><thead><tr><th>Unidade / veículo</th><th>Condutor</th><th>Período</th><th>Chaves</th></tr></thead><tbody>{state.reservations.map(r=><tr key={r.id}><td>{r.unit} · {r.plate}</td><td>{r.requester}</td><td><Link href={`/reservations/${r.id}`}>{date(r.start_at,true)} — {date(r.end_at,true)}</Link></td><td>{r.received?"Recebidas":r.delivered?"Recebimento pendente":"Entrega pendente"}{r.status==="cancelled"?" · Reserva cancelada":""}</td></tr>)}</tbody></table></div>}</Panel>
 <KeyHistory events={state.events}/>
 </>}
 </div></FmShell>;
}
