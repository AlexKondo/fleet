import {afterAll,beforeAll,describe,expect,it} from "vitest";
import {randomUUID} from "node:crypto";
import type {PGlite} from "@electric-sql/pglite";
import {migratedDatabase} from "../../test/migratedDatabase";
/** Pacote 01 corrections 0197-0203 (FIX-SQL): DEF-01, D1-05, DEF-02, DEF-03, DEF-04, DEF-05, DEF-06, DEF-09. */
let db:PGlite;
const org=randomUUID(),admin=randomUUID(),manager=randomUUID(),limited=randomUUID(),security=randomUUID(),security2=randomUUID(),custodian=randomUUID(),driver=randomUUID(),driver2=randomUUID(),category=randomUUID(),location=randomUUID();
let gateUnit:string,otherUnit:string,officeUnit:string;
async function actor(id:string){await db.exec("reset role");await db.query("select set_config('test.actor',$1,false)",[id]);await db.exec("set role authenticated");}
async function asPostgres(){await db.exec("reset role");}
async function adminCommand(command:string,payload:Record<string,unknown>){
 await actor(admin);return (await db.query<{r:{id:string}}>("select fm_unit_admin_command($1,$2,$3) r",[command,JSON.stringify({...payload,reason:"Configuração autorizada de teste"}),randomUUID()])).rows[0]!.r;
}
async function reservation(requester=driver,unit:string|null=gateUnit,start="now()-interval '1 minute'",end="now()+interval '2 hours'"){
 await asPostgres();const vehicle=randomUUID(),trip=randomUUID(),id=randomUUID();
 await db.query("insert into vehicles(id,organization_id,plate,category_id,status,odometer_km) values($1,$2,$3,$4,'reserved',100)",[vehicle,org,vehicle.slice(0,7),category]);
 if(unit) await adminCommand("unit.vehicle",{vehicle_id:vehicle,unit_id:unit,version:0});
 await asPostgres();
 await db.query(`insert into trip_requests(id,organization_id,requester_id,departure_at,expected_return_at,origin,destination,distance_km,passenger_count,requires_cargo,justification) values($1,$2,$3,${start},${end},'A','B',10,1,false,'Teste')`,[trip,org,requester]);
 await db.query(`insert into reservations(id,organization_id,vehicle_id,trip_request_id,status,start_at,end_at) values($1,$2,$3,$4,'confirmed',${start},${end})`,[id,org,vehicle,trip]);
 return {id,vehicle};
}
const pickup=(id:string,role="traveler")=>db.query<{id:string}>("select record_pickup($1,100,80,null,false,null,$3,false,false,$2) id",[id,role,role==="traveler"?"{}":null]);
const returned=(id:string,role="traveler")=>db.query<{id:string}>("select record_return($1,120,70,null,false,null,$3,false,false,$2,null,null,$4) id",[id,role,role==="traveler"?"{}":null,role==="traveler"?location:null]);
const gate=(id:string,kind:string,reason?:string)=>db.query("select fm_v3_command('gate.record',$1,$2) r",[JSON.stringify({reservation_id:id,kind,...(reason?{reason}:{})}),randomUUID()]);
const keys=(id:string,kind:string)=>db.query("select fm_key_command($1,$2,null,$3) r",[id,kind,randomUUID()]);
const exception=(id:string,outcome:string,request=randomUUID(),reason="Exceção operacional de teste")=>db.query<{r:{ok:boolean;vehicle_status:string;id:string}}>("select fm_operation_exception($1,$2,$3,$4) r",[id,outcome,reason,request]);
async function state(id:string){await asPostgres();return (await db.query<{s:string}>("select r.status||'/'||v.status s from reservations r join vehicles v on v.id=r.vehicle_id where r.id=$1",[id])).rows[0]!.s;}
async function ready(id:string,requester=driver){await actor(requester);await pickup(id);await actor(security);await pickup(id,"security");}

beforeAll(async()=>{
 ({db}=await migratedDatabase());
 await db.query("insert into organizations(id,name) values($1,'Correções Pacote 01')",[org]);
 await db.query("insert into organization_settings(organization_id) values($1)",[org]);
 for(const [id,role] of [[admin,"administrator"],[manager,"fleet_manager"],[limited,"fleet_manager"],[security,"security"],[security2,"security"],[custodian,"employee"],[driver,"employee"],[driver2,"employee"]]){
  await db.query("insert into auth.users(id) values($1)",[id]);
  await db.query("insert into profiles(id,organization_id,full_name,role,drivers_license_number,driver_authorized,drivers_license_expiration) values($1,$2,'Pessoa de teste',$3,'TEST-CNH',true,current_date+30)",[id,org,role]);
 }
 await db.query("insert into vehicle_locations(id,organization_id,name) values($1,$2,'Pátio')",[location,org]);
 await db.query("insert into vehicle_categories(id,organization_id,name,passenger_capacity,supports_cargo,energy_type) values($1,$2,'Modelo',5,false,'ICE')",[category,org]);
 await actor(admin);await db.query("select fm_equipment_profile_save('category',$1,'{}','{}',true,0,'Explicit empty test model',$2)",[category,randomUUID()]);
 gateUnit=(await adminCommand("unit.save",{name:"Portaria",workflow:"gate_visual",enabled:true,version:0})).id;
 otherUnit=(await adminCommand("unit.save",{name:"Outra portaria",workflow:"gate_visual",enabled:true,version:0})).id;
 officeUnit=(await adminCommand("unit.save",{name:"Escritório",workflow:"key_custody",enabled:true,version:0})).id;
 await adminCommand("unit.custodian",{unit_id:officeUnit,user_id:custodian,enabled:true,version:0});
 await actor(admin);
 await db.query("select fm_manager_scope_command($1,'all_units','{}',0,'Gestão central autorizada no teste',$2)",[manager,randomUUID()]);
 await db.query("select fm_manager_scope_command($1,'selected_units',$2,0,'Gestão limitada autorizada no teste',$3)",[limited,[gateUnit,officeUnit],randomUUID()]);
},60000);
afterAll(async()=>db?.close());

describe.sequential("Pacote 01 corrections with the actual migrated SQL",()=>{
 it("DEF-01: only an independent security actor records departure, arrival and denial",async()=>{
  const own=await reservation(admin);await ready(own.id,admin);
  await actor(admin);await expect(gate(own.id,"departure")).rejects.toThrow(/NOT_AUTHORIZED/);
  const other=await reservation();await ready(other.id);
  for(const who of [admin,manager,limited]){await actor(who);
   await expect(gate(other.id,"departure")).rejects.toThrow(/NOT_AUTHORIZED/);
   await expect(gate(other.id,"denied","Negativa indevida")).rejects.toThrow(/NOT_AUTHORIZED/);}
  const self=await reservation(security2);await ready(self.id,security2);
  await actor(security2);await expect(gate(self.id,"departure")).rejects.toThrow(/GATE_SELF_RELEASE_NOT_AUTHORIZED/);
  await expect(gate(self.id,"denied","Auto negativa")).rejects.toThrow(/GATE_SELF_RELEASE_NOT_AUTHORIZED/);
  await actor(security);await gate(other.id,"departure");
  await actor(manager);await expect(gate(other.id,"arrival")).rejects.toThrow(/NOT_AUTHORIZED/);
  expect((await db.query("select id from fm_gate_events where reservation_id=$1",[other.id])).rows).toHaveLength(1);
  await actor(security);await gate(other.id,"arrival");
 });
 it("D1-05: a scoped manager/administrator records the driver checklist on his behalf without opening the gate",async()=>{
  const r=await reservation();
  await actor(manager);const insp=(await pickup(r.id)).rows[0]!.id;
  await expect(pickup(r.id,"security")).rejects.toThrow(/INSPECTION_NOT_AUTHORIZED/);
  await expect(gate(r.id,"departure")).rejects.toThrow(/NOT_AUTHORIZED/);
  await actor(security);await pickup(r.id,"security");await gate(r.id,"departure");await gate(r.id,"arrival");
  await actor(admin);await returned(r.id);await actor(security);await returned(r.id,"security");
  expect(await state(r.id)).toBe("completed/available");
  const row=(await db.query<{performed_by:string;actor_role_at_recording:string}>("select performed_by,actor_role_at_recording from inspections where id=$1",[insp])).rows[0]!;
  expect(row).toEqual({performed_by:manager,actor_role_at_recording:"fleet_manager"});
  const audit=(await db.query<{after:{on_behalf_of:string}}>("select after from audit_log where action='pickup_inspection_recorded' and entity_id=$1",[insp])).rows[0]!;
  expect(audit.after.on_behalf_of).toBe(driver);
 });
 it("D1-05: scope, CNH of the driver and custodian independence still apply",async()=>{
  const out=await reservation(driver,otherUnit);await actor(limited);await expect(pickup(out.id)).rejects.toThrow(/INSPECTION_NOT_AUTHORIZED/);
  await asPostgres();await db.query("update profiles set drivers_license_expiration=current_date-1 where id=$1",[driver2]);
  const expired=await reservation(driver2);await actor(admin);await expect(pickup(expired.id)).rejects.toThrow(/LICENSE_EXPIRED/);
  await asPostgres();await db.query("update profiles set drivers_license_expiration=current_date+30 where id=$1",[driver2]);
  const office=await reservation(driver,officeUnit);await actor(custodian);await keys(office.id,"delivered");
  await actor(limited);await pickup(office.id);await returned(office.id);
  await actor(custodian);await keys(office.id,"received");expect(await state(office.id)).toBe("completed/available");
  await adminCommand("unit.custodian",{unit_id:officeUnit,user_id:manager,enabled:true,version:0});
  const own=await reservation(driver,officeUnit);await actor(manager);await keys(own.id,"delivered");
  await expect(pickup(own.id)).rejects.toThrow(/INSPECTION_NOT_AUTHORIZED/);
  await actor(driver);await pickup(own.id);
 });
 it("DEF-02: finalize verifies size, MIME, owner and declared hash before linking",async()=>{
  const r=await reservation();await actor(driver);const insp=(await pickup(r.id)).rows[0]!.id;
  const begin=async(angle:string,sha:string)=>(await db.query<{r:{id:string;path:string}}>("select fm_photo_begin('inspection',$1,$2,$3,10,'image/png') r",[insp,angle,sha])).rows[0]!.r;
  const object=async(path:string,meta:Record<string,unknown>,owner:string=driver)=>{await asPostgres();await db.query("insert into storage.objects(bucket_id,name,owner,metadata) values('vehicle-photos',$1,$2,$3)",[path,owner,JSON.stringify(meta)]);await actor(driver);};
  const cases:[string,Record<string,unknown>,string][]=[["front",{size:2097152,mimetype:"image/png"},driver],["back",{size:10,mimetype:"text/html"},driver],["left_side",{size:10,mimetype:"image/png"},security],["right_side",{},driver]];
  for(const [i,[angle,meta,owner]] of cases.entries()){
   const sha=String(i+1).repeat(64);const one=await begin(angle,sha);await object(one.path,meta,owner);
   await expect(db.query("select fm_photo_finalize($1)",[one.id])).rejects.toThrow(/PHOTO_INTEGRITY_MISMATCH/);
   await asPostgres();expect((await db.query<{state:string}>("select state from fm_photo_uploads where id=$1",[one.id])).rows[0]!.state).toBe("pending");await actor(driver);
  }
  const good=await begin("wheels","9".repeat(64));await object(good.path,{size:10,mimetype:"image/png",eTag:"\"x\""});
  await expect(db.query("select fm_photo_finalize($1,$2)",[good.id,"8".repeat(64)])).rejects.toThrow(/PHOTO_HASH_MISMATCH/);
  await expect(db.query("select fm_photo_finalize($1,$2)",[good.id,"9".repeat(64)])).rejects.toThrow(/PHOTO_SERVER_VERIFICATION_REQUIRED/);
  await expect(db.query("select fm_photo_attest($1,$2,$3,10,'image/png',(select storage_path from fm_photo_uploads where id=$1))",[good.id,driver,"9".repeat(64)])).rejects.toThrow(/permission denied/);
  await db.exec('reset role;set role service_role');await db.query("select fm_photo_attest($1,$2,$3,10,'image/png',(select storage_path from fm_photo_uploads where id=$1))",[good.id,driver,"9".repeat(64)]);await actor(driver);
  await db.query("select fm_photo_finalize($1,$2)",[good.id,"9".repeat(64)]);
  await expect(db.query("select fm_photo_finalize($1,$2)",[good.id,"8".repeat(64)])).rejects.toThrow(/PHOTO_HASH_MISMATCH/);
  await db.query("select fm_photo_finalize($1)",[good.id]);
  expect((await db.query("select id from inspection_photos where storage_path=$1",[good.path])).rows).toHaveLength(1);
 });
 it("DEF-03/DEF-04: cancel is refused after operations; the audited exception closes or continues the trip",async()=>{
  const plain=await reservation();await actor(driver);await db.query("select cancel_reservation($1,'Sem operação')",[plain.id]);expect(await state(plain.id)).toBe("cancelled/available");
  const r=await reservation();await ready(r.id);
  await actor(driver);await expect(db.query("select cancel_reservation($1,'Depois do checklist')",[r.id])).rejects.toThrow(/CANCEL_BLOCKED_OPERATION_STARTED/);
  await actor(admin);await expect(db.query("select cancel_reservation($1,'Depois do checklist')",[r.id])).rejects.toThrow(/CANCEL_BLOCKED_OPERATION_STARTED/);
  await actor(driver);await expect(exception(r.id,"not_departed")).rejects.toThrow(/NOT_AUTHORIZED|INDEPENDENT_ACTOR_REQUIRED/);
  await actor(security);const request=randomUUID();const first=(await exception(r.id,"not_departed",request)).rows[0]!.r;
  expect(first).toMatchObject({ok:true,vehicle_status:"available"});expect((await exception(r.id,"not_departed",request)).rows[0]!.r).toEqual(first);
  expect(await state(r.id)).toBe("cancelled/available");
  // T1-D01: the internal reason must not reach the requester (reservation row nor notification text); it stays only in fm_operation_exceptions.
  await asPostgres();
  expect((await db.query<{c:string;b:string}>("select r.cancellation_reason c,(select string_agg(n.body,' | ') from notifications n where n.entity_id=r.id and n.title='Reserva encerrada por exceção') b from reservations r where r.id=$1",[r.id])).rows[0]).toEqual({c:"operation_exception:not_departed",b:expect.not.stringContaining("Exceção operacional de teste")});
  expect((await db.query<{reason:string}>("select reason from fm_operation_exceptions where id=$1",[first.id])).rows[0]!.reason).toBe("Exceção operacional de teste");
  await asPostgres();await expect(db.query("update fm_operation_exceptions set reason='alterada' where id=$1",[first.id])).rejects.toThrow(/PRESERVE_INSPECTION_HISTORY/);
  expect((await db.query("select id from inspections where reservation_id=$1",[r.id])).rows).toHaveLength(2);
  const late=await reservation(driver,gateUnit,"now()-interval '1 minute'","now()+interval '1 hour'");await ready(late.id);
  await asPostgres();await db.query("update reservations set start_at=now()-interval '3 hours',end_at=now()-interval '1 minute' where id=$1",[late.id]);
  await actor(security);await expect(gate(late.id,"departure")).rejects.toThrow(/OUTSIDE_RESERVATION_WINDOW/);
  await actor(manager);await expect(exception(late.id,"departed_unrecorded")).rejects.toThrow(/NOT_AUTHORIZED/);
  await actor(security);await exception(late.id,"departed_unrecorded");await gate(late.id,"arrival");
  await actor(driver);await returned(late.id);await actor(security);await returned(late.id,"security");
  expect(await state(late.id)).toBe("completed/available");
  const office=await reservation(driver,officeUnit);await actor(custodian);await keys(office.id,"delivered");
  await actor(admin);await expect(db.query("select cancel_reservation($1,'Chave entregue')",[office.id])).rejects.toThrow(/CANCEL_BLOCKED_OPERATION_STARTED/);
  await actor(custodian);await expect(exception(office.id,"not_departed")).rejects.toThrow(/KEYS_OUTSTANDING/);
  await expect(exception(office.id,"departed_unrecorded")).rejects.toThrow(/OFFICE_HAS_NO_GATE/);
  await keys(office.id,"received");await exception(office.id,"not_departed");expect(await state(office.id)).toBe("cancelled/available");
 });
 it("DEF-05: an overdue work order in execution keeps the vehicle unavailable until it is closed",async()=>{
  await asPostgres();const vehicle=randomUUID();
  await db.query("insert into vehicles(id,organization_id,plate,category_id,status,odometer_km) values($1,$2,'OVERDUE',$3,'maintenance',0)",[vehicle,org,category]);
  await db.query("insert into fm_work_orders(organization_id,vehicle_id,description,kind,status,scheduled_start,scheduled_end,created_by,budget_pending) values($1,$2,'CONFIDENTIAL','corrective','in_progress',now()-interval '3 hours',now()-interval '1 minute',$3,false)",[org,vehicle,admin]);
  await actor(driver);const rows=(await db.query<{end_at:unknown;kind:string}>("select end_at::text end_at,kind from fm_availability_windows() where vehicle_id=$1",[vehicle])).rows;
  expect(rows).toEqual([{end_at:"infinity",kind:"maintenance"}]);
  await expect(db.query("select create_vehicle_reservation(now()+interval '1 day',now()+interval '1 day 2 hours','A','B',10,1,false,'x',$1,false)",[vehicle])).rejects.toThrow(/MAINTENANCE_CONFLICT/);
  await asPostgres();await db.query("update fm_work_orders set status='cancelled' where vehicle_id=$1",[vehicle]);
  await actor(driver);expect((await db.query("select * from fm_availability_windows() where vehicle_id=$1",[vehicle])).rows).toHaveLength(0);
 });
 it("DEF-06: a limited manager reads only audit rows inside his unit scope",async()=>{
  const out=await reservation(driver,otherUnit);await actor(admin);await db.query("select cancel_reservation($1,'Fora do escopo')",[out.id]);
  const inside=await reservation(driver,gateUnit);await actor(admin);await db.query("select cancel_reservation($1,'No escopo')",[inside.id]);
  await actor(limited);
  expect((await db.query("select id from audit_log where entity_id=$1",[out.id])).rows).toHaveLength(0);
  expect((await db.query("select id from audit_log where entity_id=$1",[inside.id])).rows.length).toBeGreaterThan(0);
  await actor(manager);expect((await db.query("select id from audit_log where entity_id=$1",[out.id])).rows.length).toBeGreaterThan(0);
 });
 it("DEF-09 and grants: bucket limits, no anonymous execution, internal helpers private, definer functions pinned",async()=>{
  await asPostgres();
  expect((await db.query<{file_size_limit:string;allowed_mime_types:string[]}>("select file_size_limit::text,allowed_mime_types from storage.buckets where id='vehicle-photos'")).rows[0]).toEqual({file_size_limit:"10485760",allowed_mime_types:["image/jpeg","image/png","image/webp","image/heic"]});
  const priv=async(role:string,fn:string)=>(await db.query<{ok:boolean}>("select has_function_privilege($1,$2,'execute') ok",[role,fn])).rows[0]!.ok;
  for(const fn of ["fm_operation_exception(uuid,text,text,uuid)","fm_photo_finalize(uuid,text)","fm_audit_entry_in_scope(text,uuid,uuid)","cancel_reservation(uuid,text)"]){expect(await priv("anon",fn)).toBe(false);expect(await priv("authenticated",fn)).toBe(true);}
  for(const fn of ["fm_gate_physical_actor_guard(uuid)","fm_checklist_on_behalf_allowed(uuid)","fm_photo_link(uuid,text)","fm_work_order_busy_until(text,timestamptz)"]){expect(await priv("anon",fn)).toBe(false);expect(await priv("authenticated",fn)).toBe(false);}
  const unpinned=(await db.query("select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef and array_to_string(coalesce(p.proconfig,'{}'),',') not like '%search_path=%pg_temp%' and proname in ('fm_operation_exception','fm_photo_link','fm_photo_finalize','fm_audit_entry_in_scope','fm_gate_physical_actor_guard','fm_checklist_on_behalf_allowed','cancel_reservation','fm_scope_command_guard','fm_verified_departure_checks','fm_prepare_equipment_checklist','fm_gate_record_pickup','fm_gate_record_return','fm_office_record_return','fm_verify_inspection_actor','fm_availability_windows','fm_reservation_maintenance_guard')")).rows;
  expect(unpinned).toEqual([]);
 });
});
