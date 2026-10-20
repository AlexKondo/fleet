import {beforeEach,describe,it,expect,vi} from 'vitest';
const m=vi.hoisted(()=>({signedIn:true,fail:false,rpc:vi.fn()}));
vi.mock('@/lib/auth/currentUser',()=>({getCurrentUser:async()=>m.signedIn?{id:'authenticated-subject'}:null}));
vi.mock('@/lib/supabase/server',()=>({createSupabaseServerClient:async()=>({rpc:m.rpc})}));
import {GET} from '@/app/api/exports/personal/route';
beforeEach(()=>{m.signedIn=true;m.fail=false;m.rpc.mockReset();m.rpc.mockImplementation(async()=>m.fail?{error:{message:'NOT_AUTHORIZED'},data:null}:{error:null,data:{subject_id:'authenticated-subject',schema:'fleetmind.personal-data.v1',scope:{binary_files_included:false}}});});
describe('subject-only personal export route',()=>{
 it('does not reach the export RPC without authentication',async()=>{m.signedIn=false;expect((await GET()).status).toBe(401);expect(m.rpc).not.toHaveBeenCalled();});
 it('uses no client-supplied subject or organization and sends a private attachment',async()=>{const response=await GET();expect(response.status).toBe(200);expect(m.rpc).toHaveBeenCalledWith('fm_export_my_data');expect(response.headers.get('cache-control')).toBe('private, no-store');expect(response.headers.get('x-content-type-options')).toBe('nosniff');expect(response.headers.get('content-disposition')).toContain('attachment;');expect((await response.json()).subject_id).toBe('authenticated-subject');});
 it('returns an explicit failure without a partial success document',async()=>{m.fail=true;const response=await GET();expect(response.status).toBe(503);expect(response.headers.get('content-type')).not.toContain('application/json');});
});
