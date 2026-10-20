"use server";
import {redirect} from 'next/navigation';
import {revalidatePath} from 'next/cache';
import {loadKeySession} from '@/lib/operations/keyCustodyLoad';
import {keyErrorCode} from '@/lib/operations/keyCustody';
export async function approveMaintenanceBudget(form:FormData){
 const {db}=await loadKeySession();let failure:string|null=null;
 try{
  const version=Number(form.get('version'));
  if(form.get('confirmation')!=='on'||!Number.isSafeInteger(version)||version<1)throw new Error('INVALID_INPUT');
  const {error}=await db.rpc('fm_budget_approve',{p_order_id:String(form.get('id')),p_version:version,p_request_id:String(form.get('request_id'))});
  if(error)failure=keyErrorCode(error.message);
 }catch(e){failure=e instanceof Error?keyErrorCode(e.message):'UNAVAILABLE';}
 if(!failure){revalidatePath('/account/maintenance-approvals');revalidatePath('/maintenance','layout');revalidatePath('/fleet/maintenance');}
 redirect(`/account/maintenance-approvals?${failure?`error=${failure}`:'success=1'}`);
}
