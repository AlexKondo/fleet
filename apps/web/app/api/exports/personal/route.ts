import {createSupabaseServerClient} from '@/lib/supabase/server';
import {getCurrentUser} from '@/lib/auth/currentUser';
export const dynamic='force-dynamic';
export async function GET(){
 const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
 const db=await createSupabaseServerClient();if(!(await getCurrentUser(db)))return new Response('Autenticação necessária',{status:401,headers});
 const result=await db.rpc('fm_export_my_data');
 if(result.error||!result.data)return new Response('Não foi possível gerar sua exportação completa. Tente novamente.',{status:503,headers});
 return new Response(JSON.stringify(result.data,null,2),{headers:{...headers,'Content-Type':'application/json; charset=utf-8','Content-Disposition':'attachment; filename="fleetmind-meus-dados.json"'}});
}
