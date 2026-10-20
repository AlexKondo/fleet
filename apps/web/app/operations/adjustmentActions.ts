"use server";
import {redirect} from "next/navigation";
import {revalidatePath} from "next/cache";
import {loadKeySession} from "@/lib/operations/keyCustodyLoad";
import {isUuid} from "@/lib/carpool/rpcErrors";
export async function financialAdjustment(form:FormData){
 const {db}=await loadKeySession();const command=String(form.get('command')??'');const request=String(form.get('request_id')??'');
 const order=String(form.get('order_id')??'');const queue=form.get('queue')==='1';const base=queue?'/account/maintenance-approvals':`/maintenance/work-orders?order=${isUuid(order)?order:''}`;
 const payload={id:String(form.get('id')??''),order_id:order,version:Number(form.get('version')),delta:Number(form.get('delta')),reason:String(form.get('reason')??'')};
 const result=isUuid(request)&&payload.reason.length<=3000?await db.rpc('fm_order_adjustment_command',{p_command:command,p_payload:payload,p_request_id:request}):null;
 const code=result?.error?/SELF_APPROVAL_DENIED|SUPERIOR_APPROVAL_REQUIRED|APPROVER_NOT_AUTHORIZED|CONCURRENT_UPDATE|NEGATIVE_EFFECTIVE_COST|INVALID_STATE_TRANSITION|NOT_AUTHORIZED|IDEMPOTENCY_CONFLICT/.exec(result.error.message)?.[0]??'INVALID_INPUT':!result?'INVALID_INPUT':null;
 revalidatePath('/maintenance');revalidatePath('/fleet');revalidatePath('/account/maintenance-approvals');redirect(`${base}${base.includes('?')?'&':'?'}${code?`error=${code}`:'success=1'}`);
}
