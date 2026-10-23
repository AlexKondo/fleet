import Link from 'next/link';
import {randomUUID} from 'node:crypto';
import {loadKeySession} from '@/lib/operations/keyCustodyLoad';
import {parseEquipmentSnapshot,type EquipmentSnapshot} from '@/lib/equipment/contract';
import {FmShell} from '@/app/carpool/FmShell';
import {Panel,Field,Submit} from '@/app/operations/Workspace';
import {saveEquipmentProfile} from './actions';
import {getAreaText} from '@/lib/i18n/areaText';
import {fleetEquipmentTexts} from '@/lib/i18n/areas/fleetEquipment';
import type {FleetEquipmentKey} from '@/lib/i18n/areas/fleetEquipment';
import '@/app/operations/operations.css';
function Configuration({state,kind,T}:{state:EquipmentSnapshot;kind:'vehicle'|'category';T:Record<FleetEquipmentKey,string>}){
 const profile=state.profiles.find(p=>p.target_kind===kind);
 const selected=new Set([...(profile?.required_ids??[]),...(profile?.optional_ids??[])]);
 return <form action={saveEquipmentProfile} className="ow-form"><input type="hidden" name="vehicle_id" value={state.vehicle.id}/><input type="hidden" name="kind" value={kind}/><input type="hidden" name="target_id" value={kind==='vehicle'?state.vehicle.id:state.vehicle.category_id}/><input type="hidden" name="version" value={profile?.version??0}/><input type="hidden" name="request_id" value={randomUUID()}/>
 <label className="ow-check"><input type="checkbox" name="enabled" defaultChecked={profile?.enabled??false}/>{kind==='vehicle'?T.useOwnConfig:T.publishModelDefault}</label>
 {state.catalog.filter(e=>e.enabled||selected.has(e.id)).map(e=><label key={e.id} className="ow-field"><span>{e.name}{!e.enabled?T.outsideCatalog:''}</span><select name={`item_${e.id}`} defaultValue={profile?.required_ids.includes(e.id)?'required':profile?.optional_ids.includes(e.id)?'optional':'absent'}><option value="absent">{T.notLinked}</option>{e.enabled&&<><option value="required">{T.requiredInSet}</option><option value="optional">{T.availableNoChecklist}</option></>}{!e.enabled&&selected.has(e.id)&&<option value={profile?.required_ids.includes(e.id)?'required':'optional'}>{T.removeBeforeSave}</option>}</select></label>)}
 <p>{T.selectionNote}</p><Field name="reason" label={T.reasonLabel} required maxLength={1000}/><Submit>{T.publish}</Submit></form>;
}
export default async function EquipmentPage({searchParams}:{searchParams:Promise<{vehicle?:string;error?:string;success?:string}>}){
 const {db,profile}=await loadKeySession();const params=await searchParams;const T=await getAreaText(fleetEquipmentTexts);
 const errors:Record<string,string>={NOT_AUTHORIZED:T.errNotAuthorized,CONCURRENT_UPDATE:T.errConcurrent,INVALID_REFERENCE:T.errInvalidReference,DUPLICATE_EQUIPMENT_NAME:T.errDuplicateName,IDEMPOTENCY_CONFLICT:T.errIdempotency};
 const result=/^[0-9a-f-]{36}$/i.test(params.vehicle??'')?await db.rpc('fm_equipment_vehicle_snapshot',{p_vehicle_id:params.vehicle!}):null;
 const state=result&&!result.error?parseEquipmentSnapshot(result.data):null;const manager=['fleet_manager','administrator'].includes(profile.role);
 return <FmShell orgName={profile.organization?.name??'—'} userName={profile.full_name} role={profile.role} isFleetManager={manager} isAdministrator={profile.role==='administrator'} active="fleet" nonDrivingWorkspace workspace="operations" wide><div className="ow"><header className="ow-heading"><div><h1>{T.title}</h1><p>{T.subtitle}</p></div><Link href={`/maintenance/vehicles?vehicle=${state?.vehicle.id??''}`}>{T.record}</Link></header>
 {params.error&&<p role="alert" className="ow-banner ow-error">{errors[params.error]??T.errGeneric}</p>}{params.success&&<p role="status" className="ow-banner">{T.successPublished}</p>}
 {!state?<p role="alert">{T.unavailable}</p>:<><Panel title={state.vehicle.plate}>{state.effective.configured?<><p>{T.origin}: {state.effective.source==='vehicle'?T.originVehicle:T.originModel} · {T.revision} {state.effective.version}</p><p>{T.requiredLabel}: {state.effective.required?.map(e=>e.name).join(', ')||T.noneExplicit}</p><p>{T.optionalLabel}: {state.effective.optional?.map(e=>e.name).join(', ')||T.none}</p></>:<p role="alert">{T.notPublished}</p>}</Panel>{state.can_edit&&<Panel title={T.panelOwn}><Configuration state={state} kind="vehicle" T={T}/></Panel>}{state.can_edit_category&&<Panel title={T.panelModel}><Configuration state={state} kind="category" T={T}/></Panel>}<Link href="/settings">{T.catalog}</Link></>}
 </div></FmShell>;
}
