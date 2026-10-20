import {createSupabaseServerClient} from '@/lib/supabase/server';
import {getCurrentUser} from '@/lib/auth/currentUser';
import {parseDocument,validateDocument,documentFilename} from '@/lib/documents/files';
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){
 const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
 const db=await createSupabaseServerClient();if(!(await getCurrentUser(db)))return new Response('Autenticação necessária',{status:401,headers});
 const {id}=await params;if(!/^[0-9a-f-]{36}$/i.test(id))return new Response('Documento indisponível',{status:404,headers});
 const meta=await db.rpc('fm_document_get',{p_id:id});const doc=meta.error?null:parseDocument(meta.data);
 if(!doc)return new Response('Documento indisponível',{status:404,headers});
 try{
  const file=await db.storage.from('fleet-documents').download(doc.storage_path);if(file.error||!file.data)throw new Error('UNAVAILABLE');
  if(file.data.size!==doc.size_bytes)throw new Error('INVALID_DOCUMENT');
  const bytes=new Uint8Array(await file.data.arrayBuffer());if(validateDocument(bytes,doc.mime_type)!==doc.sha256)throw new Error('INVALID_DOCUMENT');
  return new Response(bytes,{headers:{...headers,'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="documento${doc.mime_type==='application/pdf'?'.pdf':doc.mime_type==='image/png'?'.png':doc.mime_type==='image/webp'?'.webp':'.jpg'}"; filename*=UTF-8''${encodeURIComponent(documentFilename(doc.filename)).replace(/['()*]/g,c=>"%"+c.charCodeAt(0).toString(16).toUpperCase())}`}});
 }catch{return new Response('Não foi possível verificar a integridade do documento. Tente novamente.',{status:503,headers});}
}
