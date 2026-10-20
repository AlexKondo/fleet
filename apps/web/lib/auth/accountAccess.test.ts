import { describe,expect,it,vi } from "vitest";
import type { TypedSupabaseClient } from "@fleet/supabase-client";
import { accountEnabled } from "./accountAccess";
describe("account access fails closed",()=>{
 it("accepts active state only, including when the RPC is missing",async()=>{
  for (const [data,error,expected] of [[true,null,true],[false,null,false],[null,null,false],[{enabled:true},null,false],[null,{code:"PGRST202"},false],[null,{code:"42501"},false],[null,{code:"NETWORK"},false]] as const) {
   const db={rpc:vi.fn().mockResolvedValue({data,error})} as unknown as TypedSupabaseClient;
   expect(await accountEnabled(db)).toBe(expected);
  }
 });
 it("does not reactivate on exceptions",async()=>{
  const db={rpc:vi.fn().mockRejectedValue(new Error("offline"))} as unknown as TypedSupabaseClient;
  expect(await accountEnabled(db)).toBe(false);
 });
});
