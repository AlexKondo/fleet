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
import "@/app/operations/operations.css";
function Form({command,version,children}:{command:string;version:number;children:ReactNode}){
 return <form action={saveUnitConfiguration} className="ow-form"><input type="hidden" name="request_id" value={randomUUID()}/><input type="hidden" name="command" value={command}/><input type="hidden" name="version" value={version}/>{children}<Field name="reason" label="Justificativa" required maxLength={1000}/><Submit>Salvar configuração</Submit></form>;
}
function Workflow({value="gate_visual"}:{value?:string}){return <label className="ow-field"><span>Processo de retirada e devolução</span><select name="workflow" defaultValue={value} required><option value="gate_visual">Conferência visual pela Segurança — IRA</option><option value="key_custody">Custódia de chaves no escritório — SP</option></select></label>;}
export default async function UnitsPage({searchParams}:{searchParams:Promise<{error?:string;success?:string}>}){
 const {db,profile}=await loadKeySession(true);const params=await searchParams;
 const scopeResult=await db.rpc("fm_manager_scope_admin_snapshot");
 const scope=scopeResult.error?null:parseScopeAdminSnapshot(scopeResult.data);
 const policyResult=await db.rpc("fm_maintenance_policy_snapshot");
 const policies=policyResult.error?null:parseMaintenancePolicies(policyResult.data);
 const {data,error}=await db.rpc("fm_unit_admin_snapshot");const state=error?null:parseUnitAdminState(data);
 return <FmShell orgName={profile.organization?.name??"—"} userName={profile.full_name} role={profile.role} isFleetManager isAdministrator active="admin" workspace="operations" wide><div className="ow">
 <header className="ow-heading"><div><h1>Unidades e custódia de chaves</h1><p>Designe quem entrega e recebe as chaves em cada unidade, independentemente de onde fica o gestor da frota.</p></div><Link href="/admin">Administração</Link></header>
 {params.error&&<p className="ow-banner ow-error" role="alert">{keyErrorText(params.error)}</p>}{params.success&&<p className="ow-banner" role="status">Configuração salva e auditada.</p>}
 <p>Uma designação de custódia não concede gestão de frota. O gestor local também precisa ser designado para confirmar as chaves. A unidade operacional do veículo é independente do estacionamento informado no checklist.</p>
 {!state?<p role="alert">Não foi possível consultar a configuração. Nenhuma permissão foi presumida; as alterações estão indisponíveis.</p>:<>
 <Panel title="Gestão local ou centralizada">
 <p>A unidade-base do veículo define o acesso de gestão. O estacionamento e as viagens não alteram a autorização. Administradores mantêm acesso organizacional.</p>
 {!scope?<p role="alert">Não foi possível consultar os escopos de gestão. Nenhuma autorização foi presumida.</p>:<>
 {scope.managers.length===0&&<Empty>Nenhum gestor de frota cadastrado.</Empty>}
 {scope.managers.map(manager=><details key={manager.id}><summary>{manager.name} · {manager.mode==="all_units"?"Todas as unidades":`${manager.unit_ids.length} unidade(s) autorizada(s)`}{!manager.enabled?" · Conta desativada":""}</summary>
 <form action={saveManagerScope} className="ow-form">
 <input type="hidden" name="user_id" value={manager.id}/><input type="hidden" name="version" value={manager.version}/><input type="hidden" name="request_id" value={randomUUID()}/>
 <label className="ow-field"><span>Abrangência da gestão</span><select name="mode" defaultValue={manager.mode} required><option value="selected_units">Somente unidades selecionadas</option><option value="all_units">Todas as unidades da organização</option></select></label>
 <fieldset><legend>Unidades autorizadas no modo de seleção</legend>{scope.units.map(unit=><label className="ow-check" key={unit.id}><input type="checkbox" name="unit_ids" value={unit.id} defaultChecked={manager.unit_ids.includes(unit.id)}/>{unit.name}{!unit.enabled?" · Unidade inativa":""}</label>)}</fieldset>
 <p>Sem unidades selecionadas, o gestor não terá acesso de gestão. Reservas pessoais e designações de chaves permanecem independentes. No modo de todas as unidades, a seleção acima é ignorada.</p>
 <Field name="reason" label="Justificativa da autorização" required maxLength={1000}/><Submit disabled={!manager.enabled}>Salvar abrangência</Submit>
 </form></details>)}
 <details><summary>Histórico de autorizações</summary>{scope.history.map(h=><p key={h.id}>{scope.managers.find(m=>m.id===h.user_id)?.name??"Gestor"} · revisão {h.version} · {h.mode==="all_units"?"Todas as unidades":h.unit_ids.map(id=>scope.units.find(u=>u.id===id)?.name??id).join(", ")||"Sem unidades"} · {h.reason} · {h.created_at}</p>)}</details>
 </>}
 </Panel>
 <Panel title="Cadastrar unidade"><Form command="unit.save" version={0}><Field name="name" label="Nome da unidade" required maxLength={120}/><Workflow/><label className="ow-check"><input type="checkbox" name="enabled" defaultChecked/> Unidade ativa</label></Form></Panel>
 {state.units.length===0&&<Empty>Nenhuma unidade cadastrada. Cadastre as unidades reais da operação; nenhuma unidade foi criada a partir de dados demonstrativos.</Empty>}
 {state.units.map(unit=><Panel key={unit.id} title={unit.name}>
 <details><summary>Editar unidade e processo operacional</summary><Form command="unit.save" version={unit.version}><input type="hidden" name="id" value={unit.id}/><Field name="name" label="Nome" value={unit.name} required maxLength={120}/><Workflow value={unit.workflow}/><label className="ow-check"><input type="checkbox" name="enabled" defaultChecked={unit.enabled}/> Unidade ativa</label></Form></details>
 <details><summary>Política de aprovação de manutenção</summary>
 {policies===null?<p role="alert">Políticas indisponíveis. Recarregue para configurar.</p>:<form action={saveMaintenancePolicy} className="ow-form">
 <input type="hidden" name="unit_id" value={unit.id}/><input type="hidden" name="version" value={policies.find(p=>p.unit_id===unit.id)?.version??0}/><input type="hidden" name="request_id" value={randomUUID()}/>
 <label className="ow-field"><span>Aprovadores regulares</span><select name="mode" defaultValue={policies.find(p=>p.unit_id===unit.id)?.mode??"scoped_managers"}><option value="scoped_managers">Gestores com acesso à unidade</option><option value="designated">Somente os aprovadores selecionados</option></select></label>
 <fieldset><legend>Aprovadores selecionados</legend>{state.people.filter(p=>p.enabled&&["fleet_manager","administrator"].includes(p.role)).map(p=><label className="ow-check" key={p.id}><input type="checkbox" name="approver_ids" value={p.id} defaultChecked={policies.find(x=>x.unit_id===unit.id)?.approver_ids.includes(p.id)??false}/>{p.name}</label>)}</fieldset>
 <fieldset><legend>Gestores superiores autorizados</legend>{state.people.filter(p=>p.enabled).map(p=><label className="ow-check" key={p.id}><input type="checkbox" name="superior_ids" value={p.id} defaultChecked={policies.find(x=>x.unit_id===unit.id)?.superior_ids.includes(p.id)??false}/>{p.name}</label>)}</fieldset>
 <p>Os aprovadores regulares precisam de acesso de gestão à unidade. O superior designado recebe permissão restrita para aprovar orçamentos desta unidade, sem alterar seu papel principal. Quem criou ou lançou o orçamento não pode aprová-lo. Se um gestor participou do lançamento, outro superior designado deve aprovar. Sem superior designado, esse orçamento aguarda configuração; não há aprovação automática.</p>
 <Field name="reason" label="Justificativa da política" required maxLength={1000}/><Submit>Salvar política de manutenção</Submit>
 </form>}
 </details>
 <h3>Responsáveis pelas chaves</h3>
 {unit.workflow!=="key_custody"&&<p>A custódia de chaves no escritório está disponível somente no processo de chaves. A Segurança da IRA mantém sua conferência visual.</p>}
 {state.assignments.filter(a=>a.unit_id===unit.id).map(a=><div key={a.user_id}><p>{state.people.find(p=>p.id===a.user_id)?.name??"Usuário"} · {a.enabled?"Designação ativa":"Designação desativada"}</p><Form command="unit.custodian" version={a.version}><input type="hidden" name="unit_id" value={unit.id}/><input type="hidden" name="user_id" value={a.user_id}/><input type="hidden" name="enabled" value={String(!a.enabled)}/><p>{a.enabled?"Desativar esta designação preservando o histórico.":"Reativar esta designação sem alterar o papel do usuário."}</p></Form></div>)}
 {unit.enabled&&unit.workflow==="key_custody"&&<Form command="unit.custodian" version={0}><input type="hidden" name="unit_id" value={unit.id}/><input type="hidden" name="enabled" value="true"/><label className="ow-field"><span>Designar responsável local</span><select name="user_id" required defaultValue=""><option value="" disabled>Selecione um usuário ativo</option>{state.people.filter(p=>p.enabled&&!state.assignments.some(a=>a.unit_id===unit.id&&a.user_id===p.id)).map(p=><option key={p.id} value={p.id}>{p.name}{p.role==="fleet_manager"?" — gestor de frota":""}</option>)}</select></label><p>Permissão apenas para confirmar entrega, recebimento e registrar exceções das chaves nesta unidade.</p></Form>}
 </Panel>)}
 <Panel title="Unidade operacional dos veículos"><p>Veículos sem unidade preservam o processo existente da IRA. A alteração é bloqueada se houver reserva pendente de aprovação, confirmada ou chaves pendentes de recebimento.</p>{state.vehicles.map(v=><details key={v.id}><summary>{v.plate} · {state.units.find(u=>u.id===v.unit_id)?.name??"Sem unidade atribuída"}</summary><Form command="unit.vehicle" version={v.version}><input type="hidden" name="vehicle_id" value={v.id}/><label className="ow-field"><span>Unidade</span><select name="unit_id" defaultValue={v.unit_id??""} required><option value="" disabled>Selecione</option>{state.units.filter(u=>u.enabled).map(u=><option key={u.id} value={u.id}>{u.name}</option>)}</select></label></Form></details>)}</Panel>
 </>}
 </div></FmShell>;
}
