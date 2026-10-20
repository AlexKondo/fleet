import {randomUUID} from "node:crypto";
import {FmShell} from "@/app/carpool/FmShell";
import {Panel,Field,Submit,date} from "@/app/operations/Workspace";
import {loadKeySession} from "@/lib/operations/keyCustodyLoad";
import {parseKeyWorkspace,keyErrorText} from "@/lib/operations/keyCustody";
import {confirmKeys} from "./actions";
import {KeyHistory} from "./KeyHistory";
import "@/app/operations/operations.css";
export default async function KeysPage({searchParams}:{searchParams:Promise<{error?:string;success?:string}>}){
 const {db,profile}=await loadKeySession();const params=await searchParams;
 const {data,error}=await db.rpc("fm_key_workspace");const state=error?null:parseKeyWorkspace(data);
 const permitted=!!state?.units.length;
 return <FmShell orgName={profile.organization?.name??"—"} userName={profile.full_name} role={profile.role} isFleetManager={["fleet_manager","administrator"].includes(profile.role)} isAdministrator={profile.role==="administrator"} active="keys" nonDrivingWorkspace={permitted} workspace="operations" wide><div className="ow">
 <header className="ow-heading"><div><h1>Entrega e recebimento de chaves</h1><p>Confirmação presencial no escritório pelas pessoas designadas para cada unidade.</p></div></header>
 {params.error&&<p className="ow-banner ow-error" role="alert">{keyErrorText(params.error)}</p>}{params.success&&<p className="ow-banner" role="status">Confirmação registrada. O checklist do colaborador continua separado desta ação.</p>}
 {!state?<p role="alert">Não foi possível consultar as chaves. As confirmações estão indisponíveis; nenhum estado foi presumido.</p>:!permitted?<p>Você não possui designação ativa para custódia de chaves. Um administrador pode configurar essa atribuição por unidade.</p>:<>
 <p>Unidades autorizadas: {state.units.map(u=>u.name).join(", ")}. Esta atribuição não inclui inspeção do veículo, aprovação de reservas ou liberação de bloqueios.</p>
 {state.reservations.length===0&&<p>Nenhuma reserva nesta janela e nenhuma chave pendente de recebimento nas suas unidades.</p>}
 {state.reservations.map(r=><Panel key={r.id} title={`${r.plate} · ${r.unit}`}><p>{r.requester} · {date(r.start_at,true)} até {date(r.end_at,true)}</p><p>{r.received?"Chaves recebidas":r.delivered?"Chaves entregues; recebimento pendente":"Entrega de chaves pendente"}{r.status==="cancelled"?" · Reserva cancelada: regularize o recebimento das chaves.":""}</p>
 {r.self?<p>Outra pessoa designada precisa confirmar a entrega e o recebimento das chaves da sua reserva.</p>:<>
 {!r.received&&<form action={confirmKeys} className="ow-form"><input type="hidden" name="request_id" value={randomUUID()}/><input type="hidden" name="reservation_id" value={r.id}/><input type="hidden" name="kind" value={r.delivered?"received":"delivered"}/><label className="ow-check"><input type="checkbox" name="physical_confirmation" required/> {r.delivered?"Confirmo que recebi fisicamente as chaves nesta unidade.":"Confirmo que entreguei fisicamente as chaves ao condutor desta reserva."}</label><Field name="reason" label="Observação (opcional)" maxLength={1000}/><Submit>{r.delivered?"Confirmar recebimento":"Confirmar entrega"}</Submit></form>}
 <details><summary>Registrar exceção de custódia</summary><form action={confirmKeys} className="ow-form"><input type="hidden" name="request_id" value={randomUUID()}/><input type="hidden" name="reservation_id" value={r.id}/><input type="hidden" name="kind" value="exception"/><Field name="reason" label="Descreva a exceção" required maxLength={1000}/><label className="ow-check"><input type="checkbox" name="physical_confirmation" required/> Confirmo o relato desta ocorrência de custódia.</label><Submit>Registrar exceção</Submit></form></details>
 </>}
 </Panel>)}
 <KeyHistory events={state.events}/>
 </>}
 </div></FmShell>;
}
