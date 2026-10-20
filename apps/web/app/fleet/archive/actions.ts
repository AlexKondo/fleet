"use server";
import {redirect} from 'next/navigation';
import {revalidatePath} from 'next/cache';
import {loadKeySession} from '@/lib/operations/keyCustodyLoad';
export async function restoreFleetRecord(form:FormData){
 const {db}=await loadKeySession();let failure:string|undefined;
 try{
  const version=Number(form.get('version'));if(!Number.isSafeInteger(version)||version<1)throw new Error('INVALID_INPUT');
  const {error}=await db.rpc('fm_fleet_lifecycle',{p_kind:String(form.get('kind')),p_id:String(form.get('id')),p_enabled:true,p_version:version,p_reason:String(form.get('reason')??'').trim(),p_request_id:String(form.get('request_id'))});if(error)throw new Error(error.message);
 }catch(e){const msg=e instanceof Error?e.message:'';failure=['NOT_AUTHORIZED','CONCURRENT_UPDATE','INVALID_REFERENCE','INVALID_INPUT','INVALID_STATE_TRANSITION','IDEMPOTENCY_CONFLICT'].includes(msg)?msg:'UNAVAILABLE';}
 if(!failure){revalidatePath('/fleet','layout');revalidatePath('/dashboard','layout');}
 redirect(`/fleet/archive?${failure?`error=${failure}`:'success=1'}`);
}
