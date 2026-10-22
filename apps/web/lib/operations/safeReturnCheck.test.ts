import {afterAll,beforeAll,describe,expect,it} from "vitest";
import {randomUUID} from "node:crypto";
import type {PGlite} from "@electric-sql/pglite";
import {migratedDatabase} from "../../test/migratedDatabase";
/** CORRECOES F1 (0215/0216) with the actual migrated SQL: one "safe to go back to use" check (S1-02, S1-04, S1-05, S1-06)
 * and no direct INSERT into inspection_photos (S2-D01). */
let db:PGlite;
const org=randomUUID(),admin=randomUUID(),manager=randomUUID(),custodian=randomUUID(),driver=randomUUID(),tech=randomUUID(),category=randomUUID();
let gateUnit:string,officeUnit:string;
async function actor(id:string){await db.exec("reset role");await db.query("select set_config('test.actor',$1,false)",[id]);await db.exec("set role authenticated");}
async function asPostgres(){await db.exec("reset role");await db.query("select set_config('test.actor','',false)");}
async function adminCommand(command:string,payload:Record<string,unknown>){
 await actor(admin);return (await db.query<{r:{id:string}}>("select fm_unit_admin_command($1,$2,$3) r",[command,JSON.stringify({...payload,reason:"Configuração autorizada de teste"}),randomUUID()])).rows[0]!.r;
}
type Unsafe="doc"|"damage"|"equipment"|"work_order"|null;
async function vehicle(status:string,unsafe:Unsafe=null,unit=gateUnit){
 await asPostgres();const id=randomUUID();
 await db.query("insert into vehicles(id,organization_id,plate,category_id,status,odometer_km) values($1,$2,$3,$4,'available',100)",[id,org,id.slice(0,7),category]);
 await adminCommand("unit.vehicle",{vehicle_id:id,unit_id:unit,version:0});await asPostgres();
 await db.query("update vehicles set status=$2 where id=$1",[id,status]);
 await makeUnsafe(id,unsafe);return id;
}
async function makeUnsafe(id:string,unsafe:Unsafe){
 await asPostgres();
 if(unsafe==="doc") await db.query("update vehicles set documentation_valid=false where id=$1",[id]);
 if(unsafe==="damage") await db.query("update vehicles set has_blocking_damage=true where id=$1",[id]);
 if(unsafe==="equipment") await db.query("update vehicles set missing_safety_equipment='{Extintor}' where id=$1",[id]);
 if(unsafe==="work_order"){
  await db.exec("set session_replication_role=replica");
  await db.query("insert into fm_work_orders(organization_id,vehicle_id,kind,status,description,supplier,quote_total,scheduled_start,scheduled_end,created_by,budget_pending) values($1,$2,'corrective','in_progress','OS em andamento','Oficina',100,now()-interval '1 hour',now()+interval '20 hours',$3,false)",[org,id,admin]);
  await db.exec("set session_replication_role=origin");
 }
}
async function reservation(v:string,startMin:number,endMin:number,status="confirmed"){
 await asPostgres();const trip=randomUUID(),id=randomUUID();
 await db.query("insert into trip_requests(id,organization_id,requester_id,departure_at,expected_return_at,origin,destination,distance_km,passenger_count,requires_cargo,justification) values($1,$2,$3,now()+make_interval(mins=>$4),now()+make_interval(mins=>$5),'A','B',10,1,false,'Teste')",[trip,org,driver,startMin,endMin]);
 await db.query("insert into reservations(id,organization_id,vehicle_id,trip_request_id,status,start_at,end_at) values($1,$2,$3,$4,$5,now()+make_interval(mins=>$6),now()+make_interval(mins=>$7))",[id,org,v,trip,status,startMin,endMin]);
 return id;
}
async function vstatus(v:string){await asPostgres();return (await db.query<{s:string;d:boolean}>("select status::text s,has_blocking_damage d from vehicles where id=$1",[v])).rows[0]!;}
async function release(){await asPostgres();await db.exec("set role service_role");try{return (await db.query<{r:Record<string,number>}>("select fm_release_expired_reservations($1) r",[org])).rows[0]!.r;}finally{await db.exec("reset role");}}
async function task(v:string,type:string,source:string|null=null){await asPostgres();return (await db.query<{id:string}>("insert into workflow_tasks(organization_id,vehicle_id,type,notes,source_inspection_id) values($1,$2,$3,'Tarefa de teste',$4) returning id",[org,v,type,source])).rows[0]!.id;}
/** A damage reported on an open (confirmed) trip of the vehicle by `reporter`. */
async function damageReport(v:string,reporter:string){
 const r=await reservation(v,2*1440,2*1440+120);await asPostgres();await db.exec("set session_replication_role=replica");
 const i=(await db.query<{id:string}>("insert into inspections(organization_id,reservation_id,vehicle_id,type,performed_by,performed_by_role,has_new_damage,damage_notes) values($1,$2,$3,'pickup',$4,'traveler',true,'Avaria de teste') returning id",[org,r,v,reporter])).rows[0]!.id;
 await db.exec("set session_replication_role=origin");await db.query("update vehicles set has_blocking_damage=true where id=$1",[v]);return i;
}
const keys=(id:string,kind:string)=>db.query("select fm_key_command($1,$2,null,$3) r",[id,kind,randomUUID()]);
const pickup=(id:string)=>db.query<{id:string}>("select record_pickup($1,100,80,null,false,null,'{}',false,false,'traveler') id",[id]);

beforeAll(async()=>{
 ({db}=await migratedDatabase());
 await db.query("insert into organizations(id,name) values($1,'Correções F1')",[org]);
 await db.query("insert into organization_settings(organization_id,auto_release_enabled,no_show_release_grace_minutes) values($1,true,60)",[org]);
 for(const [id,role] of [[admin,"administrator"],[manager,"fleet_manager"],[custodian,"employee"],[driver,"employee"],[tech,"maintenance_operator"]]){
  await db.query("insert into auth.users(id) values($1)",[id]);
  await db.query("insert into profiles(id,organization_id,full_name,role,drivers_license_number,driver_authorized,drivers_license_expiration) values($1,$2,'Pessoa de teste',$3,'TEST-CNH',true,current_date+30)",[id,org,role]);
 }
 await db.query("insert into vehicle_categories(id,organization_id,name,passenger_capacity,supports_cargo,energy_type) values($1,$2,'Modelo',5,false,'ICE')",[category,org]);
 await actor(admin);await db.query("select fm_equipment_profile_save('category',$1,'{}','{}',true,0,'Explicit empty test model',$2)",[category,randomUUID()]);
 gateUnit=(await adminCommand("unit.save",{name:"Portaria",workflow:"gate_visual",enabled:true,version:0})).id;
 officeUnit=(await adminCommand("unit.save",{name:"Escritório",workflow:"key_custody",enabled:true,version:0})).id;
 await adminCommand("unit.custodian",{unit_id:officeUnit,user_id:custodian,enabled:true,version:0});
 await actor(admin);await db.query("select fm_manager_scope_command($1,'all_units','{}',0,'Gestão central autorizada no teste',$2)",[manager,randomUUID()]);
},60000);
afterAll(async()=>db?.close());

describe.sequential("0215 single safety check / 0216 photo links",()=>{
 it("helpers are internal: no EXECUTE for anon/authenticated, definer with pinned search_path",async()=>{
  await asPostgres();
  for(const fn of ["fm_vehicle_unsafe_reason(uuid,uuid)","fm_vehicle_unsafe_status(uuid,uuid)"]){
   for(const role of ["anon","authenticated"]) expect((await db.query<{ok:boolean}>(`select has_function_privilege('${role}','public.${fn}','execute') ok`)).rows[0]!.ok).toBe(false);
   expect((await db.query<{ok:boolean}>(`select has_function_privilege('service_role','public.${fn}','execute') ok`)).rows[0]!.ok).toBe(true);
  }
  const rows=(await db.query<{proname:string;prosecdef:boolean;cfg:string}>("select proname,prosecdef,array_to_string(proconfig,',') cfg from pg_proc where proname in ('fm_vehicle_unsafe_reason','fm_vehicle_unsafe_status','fm_release_expired_reservations','cancel_reservation','fm_key_command','record_pickup','complete_workflow_task','cancel_workflow_task','fm_release_damage_hold')")).rows;
  expect(rows).toHaveLength(9);for(const r of rows){expect(r.prosecdef).toBe(true);expect(r.cfg).toMatch(/search_path=public, pg_temp/);}
  await actor(driver);const v=await vehicle("available");await actor(driver);
  await expect(db.query("select fm_vehicle_unsafe_reason($1)",[v])).rejects.toThrow(/permission denied/);
 });
 it("S1-02: auto release puts an unsafe vehicle in blocked/maintenance, never 'reserved' without a reservation",async()=>{
  const cases:[Unsafe,string][]=[["doc","blocked"],["damage","maintenance"],["equipment","maintenance"],["work_order","maintenance"],[null,"available"]];
  const made:[string,string,string][]=[];
  for(const [u,want] of cases){const v=await vehicle("reserved",u);const r=await reservation(v,-300,-180);made.push([v,r,want]);}
  const two=await vehicle("reserved","doc");const twoR=await reservation(two,-300,-180);await reservation(two,1440,1560);
  const out=await release();
  expect(out.vehicles_released).toBeGreaterThanOrEqual(1);
  for(const [v,r,want] of made){
   expect((await vstatus(v)).s).toBe(want);
   const a=(await db.query<{after:{vehicle_status:string}}>("select after from audit_log where entity_id=$1 and action='reservation.no_show_released'",[r])).rows[0]!;
   expect(a.after.vehicle_status).toBe(want);
  }
  expect((await vstatus(two)).s).toBe("reserved");
  expect((await db.query<{s:string}>("select status::text s from reservations where id=$1",[twoR])).rows[0]!.s).toBe("cancelled");
 });
 it("S1-04: cancel_reservation does not return an unsafe vehicle to available",async()=>{
  for(const [u,want] of [["doc","blocked"],["damage","maintenance"],["equipment","maintenance"],["work_order","maintenance"],[null,"available"]] as [Unsafe,string][]){
   const v=await vehicle("reserved",u);const r=await reservation(v,1440,1560);
   await actor(driver);await db.query("select cancel_reservation($1,'Desisti')",[r]);
   expect((await vstatus(v)).s).toBe(want);
  }
  const v=await vehicle("reserved","doc");const r=await reservation(v,1440,1560);await reservation(v,3000,3100);
  await actor(driver);await db.query("select cancel_reservation($1,'Desisti')",[r]);expect((await vstatus(v)).s).toBe("reserved");
 });
 it("S1-05: key custody refuses the key handover and the digital pickup of an unsafe vehicle",async()=>{
  for(const u of ["doc","work_order"] as Unsafe[]){
   const v=await vehicle("reserved",null,officeUnit);const r=await reservation(v,-5,120);await makeUnsafe(v,u);
   await actor(custodian);await expect(keys(r,"delivered")).rejects.toThrow(/VEHICLE_NOT_READY/);
   expect((await vstatus(v)).s).toBe("reserved");
  }
  const late=await vehicle("reserved",null,officeUnit);const lr=await reservation(late,-5,120);
  await actor(custodian);await keys(lr,"delivered");await makeUnsafe(late,"doc");
  await actor(driver);await expect(pickup(lr)).rejects.toThrow(/DEPARTURE_BLOCKED/);
  expect((await vstatus(late)).s).toBe("reserved");
  const ok=await vehicle("reserved",null,officeUnit);const or=await reservation(ok,-5,120);
  await actor(custodian);await keys(or,"delivered");await actor(driver);const first=(await pickup(or)).rows[0]!.id;
  expect((await vstatus(ok)).s).toBe("in_use");
  await makeUnsafe(ok,"doc");await actor(driver);expect((await pickup(or)).rows[0]!.id).toBe(first); // exact retry stays idempotent
 });
 it("S1-06: closing the last task never makes an unsafe vehicle available",async()=>{
  const a=await vehicle("maintenance","doc");const ta=await task(a,"repair");
  await actor(admin);await db.query("select complete_workflow_task($1)",[ta]);expect(await vstatus(a)).toEqual({s:"blocked",d:false});
  const b=await vehicle("maintenance","doc");const tb=await task(b,"safety");
  await actor(manager);await db.query("select cancel_workflow_task($1)",[tb]);expect((await vstatus(b)).s).toBe("blocked");
  const c=await vehicle("maintenance");const tc=await task(c,"preventive_maintenance");
  await actor(tech);await db.query("select complete_workflow_task($1)",[tc]);expect((await vstatus(c)).s).toBe("available");
 });
 it("S1-06: the damage flag is cleared only by the audited 0205 release with the independent-actor rule",async()=>{
  const self=await vehicle("maintenance");const si=await damageReport(self,manager);const st=await task(self,"repair",si);
  await actor(manager);await expect(db.query("select complete_workflow_task($1)",[st])).rejects.toThrow(/DAMAGE_RELEASE_INDEPENDENT_ACTOR_REQUIRED/);
  expect(await vstatus(self)).toEqual({s:"maintenance",d:true});
  const ind=await vehicle("maintenance");const ii=await damageReport(ind,driver);const it_=await task(ind,"repair",ii);
  await actor(manager);await db.query("select complete_workflow_task($1)",[it_]);
  expect(await vstatus(ind)).toEqual({s:"available",d:false});
  await asPostgres();expect((await db.query("select id from audit_log where entity_id=$1 and action='vehicle.damage_hold_released' and actor_id=$2",[ind,manager])).rows).toHaveLength(1);
  const can=await vehicle("maintenance");const ci=await damageReport(can,driver);const ct=await task(can,"repair",ci);
  await actor(manager);await db.query("select cancel_workflow_task($1)",[ct]);
  expect(await vstatus(can)).toEqual({s:"maintenance",d:true});
  await asPostgres();expect((await db.query("select id from audit_log where entity_id=$1 and action='vehicle.damage_hold_released'",[can])).rows).toHaveLength(0);
 });
 it("S1-06: a work order completed through work_order.transition still returns a safe vehicle to available",async()=>{
  const v=await vehicle("available");const cmd=async(command:string,payload:object)=>(await db.query<{r:{id:string;version:number}}>("select fm_v3_command($1,$2,$3) r",[command,JSON.stringify(payload),randomUUID()])).rows[0]!.r;
  await actor(tech);const {id}=await cmd("work_order.create",{vehicle_id:v,kind:"corrective",description:"Reparo de teste",quote_total:100});
  await cmd("work_order.transition",{id,version:1,status:"budgeted"});
  await actor(manager);await cmd("work_order.transition",{id,version:2,status:"approved"});
  await cmd("work_order.transition",{id,version:3,status:"scheduled",scheduled_start:new Date(Date.now()-60000).toISOString(),scheduled_end:new Date(Date.now()+3600000).toISOString()});
  await cmd("work_order.transition",{id,version:4,status:"in_progress"});expect((await vstatus(v)).s).toBe("maintenance");
  await actor(manager);await cmd("work_order.transition",{id,version:5,status:"completed"});
  expect((await vstatus(v)).s).toBe("available");
 });
 it("S2-D01: authenticated has no INSERT on inspection_photos; only the definer link path writes it",async()=>{
  await asPostgres();
  for(const role of ["anon","authenticated"]) expect((await db.query<{ok:boolean}>(`select has_table_privilege('${role}','public.inspection_photos','insert') ok`)).rows[0]!.ok).toBe(false);
  expect((await db.query<{ok:boolean}>("select has_table_privilege('authenticated','public.inspection_photos','select') ok")).rows[0]!.ok).toBe(true);
  expect((await db.query<{n:number}>("select count(*)::int n from pg_proc where prosrc ilike '%insert into inspection_photos%' and proname='fm_photo_link' and prosecdef")).rows[0]!.n).toBe(1);
 });
});
