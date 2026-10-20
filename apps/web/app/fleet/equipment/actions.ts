"use server";
import {redirect} from 'next/navigation';
import {revalidatePath} from 'next/cache';
import {loadKeySession} from '@/lib/operations/keyCustodyLoad';
export async function saveEquipmentProfile(form:FormData){
 const {db}=await loadKeySession();const vehicle=String(form.get('vehicle_id'));let failure:string|undefined;
 try{
  if(!/^[0-9a-f-]{36}$/i.test(vehicle))throw new Error('INVALID_INPUT');
  const version=Number(form.get('version'));if(!Number.isSafeInteger(version)||version<0)throw new Error('INVALID_INPUT');
  const enabled=form.get('enabled')==='on';const required:string[]=[],optional:string[]=[];
  if(enabled)for(const [key,value] of form.entries())if(key.startsWith('item_')){if(value==='required')required.push(key.slice(5));else if(value==='optional')optional.push(key.slice(5));}
  const {error}=await db.rpc('fm_equipment_profile_save',{p_kind:String(form.get('kind')),p_target_id:String(form.get('target_id')),p_required_ids:required,p_optional_ids:optional,p_enabled:enabled,p_version:version,p_reason:String(form.get('reason')??'').trim(),p_request_id:String(form.get('request_id'))});
  if(error)throw new Error(error.message);
 }catch(e){const msg=e instanceof Error?e.message:'';failure=['NOT_AUTHORIZED','CONCURRENT_UPDATE','IDEMPOTENCY_CONFLICT','INVALID_REFERENCE','INVALID_INPUT','DUPLICATE_EQUIPMENT_NAME'].includes(msg)?msg:'UNAVAILABLE';}
 if(!failure){revalidatePath('/fleet/equipment');revalidatePath('/maintenance/vehicles');}
 redirect(`/fleet/equipment?vehicle=${/^[0-9a-f-]{36}$/i.test(vehicle)?vehicle:''}&${failure?`error=${failure}`:'success=1'}`);
}
