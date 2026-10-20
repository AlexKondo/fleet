import Link from 'next/link';
import {OrderAdjustments} from '@/app/operations/OrderAdjustments';
import type {FinancialAdjustment} from '@/lib/operations/models';
import {randomUUID} from 'node:crypto';
import {FmShell} from '@/app/carpool/FmShell';
import {Panel,Submit,money,Empty} from '@/app/operations/Workspace';
import {loadKeySession} from '@/lib/operations/keyCustodyLoad';
import {keyErrorText} from '@/lib/operations/keyCustody';
import {parseBudgetQueue} from '@/lib/operations/maintenanceApproval';
import {approveMaintenanceBudget} from './actions';
import '@/app/operations/operations.css';
export default async function MaintenanceApprovalsPage({searchParams}:{searchParams:Promise<{error?:string;success?:string;adjustmentError?:string}>}){
 const {db,profile}=await loadKeySession();const params=await searchParams;
 const {data,error}=await db.rpc('fm_budget_approval_queue');const orders=error?null:parseBudgetQueue(data);
 const adjustmentResult=await db.rpc('fm_order_adjustment_workspace');const adjustments=!adjustmentResult.error&&Array.isArray(adjustmentResult.data)?adjustmentResult.data as unknown as FinancialAdjustment[]:null;
 const manager=['fleet_manager','administrator'].includes(profile.role);
 return <FmShell orgName={profile.organization?.name??'—'} userName={profile.full_name} role={profile.role} isFleetManager={manager} isAdministrator={profile.role==='administrator'} active="budgetApprovals" nonDrivingWorkspace workspace="operations" wide><div className="ow">
 <header className="ow-heading"><div><h1>Aprovação de orçamentos de manutenção</h1><p>Orçamentos pendentes autorizados para sua atuação nesta unidade.</p></div></header>
 {params.error&&<p className="ow-banner ow-error" role="alert">{keyErrorText(params.error)}</p>}{params.success&&<p className="ow-banner" role="status">Aprovação registrada com a política e a identidade do aprovador.</p>}
 {orders===null?<p role="alert">Não foi possível consultar a fila. Nenhuma autorização foi presumida.</p>:orders.length===0?<Empty>Nenhum orçamento pendente elegível para sua aprovação. Seus próprios lançamentos não podem ser aprovados por você.</Empty>:orders.map(o=><Panel key={o.id} title={`OS ${o.number} · ${o.plate}`}><p>{o.unit} · {o.description}</p><Link href={`/documents?target=work_order&id=${o.id}`}>Consultar documentos do orçamento</Link><p>Orçamento solicitado: <strong>{money(o.quote_total)}</strong> · Limite aprovado anteriormente: {money(o.approved_total)}</p><form action={approveMaintenanceBudget} className="ow-form"><input type="hidden" name="id" value={o.id}/><input type="hidden" name="version" value={o.version}/><input type="hidden" name="request_id" value={randomUUID()}/><label className="ow-check"><input type="checkbox" name="confirmation" required/> Confirmo a aprovação deste orçamento no valor de {money(o.quote_total)}.</label><Submit>Aprovar orçamento</Submit></form></Panel>)}
 {params.adjustmentError&&<p role='alert'>Não foi possível registrar o ajuste. Confira a independência do aprovador, a política e a versão atual.</p>}<Panel title='Ajustes financeiros pendentes'><OrderAdjustments adjustments={adjustments?.filter(a=>a.status==='pending'&&a.can_review)} queue/></Panel>
 </div></FmShell>;
}
