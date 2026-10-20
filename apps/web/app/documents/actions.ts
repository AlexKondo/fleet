"use server";
import {redirect} from 'next/navigation';
import {revalidatePath} from 'next/cache';
import {loadKeySession} from '@/lib/operations/keyCustodyLoad';
import {documentTarget,documentFilename,validateDocument,parseDocument,MAX_DOCUMENT_BYTES} from '@/lib/documents/files';
function issue(e:unknown){const message=e instanceof Error?e.message:'';return ['INVALID_DOCUMENT','INVALID_INPUT','NOT_AUTHORIZED','CONCURRENT_UPDATE','IDEMPOTENCY_CONFLICT','DOCUMENT_UPLOAD_INCOMPLETE','INVALID_STATE_TRANSITION'].includes(message)?message:'UNAVAILABLE';}
function destination(target:string,id:string,error?:string){return `/documents?target=${target}&id=${id}&${error?`error=${error}`:'success=1'}`;}
export async function uploadOperationalDocument(form:FormData){
 const {db}=await loadKeySession();const {target,id}=documentTarget(form);let failure:string|undefined;
 try{
  const file=form.get('file');if(!(file instanceof File)||file.size<1||file.size>MAX_DOCUMENT_BYTES)throw new Error('INVALID_DOCUMENT');
  const bytes=new Uint8Array(await file.arrayBuffer());const sha=validateDocument(bytes,file.type);
  const begin=await db.rpc('fm_document_begin',{p_kind:target,p_target_id:id,p_category:String(form.get('category')),p_filename:documentFilename(file.name),p_mime:file.type,p_size:file.size,p_sha256:sha,p_request_id:String(form.get('request_id'))});
  if(begin.error)throw new Error(begin.error.message);const doc=parseDocument(begin.data);if(!doc)throw new Error('UNAVAILABLE');
  if(doc.state==='invalidated')throw new Error('INVALID_STATE_TRANSITION');
  if(doc.state==='pending'){
   const upload=await db.storage.from('fleet-documents').upload(doc.storage_path,bytes,{contentType:file.type,upsert:false});
   if(upload.error){
    // A retry may find the immutable object from a successful first transfer.
    const existing=await db.storage.from('fleet-documents').download(doc.storage_path);
    if(existing.error||!existing.data||validateDocument(new Uint8Array(await existing.data.arrayBuffer()),doc.mime_type)!==doc.sha256)throw new Error('DOCUMENT_UPLOAD_INCOMPLETE');
   }
   const finish=await db.rpc('fm_document_finalize',{p_id:doc.id});if(finish.error)throw new Error(finish.error.message);
  }
 }catch(e){failure=issue(e);}
 if(!failure)revalidatePath('/documents');redirect(destination(target,id,failure));
}
export async function invalidateOperationalDocument(form:FormData){
 const {db}=await loadKeySession();const {target,id}=documentTarget(form);let failure:string|undefined;
 try{
  const version=Number(form.get('version'));if(!Number.isSafeInteger(version)||version<1)throw new Error('INVALID_INPUT');
  const result=await db.rpc('fm_document_invalidate',{p_id:String(form.get('document_id')),p_version:version,p_reason:String(form.get('reason')??'').trim(),p_request_id:String(form.get('request_id'))});if(result.error)throw new Error(result.error.message);
 }catch(e){failure=issue(e);}
 if(!failure)revalidatePath('/documents');redirect(destination(target,id,failure));
}
