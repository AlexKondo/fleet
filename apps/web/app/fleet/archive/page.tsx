import Link from 'next/link';
import {randomUUID} from 'node:crypto';
import {loadKeySession} from '@/lib/operations/keyCustodyLoad';
import {FmShell} from '@/app/carpool/FmShell';
import {Panel,Field,Submit,Empty,date} from '@/app/operations/Workspace';
import {restoreFleetRecord} from './actions';
import '@/app/operations/operations.css';
type Item={id:string;plate?:string;name?:string|null;reason?:string;archived_at?:string;version:number};
function parse(v:unknown):{vehicles:Item[];categories:Item[];locations:Item[]}|null{
 if(!v||typeof v!=='object')return null;const s=v as Record<string,unknown>;if(!['vehicles','categories','locations'].every(k=>Array.isArray(s[k])&&(s[k] as Item[]).every(x=>x&&typeof x.id==='string'&&Number.isSafeInteger(x.version)&&x.version>0)))return null;return s as {vehicles:Item[];categories:Item[];locations:Item[]};
}
export default async function ArchivePage({searchParams}:{searchParams:Promise<{error?:string;success?:string}>}){
 const {db,profile}=await loadKeySession();const params=await searchParams;const result=await db.rpc('fm_fleet_archive_workspace');const s=result.error?null:parse(result.data);const manager=['fleet_manager','administrator'].includes(profile.role);
 return <FmShell orgName={profile.organization?.name??'—'} userName={profile.full_name} role={profile.role} isFleetManager={manager} isAdministrator={profile.role==='administrator'} active="fleet" nonDrivingWorkspace workspace="operations" wide><div className="ow"><header className="ow-heading"><div><h1>Arquivo da frota e cadastros desativados</h1><p>Históricos e documentos preservados. Reativar um veículo mantém bloqueios de avaria, documentação e equipamentos.</p></div><Link href="/fleet">Frota ativa</Link></header>
 {params.error&&<p className="ow-banner ow-error" role="alert">{params.error==='INVALID_REFERENCE'?'Reative primeiro a unidade, o modelo e os locais vinculados a este veículo.':params.error==='CONCURRENT_UPDATE'?'O registro mudou. Recarregue antes de reativar.':'Não foi possível reativar. Confira sua autorização, a justificativa e o estado atual.'}</p>}{params.success&&<p className="ow-banner" role="status">Reativação registrada e auditada.</p>}
 {!s?<p role="alert">Arquivo indisponível no seu escopo.</p>:(['vehicles','categories','locations'] as const).map(key=><Panel key={key} title={key==='vehicles'?'Veículos arquivados':key==='categories'?'Modelos desativados':'Locais desativados'}>{s[key].length===0?<Empty>Nenhum registro neste escopo.</Empty>:s[key].map(item=><details key={item.id}><summary>{item.plate??item.name}</summary>{item.archived_at&&<p>{date(item.archived_at)} · {item.reason}</p>}{key==='vehicles'&&<><Link href={`/fleet/vehicles/${item.id}`}>Histórico de reservas</Link> · <Link href={`/api/exports/vehicle/${item.id}`}>Exportar prontuário</Link> · <Link href={`/documents?target=vehicle&id=${item.id}`}>Documentos</Link></>}<form action={restoreFleetRecord} className="ow-form"><input type="hidden" name="kind" value={key==='vehicles'?'vehicle':key==='categories'?'category':'location'}/><input type="hidden" name="id" value={item.id}/><input type="hidden" name="version" value={item.version}/><input type="hidden" name="request_id" value={randomUUID()}/><Field name="reason" label="Justificativa da reativação" required maxLength={1000}/><Submit>Reativar registro</Submit></form></details>)}</Panel>)}
 </div></FmShell>;
}
