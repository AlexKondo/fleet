import {beforeEach,it,expect,vi} from 'vitest';
const m=vi.hoisted(()=>({rpc:vi.fn(),user:true}));
vi.mock('next/cache',()=>({revalidatePath:vi.fn()}));
vi.mock('@/lib/i18n/getLocale',()=>({getLocale:async()=> 'pt-BR'}));
vi.mock('@/lib/supabase/server',()=>({createSupabaseServerClient:async()=>({rpc:m.rpc})}));
vi.mock('@/lib/auth/currentUser',()=>({getCurrentUser:async()=>m.user?{id:'actor'}:null}));
import {closeDeniedDeparture} from './exceptionAction';
function form(){const f=new FormData();f.set('reservation_id','11111111-1111-4111-8111-111111111111');f.set('request_id','22222222-2222-4222-8222-222222222222');f.set('reason','Saída impedida; veículo permanece na unidade.');f.set('not_departed','on');return f;}
beforeEach(()=>{m.user=true;m.rpc.mockReset().mockResolvedValue({error:null,data:{ok:true}});});
it('requires physical confirmation before any RPC',async()=>{const f=form();f.delete('not_departed');expect((await closeDeniedDeparture({status:'idle'},f)).status).toBe('error');expect(m.rpc).not.toHaveBeenCalled();});
it('uses the approved outcome and stable retry identity',async()=>{const f=form();f.set('outcome','departed_unrecorded');expect((await closeDeniedDeparture({status:'idle'},f)).status).toBe('success');expect(m.rpc).toHaveBeenCalledWith('fm_operation_exception',expect.objectContaining({p_outcome:'not_departed',p_request_id:f.get('request_id')}));});
it('rejects anonymous use',async()=>{m.user=false;expect((await closeDeniedDeparture({status:'idle'},form())).status).toBe('error');expect(m.rpc).not.toHaveBeenCalled();});
it('explains failures without leaking database details',async()=>{m.rpc.mockResolvedValueOnce({error:{message:'PHYSICAL_DEPARTURE_ALREADY_RECORDED'}});expect((await closeDeniedDeparture({status:'idle'},form())).message).toContain('devolução');m.rpc.mockResolvedValueOnce({error:{message:'secret table details'}});expect((await closeDeniedDeparture({status:'idle'},form())).message).not.toContain('secret');});
