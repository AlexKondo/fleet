import {beforeEach,describe,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({role:"administrator",rpc:vi.fn(),admin:vi.fn()}));
vi.mock("@/lib/auth/currentUser",()=>({getCurrentUser:async()=>({id:"actor"})}));
vi.mock("@/lib/supabase/server",()=>({createSupabaseServerClient:async()=>({
 from:()=>({select:()=>({eq:()=>({single:async()=>({data:{organization_id:"org",role:mocks.role}})})})}),rpc:mocks.rpc,
})}));
vi.mock("@/lib/supabase/admin",()=>({createSupabaseAdminClient:mocks.admin}));
vi.mock("next/cache",()=>({revalidatePath:vi.fn()}));
import {removeUser,reactivateUser} from "./actions";
const id="00000000-0000-4000-8000-000000000012";
const request="00000000-0000-4000-8000-000000000013";
function form(){
 const f=new FormData();f.set("userId",id);f.set("accessVersion","3");f.set("requestId",request);f.set("reason","Mudança de equipe");return f;
}
beforeEach(()=>{vi.clearAllMocks();mocks.role="administrator";mocks.rpc.mockResolvedValue({data:{},error:null});});
describe("member access actions",()=>{
 it("keeps the removeUser API but only invokes transactional deactivation",async()=>{
  expect(await removeUser({status:"idle"},form())).toEqual({status:"success"});
  expect(mocks.rpc).toHaveBeenCalledWith("fm_member_access_command",{p_user_id:id,p_enabled:false,p_version:3,p_reason:"Mudança de equipe",p_request_id:request});
  expect(mocks.admin).not.toHaveBeenCalled();
 });
 it("reactivates without creating another identity",async()=>{
  expect(await reactivateUser({status:"idle"},form())).toEqual({status:"success"});
  expect(mocks.rpc.mock.calls[0]![1].p_enabled).toBe(true);
  expect(mocks.admin).not.toHaveBeenCalled();
 });
 it("rejects non-admin actors and invalid forms before mutation",async()=>{
  mocks.role="fleet_manager";
  expect((await removeUser({status:"idle"},form())).status).toBe("error");
  mocks.role="administrator";const bad=form();bad.delete("accessVersion");
  expect((await removeUser({status:"idle"},bad)).status).toBe("error");
  expect(mocks.rpc).not.toHaveBeenCalled();
 });
 it("shows version conflicts without falling back to deletion",async()=>{
  mocks.rpc.mockResolvedValue({error:{message:"CONCURRENT_UPDATE"}});
  expect((await removeUser({status:"idle"},form())).error).toContain("Recarregue");
  expect(mocks.admin).not.toHaveBeenCalled();
 });
});
