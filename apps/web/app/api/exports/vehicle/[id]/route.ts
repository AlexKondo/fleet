import {createSupabaseServerClient} from '@/lib/supabase/server';
import {getCurrentUser} from '@/lib/auth/currentUser';
import {dossierCsv} from '@/lib/documents/export';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
 const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
 const db=await createSupabaseServerClient();if(!(await getCurrentUser(db)))return new Response('Autenticação necessária',{status:401,headers});
 const {id}=await params;if(!/^[0-9a-f-]{36}$/i.test(id))return new Response('Prontuário indisponível',{status:404,headers});
 const format=new URL(request.url).searchParams.get('format')??'csv';if(!['csv','json'].includes(format))return new Response('Formato inválido',{status:400,headers});
 const result=await db.rpc('fm_vehicle_dossier',{p_vehicle_id:id});if(result.error||!result.data)return new Response('Prontuário indisponível no seu escopo',{status:404,headers});
 try{return new Response(format==='csv'?dossierCsv(result.data):JSON.stringify(result.data,null,2),{headers:{...headers,'Content-Type':format==='csv'?'text/csv; charset=utf-8':'application/json; charset=utf-8','Content-Disposition':`attachment; filename="prontuario-${id}.${format}"`}});}catch{return new Response('Não foi possível gerar o prontuário completo',{status:503,headers});}
}
