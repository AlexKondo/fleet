import 'server-only';
import {createSupabaseAdminClient} from '@/lib/supabase/admin';
import {getCurrentUser} from '@/lib/auth/currentUser';
import type {TypedSupabaseClient} from '@fleet/supabase-client';
interface StoredPhoto{id:string;path:string;sha256:string;size:number;mime:string;kind:string;state:string}
/** Storage bytes are downloaded and hashed on the server. Client hashes are never attestations. */
export async function finishStoredPhoto(db:TypedSupabaseClient,id:string){
 const actor=await getCurrentUser(db);if(!actor)throw new Error('NOT_AUTHORIZED');
 const {data,error}=await db.rpc('fm_photo_info',{p_id:id});if(error||!data)throw new Error('NOT_AUTHORIZED');
 const j=data as unknown as StoredPhoto;
 if(j.state==='linked'&&j.kind==='inspection')return {path:j.path};
 const bucket=db.storage.from('vehicle-photos');let object=await bucket.download(j.path);
 for(const wait of [80,200,500,1000]){if(!object.error&&object.data)break;await new Promise(resolve=>setTimeout(resolve,wait));object=await bucket.download(j.path);}
 if(object.error||!object.data)throw new Error('PHOTO_LINK_PENDING');
 if(object.data.size!==j.size||object.data.size>10*1024*1024)throw new Error('PHOTO_INTEGRITY_MISMATCH');
 const bytes=await object.data.arrayBuffer();const h=new Uint8Array(bytes);
 const sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
 const valid=j.mime==='image/png'?[137,80,78,71,13,10,26,10].every((n,i)=>h[i]===n):j.mime==='image/jpeg'?h[0]===255&&h[1]===216&&h[2]===255:j.mime==='image/webp'&&String.fromCharCode(...h.slice(0,4))==='RIFF'&&String.fromCharCode(...h.slice(8,12))==='WEBP';
 if(!valid||bytes.byteLength!==j.size||sha!==j.sha256)throw new Error('PHOTO_INTEGRITY_MISMATCH');
 const proof=await createSupabaseAdminClient().rpc('fm_photo_attest',{p_id:j.id,p_actor:actor.id,p_sha256:sha,p_size:j.size,p_mime:j.mime,p_path:j.path});if(proof.error)throw new Error('PHOTO_LINK_PENDING');
 const linked=await db.rpc('fm_photo_finalize',{p_id:j.id,p_sha256:sha});if(linked.error)throw new Error('PHOTO_LINK_PENDING');
 return {path:j.path};
}
