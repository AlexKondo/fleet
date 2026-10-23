import Link from 'next/link';
import {randomUUID} from 'node:crypto';
import {loadKeySession} from '@/lib/operations/keyCustodyLoad';
import {FmShell} from '@/app/carpool/FmShell';
import {Panel,Field,Submit,Empty,date} from '@/app/operations/Workspace';
import {restoreFleetRecord} from './actions';
import {getAreaText} from '@/lib/i18n/areaText';
import {fleetArchiveTexts} from '@/lib/i18n/areas/fleetArchive';
import '@/app/operations/operations.css';
type Item={id:string;plate?:string;name?:string|null;reason?:string;archived_at?:string;version:number};
function parse(v:unknown):{vehicles:Item[];categories:Item[];locations:Item[]}|null{
 if(!v||typeof v!=='object')return null;const s=v as Record<string,unknown>;if(!['vehicles','categories','locations'].every(k=>Array.isArray(s[k])&&(s[k] as Item[]).every(x=>x&&typeof x.id==='string'&&Number.isSafeInteger(x.version)&&x.version>0)))return null;return s as {vehicles:Item[];categories:Item[];locations:Item[]};
}
export default async function ArchivePage({searchParams}:{searchParams:Promise<{error?:string;success?:string}>}){
 const {db,profile}=await loadKeySession();const params=await searchParams;const T=await getAreaText(fleetArchiveTexts);const result=await db.rpc('fm_fleet_archive_workspace');const s=result.error?null:parse(result.data);const manager=['fleet_manager','administrator'].includes(profile.role);
 return <FmShell orgName={profile.organization?.name??'—'} userName={profile.full_name} role={profile.role} isFleetManager={manager} isAdministrator={profile.role==='administrator'} active="fleet" nonDrivingWorkspace workspace="operations" wide><div className="ow"><header className="ow-heading"><div><h1>{T.title}</h1><p>{T.subtitle}</p></div><Link href="/fleet">{T.activeFleet}</Link></header>
 {params.error&&<p className="ow-banner ow-error" role="alert">{params.error==='INVALID_REFERENCE'?T.errorInvalidReference:params.error==='CONCURRENT_UPDATE'?T.errorConcurrent:T.errorGeneric}</p>}{params.success&&<p className="ow-banner" role="status">{T.successRestored}</p>}
 {!s?<p role="alert">{T.unavailable}</p>:(['vehicles','categories','locations'] as const).map(key=><Panel key={key} title={key==='vehicles'?T.panelVehicles:key==='categories'?T.panelCategories:T.panelLocations}>{s[key].length===0?<Empty>{T.empty}</Empty>:s[key].map(item=><details key={item.id}><summary>{item.plate??item.name}</summary>{item.archived_at&&<p>{date(item.archived_at)} · {item.reason}</p>}{key==='vehicles'&&<><Link href={`/fleet/vehicles/${item.id}`}>{T.bookingHistory}</Link> · <Link href={`/api/exports/vehicle/${item.id}`}>{T.exportRecord}</Link> · <Link href={`/documents?target=vehicle&id=${item.id}`}>{T.documents}</Link></>}<form action={restoreFleetRecord} className="ow-form"><input type="hidden" name="kind" value={key==='vehicles'?'vehicle':key==='categories'?'category':'location'}/><input type="hidden" name="id" value={item.id}/><input type="hidden" name="version" value={item.version}/><input type="hidden" name="request_id" value={randomUUID()}/><Field name="reason" label={T.reasonLabel} required maxLength={1000}/><Submit>{T.restore}</Submit></form></details>)}</Panel>)}
 </div></FmShell>;
}
