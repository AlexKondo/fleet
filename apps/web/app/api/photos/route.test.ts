import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {NextRequest} from 'next/server';
const m=vi.hoisted(()=>({actor:true,rpc:vi.fn(),finish:vi.fn()}));
vi.mock('@/lib/supabase/server',()=>({createSupabaseServerClient:async()=>({rpc:m.rpc})}));
vi.mock('@/lib/auth/currentUser',()=>({getCurrentUser:async()=>m.actor?{id:'caller'}:null}));
vi.mock('@/lib/domain/storedPhoto',()=>({finishStoredPhoto:m.finish}));
vi.mock('next/cache',()=>({revalidatePath:vi.fn()}));
import {POST} from './route';
const target='11111111-1111-4111-8111-111111111111';
const request=(body:unknown,origin='http://localhost')=>new NextRequest('http://localhost/api/photos',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
beforeEach(()=>{m.actor=true;m.rpc.mockReset().mockResolvedValue({data:{id:target,path:'private/path'},error:null});m.finish.mockReset().mockResolvedValue({path:'private/path'})});
afterEach(()=>vi.clearAllMocks());
it('rejects another origin before auth/RPC',async()=>{expect((await POST(request({},'https://other.invalid'))).status).toBe(403);expect(m.rpc).not.toHaveBeenCalled()});
it('rejects anonymous requests',async()=>{m.actor=false;expect((await POST(request({phase:'finish',id:target}))).status).toBe(401);expect(m.finish).not.toHaveBeenCalled()});
it('does not accept oversized JSON or invalid inputs',async()=>{expect((await POST(request({extra:'x'.repeat(5000)}))).status).toBe(413);for(const body of [null,[],{phase:'finish',id:'-' .repeat(36)},{phase:'begin',target}])expect((await POST(request(body))).status).toBe(400);expect(m.rpc).not.toHaveBeenCalled()});
it('begins under the caller session, never the admin client',async()=>{expect((await POST(request({phase:'begin',kind:'inspection',target,angle:'damage',sha:'a'.repeat(64),size:9000000,mime:'image/png'}))).status).toBe(200);expect(m.rpc).toHaveBeenCalledWith('fm_photo_begin',expect.objectContaining({p_target:target,p_size:9000000}))});
it('completion delegates to server verification and sanitizes failures',async()=>{m.finish.mockRejectedValue(new Error('SQL/private details'));const result=await POST(request({phase:'finish',id:target}));expect(result.status).toBe(409);expect(await result.json()).toEqual({error:'photo_pending'})});

it('enforces the byte limit even without a content-length header',async()=>{
 const bytes=new TextEncoder().encode(JSON.stringify({extra:'é'.repeat(2100)}));
 const cancel=vi.fn();let chunk=0;
 const body=new ReadableStream<Uint8Array>({pull(controller){if(chunk++===0)controller.enqueue(bytes.slice(0,2048));else controller.enqueue(bytes.slice(2048));},cancel});
 const req=new NextRequest('http://localhost/api/photos',{method:'POST',headers:{origin:'http://localhost','Content-Type':'application/json'},body,duplex:'half'} as ConstructorParameters<typeof NextRequest>[1]);
 expect((await POST(req)).status).toBe(413);expect(cancel).toHaveBeenCalledOnce();expect(m.rpc).not.toHaveBeenCalled();
});
it('returns a controlled failure for an unreadable body',async()=>{
 const body=new ReadableStream<Uint8Array>({start(controller){controller.error(new Error('connection lost'));}});
 const req=new NextRequest('http://localhost/api/photos',{method:'POST',headers:{origin:'http://localhost'},body,duplex:'half'} as ConstructorParameters<typeof NextRequest>[1]);
 expect((await POST(req)).status).toBe(400);expect(m.rpc).not.toHaveBeenCalled();
});
