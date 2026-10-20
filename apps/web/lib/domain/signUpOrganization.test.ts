import {beforeEach,describe,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({create:vi.fn(),insert:vi.fn(),block:vi.fn(),remove:vi.fn(),update:vi.fn()}));
vi.mock("@/lib/supabase/admin",()=>({createSupabaseAdminClient:()=>({
 auth:{admin:{createUser:mocks.create,updateUserById:mocks.block,deleteUser:mocks.remove}},
 from:()=>({insert:mocks.insert,update:mocks.update}),
})}));
import {signUpOrganization} from "./signUpOrganization";
const input={fullName:"Novo membro",email:"member@example.invalid",password:"test-password-123"};
beforeEach(()=>{
 vi.clearAllMocks();
 mocks.create.mockResolvedValue({data:{user:{id:"new-user"}},error:null});
 mocks.insert.mockResolvedValue({error:null});
 mocks.block.mockResolvedValue({error:null});
});
describe("approved self-registration role",()=>{
 it("creates a collaborator even when caller input includes forged role or organization",async()=>{
  const forged={...input,role:"administrator",organizationId:"another-organization"};
  expect(await signUpOrganization(forged)).toEqual({success:true});
  expect(mocks.insert).toHaveBeenCalledWith({id:"new-user",organization_id:"00000000-0000-0000-0000-000000000001",full_name:input.fullName,role:"employee"});
  expect(mocks.update).not.toHaveBeenCalled();
 });
 it("does not change any existing account or role for an already registered email",async()=>{
  mocks.create.mockResolvedValue({data:{user:null},error:{message:"User already registered"}});
  expect(await signUpOrganization(input)).toEqual({success:false,error:"email_already_registered"});
  expect(mocks.insert).not.toHaveBeenCalled();
  expect(mocks.update).not.toHaveBeenCalled();
  expect(mocks.remove).not.toHaveBeenCalled();
 });
 it("preserves and blocks the new identity if profile provisioning fails",async()=>{
  mocks.insert.mockResolvedValue({error:{message:"unavailable"}});
  expect(await signUpOrganization(input)).toEqual({success:false,error:"profile_creation_failed"});
  expect(mocks.block).toHaveBeenCalledWith("new-user",expect.objectContaining({app_metadata:{provisioning_failed:true}}));
  expect(mocks.remove).not.toHaveBeenCalled();
 });
});
