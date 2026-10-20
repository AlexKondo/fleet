import {describe,expect,it} from "vitest";
import {renderToStaticMarkup} from "react-dom/server";
import {createElement} from "react";
import {parseKeyWorkspace,parseUnitAdminState,keyErrorCode,keyErrorText} from "./keyCustody";
import {parseChecklistState,gateAction} from "./checklistState";
import {OfficeCustodyNotice} from "@/app/reservations/[id]/OfficeCustodyNotice";
const id="fa18b620-158e-4507-964c-e05690ec93bc";
const reservation={id,unit_id:id,unit:"SP",plate:"ABC1D23",requester:"Condutor",self:false,start_at:"2026-10-16T12:00:00Z",end_at:"2026-10-16T18:00:00Z",status:"confirmed",delivered:false,received:false};
const checklist={inspection_role:"traveler",pickup_traveler:false,pickup_security:false,return_traveler:false,return_security:false,departed:false,arrived:false,own_pickup:false,own_return:false,legacy_pickup:false,can_pickup:false,can_return:false,own_pickup_id:null,own_return_id:null,workflow:"key_custody",keys_delivered:false,keys_received:false};
describe("custody reads and driver instructions",()=>{
 it("rejects malformed workspace responses rather than inventing permission or confirmation",()=>{
  expect(parseKeyWorkspace(null)).toBeNull();expect(parseKeyWorkspace({units:[],reservations:[{...reservation,delivered:"yes"}]})).toBeNull();
  expect(parseKeyWorkspace({units:[],reservations:[{...reservation,start_at:"invalid"}]})).toBeNull();
  expect(parseKeyWorkspace({units:[{id,name:"SP"}],reservations:[reservation],events:[]})?.reservations[0]?.delivered).toBe(false);
  expect(parseUnitAdminState({units:[],assignments:[],vehicles:[],people:[]})).not.toBeNull();
  expect(parseUnitAdminState({units:[{id,name:"SP",enabled:true,workflow:"automatic",version:1}],assignments:[],vehicles:[],people:[]})).toBeNull();
 });
 it("never routes an office reservation into a Security movement action",()=>{
  expect(parseChecklistState({...checklist,keys_received:undefined})).toBeNull();
  expect(gateAction(parseChecklistState({...checklist,can_return:true,pickup_security:true,departed:true}))).toBe("waiting");
 });
 it("explains office pickup and the outstanding key receipt without inventing a visual inspection",()=>{
  const before=renderToStaticMarkup(createElement(OfficeCustodyNotice,{state:parseChecklistState(checklist)}));
  expect(before).toContain("responsável local designado");
  const after=renderToStaticMarkup(createElement(OfficeCustodyNotice,{state:parseChecklistState({...checklist,keys_delivered:true,pickup_traveler:true,return_traveler:true})}));
  expect(after).toContain("Falta a confirmação");expect(after).not.toContain("Segurança");
 });
 it("does not expose raw database errors in the user message",()=>{
  expect(keyErrorCode("secret connection details")).toBe("UNAVAILABLE");expect(keyErrorText("secret connection details")).not.toContain("secret");
  expect(keyErrorText("INDEPENDENT_CUSTODIAN_REQUIRED")).toContain("Outra pessoa");
 });
});
