import {describe,expect,it,vi} from "vitest";
import type {TypedSupabaseClient} from "@fleet/supabase-client";
import {gateAction,parseChecklistState,loadChecklistState,loadGateChecklistStates} from "./checklistState";
const initial={inspection_role:"security",pickup_traveler:false,pickup_security:false,return_traveler:false,return_security:false,departed:false,arrived:false,own_pickup:false,own_return:false,legacy_pickup:false,can_pickup:true,can_return:false,own_pickup_id:null,own_return_id:null};
describe("authoritative checklist state",()=>{
 it("rejects missing/invalid state instead of inventing an available action",()=>{
  expect(parseChecklistState({})).toBeNull();expect(parseChecklistState({...initial,can_pickup:1})).toBeNull();
  expect(gateAction(null)).toBe("waiting");
 });
 it("distinguishes inspection, physical movement, return and waiting",()=>{
  expect(gateAction(parseChecklistState(initial))).toBe("pickup");
  expect(gateAction(parseChecklistState({...initial,can_pickup:false,pickup_traveler:true,pickup_security:true}))).toBe("movement");
  expect(gateAction(parseChecklistState({...initial,can_pickup:false,pickup_traveler:true,pickup_security:true,departed:true,arrived:true,can_return:true}))).toBe("return");
  expect(gateAction(parseChecklistState({...initial,can_pickup:false,own_return:true}))).toBe("waiting");
 });
 it("fails closed on RPC failures or an incomplete batch",async()=>{
  const rpc=vi.fn().mockResolvedValue({data:null,error:{message:"offline"}});const db={rpc} as unknown as TypedSupabaseClient;
  expect(await loadChecklistState(db,"reservation")).toBeNull();
  rpc.mockResolvedValue({data:{},error:null});expect(await loadGateChecklistStates(db,["reservation"])).toBeNull();
  rpc.mockResolvedValue({data:{reservation:initial},error:null});expect((await loadGateChecklistStates(db,["reservation"]))?.get("reservation")?.can_pickup).toBe(true);
 });
});
