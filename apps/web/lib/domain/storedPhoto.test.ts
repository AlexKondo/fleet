import {beforeEach,expect,it,vi} from 'vitest';
import type {TypedSupabaseClient} from '@fleet/supabase-client';
const m=vi.hoisted(()=>({actor:'actor' as string|null,attest:vi.fn()}));
vi.mock('@/lib/auth/currentUser',()=>({getCurrentUser:async()=>m.actor?{id:m.actor}:null}));
vi.mock('@/lib/supabase/admin',()=>({createSupabaseAdminClient:()=>({rpc:m.attest})}));
import {finishStoredPhoto} from './storedPhoto';
const file=new Blob([new Uint8Array([137,80,78,71,13,10,26,10,1])],{type:'image/png'});
async function fixture(wrong=false){const sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer())),x=>x.toString(16).padStart(2,'0')).join('');const rpc=vi.fn(async(name:string)=>name==='fm_photo_info'?{data:{id:'journal',path:'private/path',sha256:sha,size:file.size,mime:'image/png'},error:null}:{data:null,error:null});const download=vi.fn(async()=>({data:wrong?new Blob([new Uint8Array(9)]):file,error:null}));return {db:{rpc,storage:{from:()=>({download})}} as unknown as TypedSupabaseClient,rpc,download};}
beforeEach(()=>{m.actor='actor';m.attest.mockReset().mockResolvedValue({error:null})});
it('hashes actual stored bytes and binds attestation to the downloaded path',async()=>{const f=await fixture();expect(await finishStoredPhoto(f.db,'journal')).toEqual({path:'private/path'});expect(m.attest).toHaveBeenCalledWith('fm_photo_attest',expect.objectContaining({p_actor:'actor',p_size:9,p_mime:'image/png',p_path:'private/path'}));expect(f.rpc).toHaveBeenLastCalledWith('fm_photo_finalize',expect.objectContaining({p_id:'journal'}));});
it('rejects equal-size adulteration without attesting',async()=>{const f=await fixture(true);await expect(finishStoredPhoto(f.db,'journal')).rejects.toThrow('PHOTO_INTEGRITY_MISMATCH');expect(m.attest).not.toHaveBeenCalled();expect(f.rpc).toHaveBeenCalledTimes(1)});
it('rejects missing authentication',async()=>{m.actor=null;const f=await fixture();await expect(finishStoredPhoto(f.db,'journal')).rejects.toThrow('NOT_AUTHORIZED');expect(f.rpc).not.toHaveBeenCalled()});
it('retains pending state on attestation error',async()=>{m.attest.mockResolvedValue({error:{message:'metadata'}});const f=await fixture();await expect(finishStoredPhoto(f.db,'journal')).rejects.toThrow('PHOTO_LINK_PENDING');expect(f.rpc).toHaveBeenCalledTimes(1)});
it('recovers a transient download before attesting',async()=>{const f=await fixture();f.download.mockResolvedValueOnce({data:null as unknown as Blob,error:null});await finishStoredPhoto(f.db,'journal');expect(f.download).toHaveBeenCalledTimes(2);expect(m.attest).toHaveBeenCalledOnce()});

it('rejects oversized stored content before allocating its byte buffer',async()=>{
 const f=await fixture();const arrayBuffer=vi.fn();
 f.download.mockResolvedValue({data:{size:11*1024*1024,arrayBuffer} as unknown as Blob,error:null});
 await expect(finishStoredPhoto(f.db,'journal')).rejects.toThrow('PHOTO_INTEGRITY_MISMATCH');
 expect(arrayBuffer).not.toHaveBeenCalled();expect(m.attest).not.toHaveBeenCalled();
});
