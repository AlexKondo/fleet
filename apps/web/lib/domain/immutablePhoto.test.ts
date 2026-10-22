import {it,expect,vi} from 'vitest';
import type {TypedSupabaseClient} from '@fleet/supabase-client';
vi.mock('@/lib/auth/currentUser',()=>({getCurrentUser:async()=>({id:'owner'})}));
vi.mock('@/lib/supabase/admin',()=>({createSupabaseAdminClient:()=>({rpc:async()=>({error:null})})}));
import {uploadImmutablePhoto} from './immutablePhoto';
const file=new File([new Uint8Array([137,80,78,71,13,10,26,10,1])],'proof.png',{type:'image/png'});
function fixture(options:{linked?:boolean;uploadError?:boolean;wrongBytes?:boolean;finalizeError?:boolean}={}){
 const upload=vi.fn(async()=>({error:options.uploadError?{message:'transport or conflict'}:null}));
 const download=vi.fn(async()=>({error:null,data:options.wrongBytes?new Blob(['wrong']):file}));
 const rpc=vi.fn(async(name:string)=>name==='fm_photo_begin'?{error:null,data:{id:'journal',path:'org/inspection/content.png',state:options.linked?'linked':'pending'}}:{error:options.finalizeError?{message:'timeout'}:null,data:null});
 return{client:{rpc,storage:{from:()=>({upload,download})}} as unknown as TypedSupabaseClient,upload,download,rpc};
}
it('uploads without overwrite and finalizes the durable journal',async()=>{const f=fixture();await uploadImmutablePhoto(f.client,'inspection','target','damage',file);expect(f.upload).toHaveBeenCalledWith(expect.any(String),file,{upsert:false,contentType:'image/png'});expect(f.rpc.mock.calls.map(c=>c[0])).toEqual(['fm_photo_begin','fm_photo_finalize']);});
it('verifies exact existing bytes on ambiguous upload failure before linking',async()=>{const f=fixture({uploadError:true});await uploadImmutablePhoto(f.client,'inspection','target','damage',file);expect(f.download).toHaveBeenCalledOnce();expect(f.rpc).toHaveBeenCalledTimes(2);});
it('never links different bytes after a conflict',async()=>{const f=fixture({uploadError:true,wrongBytes:true});await expect(uploadImmutablePhoto(f.client,'inspection','target','damage',file)).rejects.toThrow('PHOTO_UPLOAD_FAILED');expect(f.rpc).toHaveBeenCalledOnce();});
it('reports a pending link and retries without overwrite',async()=>{const f=fixture({finalizeError:true});await expect(uploadImmutablePhoto(f.client,'vehicle','target',null,file)).rejects.toThrow('PHOTO_LINK_PENDING');expect(f.upload).toHaveBeenCalledOnce();});
it('a finalized retry does not re-upload or relink',async()=>{const f=fixture({linked:true});await uploadImmutablePhoto(f.client,'inspection','target','damage',file);expect(f.upload).not.toHaveBeenCalled();expect(f.rpc).toHaveBeenCalledOnce();});
it('rejects unapproved MIME and oversized files before journal creation',async()=>{const f=fixture();await expect(uploadImmutablePhoto(f.client,'vehicle','target',null,new File(['x'],'x.svg',{type:'image/svg+xml'}))).rejects.toThrow('INVALID_PHOTO');expect(f.rpc).not.toHaveBeenCalled();});

it('rejects claimed image MIME with mismatched bytes',async()=>{const f=fixture();await expect(uploadImmutablePhoto(f.client,'vehicle','target',null,new File(['<script>'],'x.png',{type:'image/png'}))).rejects.toThrow('INVALID_PHOTO');expect(f.rpc).not.toHaveBeenCalled();});

it('does not finalize corrupted stored bytes even when upload reports success',async()=>{const f=fixture({wrongBytes:true});await expect(uploadImmutablePhoto(f.client,'inspection','target','damage',file)).rejects.toThrow('PHOTO_UPLOAD_FAILED');expect(f.rpc).toHaveBeenCalledOnce();});
