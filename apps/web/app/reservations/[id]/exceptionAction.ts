'use server';
import {revalidatePath} from 'next/cache';
import {getLocale} from '@/lib/i18n/getLocale';
import {createSupabaseServerClient} from '@/lib/supabase/server';
import {getCurrentUser} from '@/lib/auth/currentUser';
import {exceptionError,exceptionText} from '@/lib/operations/exceptionText';
export interface ExceptionResult {status:'idle'|'error'|'success';message?:string}
export async function closeDeniedDeparture(_previous:ExceptionResult,form:FormData):Promise<ExceptionResult>{
 const locale=await getLocale();const id=String(form.get('reservation_id')??'');const request=String(form.get('request_id')??'');const reason=String(form.get('reason')??'').trim();
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(request)||reason.length<3||reason.length>1000||form.get('not_departed')!=='on')return{status:'error',message:exceptionText(locale).invalid};
 const client=await createSupabaseServerClient();
 if(!await getCurrentUser(client))return{status:'error',message:exceptionText(locale).denied};
 const {error}=await client.rpc('fm_operation_exception',{p_reservation_id:id,p_outcome:'not_departed',p_reason:reason,p_request_id:request});
 if(error)return{status:'error',message:exceptionError(error.message,locale)};
 for(const path of ['/dashboard','/trips','/fleet','/gate',`/reservations/${id}`])revalidatePath(path);
 return{status:'success',message:exceptionText(locale).done};
}
