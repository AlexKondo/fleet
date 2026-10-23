import {beforeEach,describe,it,expect,vi} from 'vitest';
import {NextRequest} from 'next/server';
const m=vi.hoisted(()=>({role:'fleet_manager',enabled:true,password:false}));
vi.mock('./env',()=>({getSupabasePublicEnv:()=>({url:'http://localhost',anonKey:'test-key'})}));
vi.mock('@supabase/ssr',()=>({createServerClient:()=>({
 auth:{getUser:async()=>({data:{user:{id:'00000000-0000-4000-8000-000000000001',email:'fixture@example.invalid',app_metadata:{must_change_password:m.password}}}}),getSession:async()=>({data:{session:{user:{id:'00000000-0000-4000-8000-000000000001'}}}})},
 rpc:async(name:string)=>({error:null,data:name==='fm_account_enabled'?m.enabled:[{drivers_license_number:null,driver_authorized:false}]}),
 from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{role:m.role},error:null})})})}),
})}));
import {updateSupabaseSession} from './middleware';
beforeEach(()=>{m.role='fleet_manager';m.enabled=true;m.password=false;});
describe('explicit non-driving manager workspaces versus driving gate',()=>{
 it('lets a verified manager reach the two pages that explicitly declare nonDrivingWorkspace',async()=>{for(const role of ['fleet_manager','administrator']){m.role=role;for(const path of ['/fleet','/fleet/carpools'])expect((await updateSupabaseSession(new NextRequest(`http://localhost${path}`))).status).toBe(200);}});
 it('keeps the driving gate for the manager’s own booking and employee access',async()=>{for(const role of ['fleet_manager','employee']){m.role=role;const response=await updateSupabaseSession(new NextRequest('http://localhost/trips/new'));expect(response.status).toBe(307);expect(response.headers.get('location')).toContain('/account/license');}m.role='employee';expect((await updateSupabaseSession(new NextRequest('http://localhost/fleet'))).status).toBe(200);});
 it('does not bypass account deactivation',async()=>{m.enabled=false;const response=await updateSupabaseSession(new NextRequest('http://localhost/fleet/carpools'));expect(response.status).toBe(307);expect(response.headers.get('location')).toContain('access=unavailable');});
 it('does not bypass the required initial password change',async()=>{m.password=true;const response=await updateSupabaseSession(new NextRequest('http://localhost/fleet'));expect(response.status).toBe(307);expect(response.headers.get('location')).toContain('forcePasswordChange=1');});
});
it('allows non-driving administrative subroutes while keeping own pickup protected',async()=>{
 for(const role of ['fleet_manager','administrator','maintenance_operator']){m.role=role;for(const path of ['/fleet/maintenance','/fleet/incidents','/settings/users'])expect((await updateSupabaseSession(new NextRequest(`http://localhost${path}`))).status).toBe(200);
 expect((await updateSupabaseSession(new NextRequest('http://localhost/reservations/id/pickup'))).status).toBe(307);}
});

it('keeps return and evidence recovery reachable without a regularized CNH',async()=>{
 m.role='employee';
 for(const path of ['/reservations/id/return','/reservations/id/evidence/inspection'])expect((await updateSupabaseSession(new NextRequest(`http://localhost${path}`))).status).toBe(200);
 expect((await updateSupabaseSession(new NextRequest('http://localhost/reservations/id/pickup'))).status).toBe(307);
});
