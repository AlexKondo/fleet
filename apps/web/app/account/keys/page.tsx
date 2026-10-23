import {randomUUID} from "node:crypto";
import {FmShell} from "@/app/carpool/FmShell";
import {Panel,Field,Submit,date} from "@/app/operations/Workspace";
import {loadKeySession} from "@/lib/operations/keyCustodyLoad";
import {parseKeyWorkspace} from "@/lib/operations/keyCustody";
import {getAreaText,fmt} from "@/lib/i18n/areaText";
import {accountKeysTexts,type AccountKeysKey} from "@/lib/i18n/areas/accountKeys";
import {confirmKeys} from "./actions";
import {KeyHistory} from "./KeyHistory";
import "@/app/operations/operations.css";
export default async function KeysPage({searchParams}:{searchParams:Promise<{error?:string;success?:string}>}){
 const {db,profile}=await loadKeySession();const params=await searchParams;
 const {data,error}=await db.rpc("fm_key_workspace");const state=error?null:parseKeyWorkspace(data);
 const permitted=!!state?.units.length;const T=await getAreaText(accountKeysTexts);
 const errorText=(code:string)=>T[`e_${code}` as AccountKeysKey]??T.e_default;
 return <FmShell orgName={profile.organization?.name??"—"} userName={profile.full_name} role={profile.role} isFleetManager={["fleet_manager","administrator"].includes(profile.role)} isAdministrator={profile.role==="administrator"} active="keys" nonDrivingWorkspace={permitted} workspace="operations" wide><div className="ow">
 <header className="ow-heading"><div><h1>{T.title}</h1><p>{T.subtitle}</p></div></header>
 {params.error&&<p className="ow-banner ow-error" role="alert">{errorText(params.error)}</p>}{params.success&&<p className="ow-banner" role="status">{T.saved}</p>}
 {!state?<p role="alert">{T.unavailable}</p>:!permitted?<p>{T.noDesignation}</p>:<>
 <p>{fmt(T.units,{units:state.units.map(u=>u.name).join(", ")})}</p>
 {state.reservations.length===0&&<p>{T.noReservations}</p>}
 {state.reservations.map(r=><Panel key={r.id} title={`${r.plate} · ${r.unit}`}><p>{fmt(T.period,{who:r.requester,from:date(r.start_at,true),to:date(r.end_at,true)})}</p><p>{r.received?T.stReceived:r.delivered?T.stDelivered:T.stPending}{r.status==="cancelled"?T.stCancelled:""}</p>
 {r.self?<p>{T.otherPerson}</p>:<>
 {!r.received&&<form action={confirmKeys} className="ow-form"><input type="hidden" name="request_id" value={randomUUID()}/><input type="hidden" name="reservation_id" value={r.id}/><input type="hidden" name="kind" value={r.delivered?"received":"delivered"}/><label className="ow-check"><input type="checkbox" name="physical_confirmation" required/> {r.delivered?T.confirmReceived:T.confirmDelivered}</label><Field name="reason" label={T.reasonOptional} maxLength={1000}/><Submit>{r.delivered?T.btnReceived:T.btnDelivered}</Submit></form>}
 <details><summary>{T.exceptionSummary}</summary><form action={confirmKeys} className="ow-form"><input type="hidden" name="request_id" value={randomUUID()}/><input type="hidden" name="reservation_id" value={r.id}/><input type="hidden" name="kind" value="exception"/><Field name="reason" label={T.exceptionDescribe} required maxLength={1000}/><label className="ow-check"><input type="checkbox" name="physical_confirmation" required/> {T.exceptionConfirm}</label><Submit>{T.exceptionSubmit}</Submit></form></details>
 </>}
 </Panel>)}
 <KeyHistory events={state.events} T={T}/>
 </>}
 </div></FmShell>;
}
