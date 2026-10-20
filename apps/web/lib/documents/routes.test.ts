import {describe,it,expect,vi,beforeEach} from 'vitest';
import {createHash} from 'node:crypto';
const m=vi.hoisted(()=>({enabled:true,denied:false,corrupt:false}));
const id='00000000-0000-4000-8000-000000000001',bytes=Buffer.from('%PDF-1.7\ntest');
vi.mock('@/lib/auth/currentUser',()=>({getCurrentUser:async()=>m.enabled?{id}:null}));
vi.mock('@/lib/supabase/server',()=>({createSupabaseServerClient:async()=>({
 rpc:async(name:string)=>m.denied?{data:null,error:{message:'NOT_AUTHORIZED'}}:{error:null,data:name==='fm_document_get'?{id,organization_id:id,target_kind:'vehicle',target_id:id,request_id:id,category:'other',filename:'Nota á.pdf',mime_type:'application/pdf',size_bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),storage_path:`${id}/${id}.pdf`,state:'ready',version:2}:{vehicle:{id,plate:'TEST123'},orders:[],lines:[],documents:[],approvals:[],energy:[],generated_at:'2026-10-19'}},
 storage:{from:()=>({download:async()=>({error:null,data:new Blob([m.corrupt?Buffer.from('%PDF-1.7\nEVIL'):bytes])})})},
})}));
import {GET as download} from '@/app/documents/[id]/route';
import {GET as exportVehicle} from '@/app/api/exports/vehicle/[id]/route';
beforeEach(()=>{m.enabled=true;m.denied=false;m.corrupt=false;});
const params=()=>({params:Promise.resolve({id})});
describe('authenticated document and vehicle exports',()=>{
 it('requires an active authenticated session and conceals unauthorized IDs',async()=>{
  m.enabled=false;expect((await download(new Request('https://test.invalid'),params())).status).toBe(401);
  expect((await exportVehicle(new Request('https://test.invalid'),params())).status).toBe(401);
  m.enabled=true;m.denied=true;expect((await download(new Request('https://test.invalid'),params())).status).toBe(404);expect((await exportVehicle(new Request('https://test.invalid'),params())).status).toBe(404);
 });
 it('verifies bytes against the recorded hash and serves forced attachments without caching',async()=>{
  const res=await download(new Request('https://test.invalid'),params());expect(res.status).toBe(200);expect(res.headers.get('content-disposition')).toContain('attachment;');expect(res.headers.get('cache-control')).toBe('private, no-store');expect(res.headers.get('x-content-type-options')).toBe('nosniff');expect(Buffer.from(await res.arrayBuffer())).toEqual(bytes);
  m.corrupt=true;expect((await download(new Request('https://test.invalid'),params())).status).toBe(503);
 });
 it('returns the authorized CSV or JSON and rejects unrecognized formats',async()=>{
  const csv=await exportVehicle(new Request('https://test.invalid/?format=csv'),params());expect(csv.status).toBe(200);expect(csv.headers.get('content-type')).toContain('text/csv');expect(await csv.text()).toContain('TEST123');
  const json=await exportVehicle(new Request('https://test.invalid/?format=json'),params());expect((await json.json()).vehicle.id).toBe(id);
  expect((await exportVehicle(new Request('https://test.invalid/?format=html'),params())).status).toBe(400);
 });
});
