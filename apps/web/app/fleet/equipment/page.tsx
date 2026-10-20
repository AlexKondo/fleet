import Link from 'next/link';
import {randomUUID} from 'node:crypto';
import {loadKeySession} from '@/lib/operations/keyCustodyLoad';
import {parseEquipmentSnapshot,type EquipmentSnapshot} from '@/lib/equipment/contract';
import {FmShell} from '@/app/carpool/FmShell';
import {Panel,Field,Submit} from '@/app/operations/Workspace';
import {saveEquipmentProfile} from './actions';
import '@/app/operations/operations.css';
function Configuration({state,kind}:{state:EquipmentSnapshot;kind:'vehicle'|'category'}){
 const profile=state.profiles.find(p=>p.target_kind===kind);
 const selected=new Set([...(profile?.required_ids??[]),...(profile?.optional_ids??[])]);
 return <form action={saveEquipmentProfile} className="ow-form"><input type="hidden" name="vehicle_id" value={state.vehicle.id}/><input type="hidden" name="kind" value={kind}/><input type="hidden" name="target_id" value={kind==='vehicle'?state.vehicle.id:state.vehicle.category_id}/><input type="hidden" name="version" value={profile?.version??0}/><input type="hidden" name="request_id" value={randomUUID()}/>
 <label className="ow-check"><input type="checkbox" name="enabled" defaultChecked={profile?.enabled??false}/>{kind==='vehicle'?'Usar configuração própria deste veículo; desmarcado, herdar o modelo':'Publicar padrão deste modelo'}</label>
 {state.catalog.filter(e=>e.enabled||selected.has(e.id)).map(e=><label key={e.id} className="ow-field"><span>{e.name}{!e.enabled?' · Fora do catálogo ativo':''}</span><select name={`item_${e.id}`} defaultValue={profile?.required_ids.includes(e.id)?'required':profile?.optional_ids.includes(e.id)?'optional':'absent'}><option value="absent">Não vinculado</option>{e.enabled&&<><option value="required">Obrigatório neste conjunto</option><option value="optional">Disponível, sem exigência de checklist</option></>}{!e.enabled&&selected.has(e.id)&&<option value={profile?.required_ids.includes(e.id)?'required':'optional'}>Remova da configuração antes de salvar a revisão</option>}</select></label>)}
 <p>Marque somente os itens efetivamente fornecidos e exigidos para o veículo ou modelo. Estepe e kit de reparo, cabos e extintor não são adicionados automaticamente. Uma publicação sem itens também exige decisão explícita e justificativa.</p><Field name="reason" label="Justificativa da configuração" required maxLength={1000}/><Submit>Publicar configuração</Submit></form>;
}
const errors:Record<string,string>={NOT_AUTHORIZED:'Você não pode alterar esta configuração no escopo atual.',CONCURRENT_UPDATE:'A configuração mudou. Recarregue antes de publicar.',INVALID_REFERENCE:'Selecione somente itens ativos do catálogo da organização.',DUPLICATE_EQUIPMENT_NAME:'Há itens com nomes duplicados. Use um identificador de catálogo para cada item.',IDEMPOTENCY_CONFLICT:'Esta tentativa já foi usada com outros dados. Recarregue.'};
export default async function EquipmentPage({searchParams}:{searchParams:Promise<{vehicle?:string;error?:string;success?:string}>}){
 const {db,profile}=await loadKeySession();const params=await searchParams;
 const result=/^[0-9a-f-]{36}$/i.test(params.vehicle??'')?await db.rpc('fm_equipment_vehicle_snapshot',{p_vehicle_id:params.vehicle!}):null;
 const state=result&&!result.error?parseEquipmentSnapshot(result.data):null;const manager=['fleet_manager','administrator'].includes(profile.role);
 return <FmShell orgName={profile.organization?.name??'—'} userName={profile.full_name} role={profile.role} isFleetManager={manager} isAdministrator={profile.role==='administrator'} active="fleet" nonDrivingWorkspace workspace="operations" wide><div className="ow"><header className="ow-heading"><div><h1>Equipamentos por veículo e modelo</h1><p>Configure a composição real do veículo. O checklist usa uma versão preservada para a viagem.</p></div><Link href={`/maintenance/vehicles?vehicle=${state?.vehicle.id??''}`}>Prontuário</Link></header>
 {params.error&&<p role="alert" className="ow-banner ow-error">{errors[params.error]??'Não foi possível publicar. Confira os campos e recarregue.'}</p>}{params.success&&<p role="status" className="ow-banner">Configuração publicada e auditada. Viagens com checklist preparado mantêm sua versão.</p>}
 {!state?<p role="alert">Configuração indisponível no seu escopo.</p>:<><Panel title={state.vehicle.plate}>{state.effective.configured?<><p>Origem: {state.effective.source==='vehicle'?'Próprio veículo':'Modelo'} · revisão {state.effective.version}</p><p>Obrigatórios: {state.effective.required?.map(e=>e.name).join(', ')||'Nenhum — configuração explícita'}</p><p>Disponíveis opcionais: {state.effective.optional?.map(e=>e.name).join(', ')||'Nenhum'}</p></>:<p role="alert">Configuração ainda não publicada. Novas retiradas aguardam a definição pelo gestor; devoluções legadas mantêm o registro de chegada e observações.</p>}</Panel>{state.can_edit&&<Panel title="Configuração própria do veículo"><Configuration state={state} kind="vehicle"/></Panel>}{state.can_edit_category&&<Panel title="Padrão do modelo — afeta veículos que herdam"><Configuration state={state} kind="category"/></Panel>}<Link href="/settings">Catálogo de equipamentos</Link></>}
 </div></FmShell>;
}
