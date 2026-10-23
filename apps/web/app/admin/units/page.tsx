import Link from "next/link";
import {randomUUID} from "node:crypto";
import type {ReactNode} from "react";
import {FmShell} from "@/app/carpool/FmShell";
import {Panel,Field,Submit,Empty} from "@/app/operations/Workspace";
import {loadKeySession} from "@/lib/operations/keyCustodyLoad";
import {parseUnitAdminState,keyErrorText} from "@/lib/operations/keyCustody";
import {parseMaintenancePolicies} from "@/lib/operations/maintenanceApproval";
import {parseScopeAdminSnapshot} from "@/lib/operations/managerScope";
import {saveMaintenancePolicy,saveManagerScope,saveUnitConfiguration} from "./actions";
import {fmt,getAreaText} from "@/lib/i18n/areaText";
import {adminUnitsTexts} from "@/lib/i18n/areas/adminUnits";
import type {AdminUnitsKey} from "@/lib/i18n/areas/adminUnits";
import "@/app/operations/operations.css";
type UT=Record<AdminUnitsKey,string>;
function Form({T,command,version,children}:{T:UT;command:string;version:number;children:ReactNode}){
 return <form action={saveUnitConfiguration} className="ow-form"><input type="hidden" name="request_id" value={randomUUID()}/><input type="hidden" name="command" value={command}/><input type="hidden" name="version" value={version}/>{children}<Field name="reason" label={T.reason} required maxLength={1000}/><Submit>{T.saveConfig}</Submit></form>;
}
function Workflow({T,value="gate_visual"}:{T:UT;value?:string}){return <label className="ow-field"><span>{T.workflowLabel}</span><select name="workflow" defaultValue={value} required><option value="gate_visual">{T.workflowGate}</option><option value="key_custody">{T.workflowKeys}</option></select></label>;}
export default async function UnitsPage({searchParams}:{searchParams:Promise<{error?:string;success?:string}>}){
 const {db,profile}=await loadKeySession(true);const params=await searchParams;const T=await getAreaText(adminUnitsTexts);
 const scopeResult=await db.rpc("fm_manager_scope_admin_snapshot");
 const scope=scopeResult.error?null:parseScopeAdminSnapshot(scopeResult.data);
 const policyResult=await db.rpc("fm_maintenance_policy_snapshot");
 const policies=policyResult.error?null:parseMaintenancePolicies(policyResult.data);
 const {data,error}=await db.rpc("fm_unit_admin_snapshot");const state=error?null:parseUnitAdminState(data);
 return <FmShell orgName={profile.organization?.name??"—"} userName={profile.full_name} role={profile.role} isFleetManager isAdministrator active="admin" workspace="operations" wide><div className="ow">
 <header className="ow-heading"><div><h1>{T.title}</h1><p>{T.intro}</p></div><Link href="/admin">{T.adminLink}</Link></header>
 {params.error&&<p className="ow-banner ow-error" role="alert">{keyErrorText(params.error)}</p>}{params.success&&<p className="ow-banner" role="status">{T.saved}</p>}
 <p>{T.custodyNote}</p>
 {!state?<p role="alert">{T.unavailable}</p>:<>
 <Panel title={T.scopePanel}>
 <p>{T.scopeNote}</p>
 {!scope?<p role="alert">{T.scopeUnavailable}</p>:<>
 {scope.managers.length===0&&<Empty>{T.noManagers}</Empty>}
 {scope.managers.map(manager=><details key={manager.id}><summary>{manager.name} · {manager.mode==="all_units"?T.allUnits:fmt(T.authorizedUnits,{n:manager.unit_ids.length})}{!manager.enabled?" · "+T.accountDisabled:""}</summary>
 <form action={saveManagerScope} className="ow-form">
 <input type="hidden" name="user_id" value={manager.id}/><input type="hidden" name="version" value={manager.version}/><input type="hidden" name="request_id" value={randomUUID()}/>
 <label className="ow-field"><span>{T.scopeLabel}</span><select name="mode" defaultValue={manager.mode} required><option value="selected_units">{T.onlySelected}</option><option value="all_units">{T.allOrgUnits}</option></select></label>
 <fieldset><legend>{T.authorizedLegend}</legend>{scope.units.map(unit=><label className="ow-check" key={unit.id}><input type="checkbox" name="unit_ids" value={unit.id} defaultChecked={manager.unit_ids.includes(unit.id)}/>{unit.name}{!unit.enabled?" · "+T.unitInactive:""}</label>)}</fieldset>
 <p>{T.scopeHint}</p>
 <Field name="reason" label={T.scopeReason} required maxLength={1000}/><Submit disabled={!manager.enabled}>{T.saveScope}</Submit>
 </form></details>)}
 <details><summary>{T.historyTitle}</summary>{scope.history.map(h=><p key={h.id}>{fmt(T.historyLine,{name:scope.managers.find(m=>m.id===h.user_id)?.name??T.manager,version:h.version,scope:h.mode==="all_units"?T.allUnits:h.unit_ids.map(id=>scope.units.find(u=>u.id===id)?.name??id).join(", ")||T.noUnits,reason:h.reason,date:h.created_at})}</p>)}</details>
 </>}
 </Panel>
 <Panel title={T.registerUnit}><Form T={T} command="unit.save" version={0}><Field name="name" label={T.unitName} required maxLength={120}/><Workflow T={T}/><label className="ow-check"><input type="checkbox" name="enabled" defaultChecked/> {T.unitActive}</label></Form></Panel>
 {state.units.length===0&&<Empty>{T.noUnitsRegistered}</Empty>}
 {state.units.map(unit=><Panel key={unit.id} title={unit.name}>
 <details><summary>{T.editUnit}</summary><Form T={T} command="unit.save" version={unit.version}><input type="hidden" name="id" value={unit.id}/><Field name="name" label={T.name} value={unit.name} required maxLength={120}/><Workflow T={T} value={unit.workflow}/><label className="ow-check"><input type="checkbox" name="enabled" defaultChecked={unit.enabled}/> {T.unitActive}</label></Form></details>
 <details><summary>{T.maintPolicy}</summary>
 {policies===null?<p role="alert">{T.policiesUnavailable}</p>:<form action={saveMaintenancePolicy} className="ow-form">
 <input type="hidden" name="unit_id" value={unit.id}/><input type="hidden" name="version" value={policies.find(p=>p.unit_id===unit.id)?.version??0}/><input type="hidden" name="request_id" value={randomUUID()}/>
 <label className="ow-field"><span>{T.regularApprovers}</span><select name="mode" defaultValue={policies.find(p=>p.unit_id===unit.id)?.mode??"scoped_managers"}><option value="scoped_managers">{T.scopedManagers}</option><option value="designated">{T.designatedOnly}</option></select></label>
 <fieldset><legend>{T.selectedApprovers}</legend>{state.people.filter(p=>p.enabled&&["fleet_manager","administrator"].includes(p.role)).map(p=><label className="ow-check" key={p.id}><input type="checkbox" name="approver_ids" value={p.id} defaultChecked={policies.find(x=>x.unit_id===unit.id)?.approver_ids.includes(p.id)??false}/>{p.name}</label>)}</fieldset>
 <fieldset><legend>{T.superiors}</legend>{state.people.filter(p=>p.enabled).map(p=><label className="ow-check" key={p.id}><input type="checkbox" name="superior_ids" value={p.id} defaultChecked={policies.find(x=>x.unit_id===unit.id)?.superior_ids.includes(p.id)??false}/>{p.name}</label>)}</fieldset>
 <p>{T.policyHint}</p>
 <Field name="reason" label={T.policyReason} required maxLength={1000}/><Submit>{T.savePolicy}</Submit>
 </form>}
 </details>
 <h3>{T.keyHolders}</h3>
 {unit.workflow!=="key_custody"&&<p>{T.custodyOnlyKeys}</p>}
 {state.assignments.filter(a=>a.unit_id===unit.id).map(a=><div key={a.user_id}><p>{state.people.find(p=>p.id===a.user_id)?.name??T.user} · {a.enabled?T.assignmentActive:T.assignmentOff}</p><Form T={T} command="unit.custodian" version={a.version}><input type="hidden" name="unit_id" value={unit.id}/><input type="hidden" name="user_id" value={a.user_id}/><input type="hidden" name="enabled" value={String(!a.enabled)}/><p>{a.enabled?T.deactivateHint:T.reactivateHint}</p></Form></div>)}
 {unit.enabled&&unit.workflow==="key_custody"&&<Form T={T} command="unit.custodian" version={0}><input type="hidden" name="unit_id" value={unit.id}/><input type="hidden" name="enabled" value="true"/><label className="ow-field"><span>{T.assignLocal}</span><select name="user_id" required defaultValue=""><option value="" disabled>{T.selectActiveUser}</option>{state.people.filter(p=>p.enabled&&!state.assignments.some(a=>a.unit_id===unit.id&&a.user_id===p.id)).map(p=><option key={p.id} value={p.id}>{p.name}{p.role==="fleet_manager"?" — "+T.fleetManagerSuffix:""}</option>)}</select></label><p>{T.assignHint}</p></Form>}
 </Panel>)}
 <Panel title={T.vehicleUnitPanel}><p>{T.vehicleUnitNote}</p>{state.vehicles.map(v=><details key={v.id}><summary>{v.plate} · {state.units.find(u=>u.id===v.unit_id)?.name??T.noUnitAssigned}</summary><Form T={T} command="unit.vehicle" version={v.version}><input type="hidden" name="vehicle_id" value={v.id}/><label className="ow-field"><span>{T.unit}</span><select name="unit_id" defaultValue={v.unit_id??""} required><option value="" disabled>{T.select}</option>{state.units.filter(u=>u.enabled).map(u=><option key={u.id} value={u.id}>{u.name}</option>)}</select></label></Form></details>)}</Panel>
 </>}
 </div></FmShell>;
}
