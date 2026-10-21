import {afterAll,beforeAll,describe,expect,it} from "vitest";
import {randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";
import path from "node:path";
import type {PGlite} from "@electric-sql/pglite";
import {migratedDatabase} from "../../test/migratedDatabase";
/** FIX-VENCIDAS (0207-0209) with the actual migrated SQL: R2 pickup window in fm_checklist_state,
 * R3 fm_release_expired_reservations, R4 no_show_release_grace_minutes. */
let db:PGlite;
const org=randomUUID(),otherOrg=randomUUID(),admin=randomUUID(),security=randomUUID(),custodian=randomUUID(),driver=randomUUID(),category=randomUUID();
let gateUnit:string,officeUnit:string;
type State=Record<string,unknown>;
async function actor(id:string){await db.exec("reset role");await db.query("select set_config('test.actor',$1,false)",[id]);await db.exec("set role authenticated");}
async function asPostgres(){await db.exec("reset role");await db.query("select set_config('test.actor','',false)");}
async function adminCommand(command:string,payload:Record<string,unknown>){
 await actor(admin);return (await db.query<{r:{id:string}}>("select fm_unit_admin_command($1,$2,$3) r",[command,JSON.stringify({...payload,reason:"Configuração autorizada de teste"}),randomUUID()])).rows[0]!.r;
}
async function vehicle(unit=gateUnit,status="reserved"){
 await asPostgres();const id=randomUUID();
 await db.query("insert into vehicles(id,organization_id,plate,category_id,status,odometer_km) values($1,$2,$3,$4,'available',100)",[id,org,id.slice(0,7),category]);
 await adminCommand("unit.vehicle",{vehicle_id:id,unit_id:unit,version:0});await asPostgres();
 await db.query("update vehicles set status=$2 where id=$1",[id,status]);return id;
}
/** Reservation with window [now+startMin, now+endMin] (minutes, may be negative). */
async function reservation(v:string,startMin:number,endMin:number,status="confirmed"){
 await asPostgres();const trip=randomUUID(),id=randomUUID();
 await db.query("insert into trip_requests(id,organization_id,requester_id,departure_at,expected_return_at,origin,destination,distance_km,passenger_count,requires_cargo,justification) values($1,$2,$3,now()+make_interval(mins=>$4),now()+make_interval(mins=>$5),'A','B',10,1,false,'Teste')",[trip,org,driver,startMin,endMin]);
 await db.query("insert into reservations(id,organization_id,vehicle_id,trip_request_id,status,start_at,end_at) values($1,$2,$3,$4,$5,now()+make_interval(mins=>$6),now()+make_interval(mins=>$7))",[id,org,v,trip,status,startMin,endMin]);
 return id;
}
async function moveWindow(id:string,startMin:number,endMin:number){await asPostgres();await db.query("update reservations set start_at=now()+make_interval(mins=>$2),end_at=now()+make_interval(mins=>$3) where id=$1",[id,startMin,endMin]);}
async function state(id:string,who:string,fn="fm_checklist_state"){await actor(who);return (await db.query<{s:State}>(`select ${fn}($1) s`,[id])).rows[0]!.s;}
const pickup=(id:string,role="traveler")=>db.query("select record_pickup($1,100,80,null,false,null,$3,false,false,$2) id",[id,role,role==="traveler"?"{}":null]);
async function release(args="",params:unknown[]=[]){await asPostgres();await db.exec("set role service_role");try{return (await db.query<{r:Record<string,number>}>(`select fm_release_expired_reservations(${args}) r`,params)).rows[0]!.r;}finally{await db.exec("reset role");}}
async function res(id:string){await asPostgres();return (await db.query<{status:string;cancellation_reason:string|null;cancelled_by:string|null;cancelled_at:string|null}>("select status,cancellation_reason,cancelled_by,cancelled_at from reservations where id=$1",[id])).rows[0]!;}
async function vstatus(v:string){await asPostgres();return (await db.query<{s:string}>("select status::text s from vehicles where id=$1",[v])).rows[0]!.s;}
async function count(sql:string,params:unknown[]){await asPostgres();return Number((await db.query<{n:number}>(sql,params)).rows[0]!.n);}
const audits=(id:string)=>count("select count(*)::int n from audit_log where entity_id=$1 and action='reservation.no_show_released' and actor_id is null",[id]);
const notes=(id:string)=>count("select count(*)::int n from notifications where entity_id=$1 and user_id=$2",[id,driver]);
const setGrace=async(min:number)=>{await asPostgres();await db.query("update organization_settings set no_show_release_grace_minutes=$2 where organization_id=$1",[org,min]);};
const withoutPickup=(s:State)=>{const {can_pickup:_c,...rest}=s;void _c;return rest;};

beforeAll(async()=>{
 ({db}=await migratedDatabase());
 for(const [id,name] of [[org,"Vencidas"],[otherOrg,"Outra"]]){await db.query("insert into organizations(id,name) values($1,$2)",[id,name]);await db.query("insert into organization_settings(organization_id) values($1)",[id]);}
 for(const [id,role] of [[admin,"administrator"],[security,"security"],[custodian,"employee"],[driver,"employee"]]){
  await db.query("insert into auth.users(id) values($1)",[id]);
  await db.query("insert into profiles(id,organization_id,full_name,role,drivers_license_number,driver_authorized,drivers_license_expiration) values($1,$2,'Pessoa de teste',$3,'TEST-CNH',true,current_date+30)",[id,org,role]);
 }
 await db.query("insert into vehicle_categories(id,organization_id,name,passenger_capacity,supports_cargo,energy_type) values($1,$2,'Modelo',5,false,'ICE')",[category,org]);
 await actor(admin);await db.query("select fm_equipment_profile_save('category',$1,'{}','{}',true,0,'Explicit empty test model',$2)",[category,randomUUID()]);
 gateUnit=(await adminCommand("unit.save",{name:"Portaria",workflow:"gate_visual",enabled:true,version:0})).id;
 officeUnit=(await adminCommand("unit.save",{name:"Escritório",workflow:"key_custody",enabled:true,version:0})).id;
 await adminCommand("unit.custodian",{unit_id:officeUnit,user_id:custodian,enabled:true,version:0});
 // The pre-0208 definition (rollback file) under another name, to prove nothing else changed.
 await asPostgres();
 const prev=readFileSync(path.resolve("../../supabase/migrations/rollback/0208_rollback.sql"),"utf8").replace("FUNCTION public.fm_checklist_state(","FUNCTION public.fm_checklist_state_prev(");
 await db.exec(prev);await db.exec("grant execute on function public.fm_checklist_state_prev(uuid) to authenticated");
},90000);
afterAll(async()=>db?.close());

describe.sequential("FIX-VENCIDAS SQL (0207-0209)",()=>{
 it("R4: no_show_release_grace_minutes defaults to 60 and is bounded to 0..1440",async()=>{
  await asPostgres();
  expect((await db.query<{g:number}>("select no_show_release_grace_minutes g from organization_settings where organization_id=$1",[org])).rows[0]!.g).toBe(60);
  await expect(db.query("update organization_settings set no_show_release_grace_minutes=-1 where organization_id=$1",[org])).rejects.toThrow(/check/i);
  await expect(db.query("update organization_settings set no_show_release_grace_minutes=1441 where organization_id=$1",[org])).rejects.toThrow(/check/i);
  await expect(db.query("update organization_settings set no_show_release_grace_minutes=null where organization_id=$1",[org])).rejects.toThrow();
  await setGrace(1440);await setGrace(0);await setGrace(60);
 });

 it("R2 gate: can_pickup is false once now() >= end_at; every other flag equals the previous definition",async()=>{
  const v=await vehicle();const id=await reservation(v,-1,120);
  for(const who of [driver,security,admin]){
   expect(await state(id,who)).toEqual(await state(id,who,"fm_checklist_state_prev"));
  }
  expect((await state(id,driver)).can_pickup).toBe(true);
  expect((await state(id,security)).can_pickup).toBe(true);
  await moveWindow(id,-300,-1);
  for(const who of [driver,security,admin]){
   const now=await state(id,who),prev=await state(id,who,"fm_checklist_state_prev");
   expect(now.can_pickup).toBe(false);expect(withoutPickup(now)).toEqual(withoutPickup(prev));
  }
  expect((await state(id,driver,"fm_checklist_state_prev")).can_pickup).toBe(true); // the defect, before 0208
  await actor(driver);await expect(pickup(id)).rejects.toThrow(/PICKUP_WINDOW_ENDED/); // backend already refused it
 });

 it("R2 gate: a traveler who already did the pickup checklist keeps the return path; return flags are untouched",async()=>{
  const v=await vehicle();const id=await reservation(v,-1,120);
  await actor(driver);await pickup(id);
  await moveWindow(id,-300,-1);
  const now=await state(id,security),prev=await state(id,security,"fm_checklist_state_prev");
  expect(now.can_pickup).toBe(false);expect(now.can_return).toBe(prev.can_return);expect(now.pickup_traveler).toBe(true);
 });

 it("R2 key_custody: can_pickup closes with the window even after keys were delivered",async()=>{
  const v=await vehicle(officeUnit);const id=await reservation(v,-1,120);
  await actor(custodian);await db.query("select fm_key_command($1,'delivered',null,$2)",[id,randomUUID()]);
  const before=await state(id,driver);
  expect(before.workflow).toBe("key_custody");expect(before.can_pickup).toBe(true);
  expect(before).toEqual(await state(id,driver,"fm_checklist_state_prev"));
  await moveWindow(id,-300,-1);
  const after=await state(id,driver),prev=await state(id,driver,"fm_checklist_state_prev");
  expect(after.can_pickup).toBe(false);expect(after.keys_delivered).toBe(true);expect(withoutPickup(after)).toEqual(withoutPickup(prev));
 });

 it("R3: authenticated and anon cannot execute the release function; service_role can",async()=>{
  await actor(admin);await expect(db.query("select fm_release_expired_reservations()")).rejects.toThrow(/permission denied/);
  await asPostgres();await db.exec("set role anon");await expect(db.query("select fm_release_expired_reservations()")).rejects.toThrow(/permission denied/);
  await db.exec("reset role");
  await asPostgres();
  const acl=(await db.query<{a:string}>("select proacl::text a from pg_proc where proname='fm_release_expired_reservations'")).rows[0]!.a;
  expect(acl).toContain("service_role=X");expect(acl).not.toMatch(/(^|[{,])=X/);expect(acl).not.toContain("authenticated");expect(acl).not.toContain("anon");
  expect(typeof (await release()).released).toBe("number");
 });

 it("R3: releases an expired no-show (vehicle back to available, notification, audit) and skips one with activity; idempotent",async()=>{
  await release(); // settle anything left by earlier tests
  const v1=await vehicle();const noShow=await reservation(v1,-600,-120);
  const v2=await vehicle();const withPickup=await reservation(v2,-1,120);
  await actor(driver);await pickup(withPickup);await moveWindow(withPickup,-600,-120);
  const v3=await vehicle(officeUnit);const withKeys=await reservation(v3,-1,120);
  await actor(custodian);await db.query("select fm_key_command($1,'delivered',null,$2)",[withKeys,randomUUID()]);await moveWindow(withKeys,-600,-120);
  const v4=await vehicle(gateUnit,"available");const pending=await reservation(v4,-600,-120,"pending_approval");

  const r=await release();
  expect(r).toMatchObject({released:2,vehicles_released:1,skipped_locked:0});
  expect(r.skipped_with_activity).toBeGreaterThanOrEqual(2);
  expect(await res(noShow)).toMatchObject({status:"cancelled",cancellation_reason:"no_show_auto",cancelled_by:null});
  expect((await res(noShow)).cancelled_at).not.toBeNull();
  expect(await vstatus(v1)).toBe("available");
  expect(await res(pending)).toMatchObject({status:"cancelled",cancellation_reason:"expired_unapproved"});
  expect(await vstatus(v4)).toBe("available");
  expect(await res(withPickup)).toMatchObject({status:"confirmed"});
  expect(await res(withKeys)).toMatchObject({status:"confirmed"});
  expect(await vstatus(v2)).not.toBe("available");
  expect(await audits(noShow)).toBe(1);expect(await audits(pending)).toBe(1);
  expect(await notes(noShow)).toBe(1);expect(await notes(pending)).toBe(1);
  await asPostgres();
  const audit=(await db.query<{before:State;after:State}>("select before,after from audit_log where entity_id=$1 and action='reservation.no_show_released'",[noShow])).rows[0]!;
  expect(audit.before).toMatchObject({status:"confirmed",vehicle_id:v1,vehicle_status:"reserved"});
  expect(audit.after).toMatchObject({status:"cancelled",reason:"no_show_auto",grace_minutes:60,vehicle_status:"available"});
  // idempotent
  const again=await release();
  expect(again).toMatchObject({released:0,vehicles_released:0});
  expect(await audits(noShow)).toBe(1);expect(await notes(noShow)).toBe(1);
 });

 it("R3: another confirmed reservation of the same vehicle keeps it reserved; the last released one frees it",async()=>{
  await release();
  const v=await vehicle();const old=await reservation(v,-900,-800);const future=await reservation(v,600,700);
  expect(await release()).toMatchObject({released:1,vehicles_released:0});
  expect(await res(old)).toMatchObject({status:"cancelled"});expect(await vstatus(v)).toBe("reserved");
  expect(await res(future)).toMatchObject({status:"confirmed"});
  const w=await vehicle();const a=await reservation(w,-900,-800);const b=await reservation(w,-700,-600);
  expect(await release()).toMatchObject({released:2,vehicles_released:1});
  expect(await res(a)).toMatchObject({status:"cancelled"});expect(await res(b)).toMatchObject({status:"cancelled"});expect(await vstatus(w)).toBe("available");
 });

 it("R3: vehicles in in_use / returning / blocked / maintenance are never touched",async()=>{
  await release();
  for(const s of ["in_use","returning","blocked","maintenance"]){
   const v=await vehicle(gateUnit,"available");const id=await reservation(v,-900,-800);await asPostgres();await db.query("update vehicles set status=$2 where id=$1",[v,s]);
   expect(await release()).toMatchObject({released:1,vehicles_released:0});
   expect(await res(id)).toMatchObject({status:"cancelled",cancellation_reason:"no_show_auto"});expect(await vstatus(v)).toBe(s);
  }
 });

 it("R4: grace boundary — released only after end_at + grace; grace is per organization",async()=>{
  await release();
  const v=await vehicle();const id=await reservation(v,-300,-55); // ended 55 min ago, grace 60
  expect(await release()).toMatchObject({released:0});expect(await res(id)).toMatchObject({status:"confirmed"});
  await moveWindow(id,-300,-65);
  expect(await release()).toMatchObject({released:1});expect(await res(id)).toMatchObject({status:"cancelled"});
  await setGrace(0);await release(); // settle rows of earlier tests that just ended
  const v2=await vehicle();const id2=await reservation(v2,-300,-1);
  const notYet=await vehicle();const live=await reservation(notYet,-300,30);
  expect(await release()).toMatchObject({released:1});expect(await res(id2)).toMatchObject({status:"cancelled"});
  expect(await res(live)).toMatchObject({status:"confirmed"}); // window still open: never touched
  await setGrace(60);
 });

 it("R3: organization filter and batch limit",async()=>{
  await release();
  const a=await reservation(await vehicle(),-900,-800);const b=await reservation(await vehicle(),-900,-800);
  expect(await release("$1::uuid",[otherOrg])).toMatchObject({released:0});
  expect((await res(a)).status).toBe("confirmed");
  expect(await release("$1::uuid,1",[org])).toMatchObject({released:1});
  expect(await release("$1::uuid",[org])).toMatchObject({released:1});
  expect((await res(a)).status).toBe("cancelled");expect((await res(b)).status).toBe("cancelled");
 });
});
