import type { TypedSupabaseClient } from '@fleet/supabase-client';
import type { PhotoAngle } from './checklist';

const mimes = ['image/jpeg','image/png','image/webp'];
async function digest(bytes: ArrayBuffer): Promise<string> {
 return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
}
/** Retry identity is bound to target, angle and exact bytes. Never remove an original.
 * The durable pending journal makes an uploaded-but-unlinked object recoverable. */
export async function uploadImmutablePhoto(client:TypedSupabaseClient,kind:'vehicle'|'inspection',target:string,angle:PhotoAngle|null,file:File):Promise<{path:string}> {
 if (!mimes.includes(file.type) || file.size<1 || file.size>10*1024*1024) throw new Error('INVALID_PHOTO');
 const bytes=await file.arrayBuffer();const header=new Uint8Array(bytes);
 const valid=file.type==='image/png' ? [137,80,78,71,13,10,26,10].every((v,i)=>header[i]===v)
 : file.type==='image/jpeg' ? header[0]===255&&header[1]===216&&header[2]===255
 : String.fromCharCode(...header.slice(0,4))==='RIFF'&&String.fromCharCode(...header.slice(8,12))==='WEBP';
 if(!valid)throw new Error('INVALID_PHOTO');
 const sha=await digest(bytes);
 const begun=await client.rpc('fm_photo_begin',{p_kind:kind,p_target:target,p_angle:angle,p_sha256:sha,p_size:file.size,p_mime:file.type});
 if(begun.error) throw new Error('PHOTO_BEGIN_FAILED');
 const row=begun.data as {id?:string;path?:string;state?:string}|null;
 if(!row?.id || !row.path) throw new Error('PHOTO_BEGIN_FAILED');
 if(row.state==='linked')return{path:row.path};
 const bucket=client.storage.from('vehicle-photos');
 const upload=await bucket.upload(row.path,file,{upsert:false,contentType:file.type});
 if(upload.error){
  // Handles conflict and ambiguous transport failure identically: verify exact stored bytes.
  const existing=await bucket.download(row.path);
  if(existing.error||!existing.data||existing.data.size!==file.size||await digest(await existing.data.arrayBuffer())!==sha)throw new Error('PHOTO_UPLOAD_FAILED');
 }
 const finalized=await client.rpc('fm_photo_finalize',{p_id:row.id,p_sha256:sha});
 if(finalized.error)throw new Error('PHOTO_LINK_PENDING');
 return{path:row.path};
}
