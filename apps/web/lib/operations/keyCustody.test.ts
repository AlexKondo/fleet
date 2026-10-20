import {afterAll,beforeAll,describe,expect,it} from "vitest";
import {randomUUID} from "node:crypto";
import type {PGlite} from "@electric-sql/pglite";
import {migratedDatabase} from "../../test/migratedDatabase";
let db:PGlite;
const org=randomUUID(),admin=randomUUID(),driver=randomUUID(),custodian=randomUUID(),manager=randomUUID(),security=randomUUID(),outsider=randomUUID(),foreign=randomUUID(),location=randomUUID(),category=randomUUID();
async function actor(id:string){await db.exec("reset role");await db.query("select set_config('test.actor',$1,false)",[id]);await db.exec("set role authenticated");}
async function adminCommand(command:string,payload:Record<string,unknown>,id=randomUUID()){
 await actor(admin);return (await db.query<{result:{id:string;version:number}}>("select fm_unit_admin_command($1,$2,$3) result",[command,JSON.stringify({...payload,reason:"Configuração autorizada de teste"}),id])).rows[0]!.result;
}
async function setup(custodyActor=custodian){
 const unit=await adminCommand("unit.save",{name:randomUUID(),workflow:"key_custody",enabled:true,version:0});
 await adminCommand("unit.custodian",{unit_id:unit.id,user_id:custodyActor,enabled:true,version:0});
 await db.exec("reset role");
 const vehicle=randomUUID(),trip=randomUUID(),reservation=randomUUID();
 await db.query("insert into vehicles(id,organization_id,plate,category_id,status,odometer_km) values($1,$2,$3,$4,'reserved',100)",[vehicle,org,vehicle.slice(0,7),category]);
 await adminCommand("unit.vehicle",{vehicle_id:vehicle,unit_id:unit.id,version:0});
 await db.exec("reset role");
 await db.query("insert into trip_requests(id,organization_id,requester_id,departure_at,expected_return_at,origin,destination,distance_km,passenger_count,requires_cargo,justification) values($1,$2,$3,now()-interval '1 minute',now()+interval '1 hour','Escritório','Destino',10,1,false,'Teste')",[trip,org,driver]);
 await db.query("insert into reservations(id,organization_id,vehicle_id,trip_request_id,status,start_at,end_at) values($1,$2,$3,$4,'confirmed',now()-interval '1 minute',now()+interval '1 hour')",[reservation,org,vehicle,trip]);
 return {unit:unit.id,vehicle,reservation};
}
async function keys(reservation:string,kind="delivered",id=randomUUID(),reason:string|null=null){return db.query("select fm_key_command($1,$2,$3,$4) result",[reservation,kind,reason,id]);}
async function pickup(reservation:string){return db.query("select record_pickup($1,100,80,null,false,null,'{}',false,false,'traveler') id",[reservation]);}
async function returned(reservation:string,damage=false){return db.query("select record_return($1,120,70,null,$2,null,'{}',false,false,'traveler','CLIENT_HINT_IGNORED','{}',$3) id",[reservation,damage,location]);}
async function status(reservation:string){await db.exec("reset role");return (await db.query<{status:string}>("select status from reservations where id=$1",[reservation])).rows[0]!.status;}
beforeAll(async()=>{
 ({db}=await migratedDatabase());
 await db.query("insert into organizations(id,name) values($1,'Custódia isolada'),($2,'Outra organização')",[org,foreign]);
 await db.query("insert into organization_settings(organization_id) values($1)",[org]);
 for(const [id,role] of [[admin,"administrator"],[driver,"employee"],[custodian,"employee"],[manager,"fleet_manager"],[security,"security"],[outsider,"employee"]]){
  await db.query("insert into auth.users(id) values($1)",[id]);
  await db.query("insert into profiles(id,organization_id,full_name,role,drivers_license_number,driver_authorized,drivers_license_expiration) values($1,$2,'Pessoa de teste',$3,'TEST-CNH',true,current_date+30)",[id,org,role]);
 }
 await actor(admin);
 await db.query("select fm_manager_scope_command($1,'all_units','{}',0,'Gestão central autorizada no teste',$2)",[manager,randomUUID()]);
 await db.exec("reset role");
 await db.query("insert into vehicle_locations(id,organization_id,name) values($1,$2,'Estacionamento')",[location,org]);
 await db.query("insert into vehicle_categories(id,organization_id,name,passenger_capacity,supports_cargo,energy_type) values($1,$2,'Teste',5,false,'ICE')",[category,org]);
 await actor(admin);
 await db.query("select fm_equipment_profile_save('category',$1,'{}','{}',true,0,'Explicit empty test model',$2)",[category,randomUUID()]);
},30000);
afterAll(async()=>db?.close());
describe.sequential("local office custody with real migrated SQL",()=>{
 it("requires explicit assignment even for a fleet manager and does not promote a custodian",async()=>{
  const {reservation}=await setup();
  for(const id of [outsider,manager,security,driver]){await actor(id);await expect(keys(reservation)).rejects.toThrow(/KEY_CUSTODY_NOT_AUTHORIZED/);}
  await actor(custodian);await keys(reservation);
  await expect(db.exec("select fm_unit_admin_snapshot()")).rejects.toThrow(/NOT_AUTHORIZED/);
  await expect(db.exec("select * from fm_key_events")).rejects.toThrow(/permission denied/);
  await db.exec("reset role");expect((await db.query<{role:string}>("select role from profiles where id=$1",[custodian])).rows[0]!.role).toBe("employee");
 });
 it("supports a separately designated local fleet manager",async()=>{
  const {reservation}=await setup(manager);await actor(manager);await keys(reservation);
 });
 it("completes only after both driver return and key receipt, in either order",async()=>{
  for(const receiptFirst of [true,false]){
   const {reservation}=await setup();await actor(driver);await expect(pickup(reservation)).rejects.toThrow(/KEY_DELIVERY_REQUIRED/);
   await actor(custodian);const request=randomUUID();const first=await keys(reservation,"delivered",request);expect(await keys(reservation,"delivered",request)).toEqual(first);
   await expect(keys(reservation,"received",request)).rejects.toThrow(/IDEMPOTENCY_CONFLICT/);
   await actor(driver);await pickup(reservation);await pickup(reservation);
   const state=(await db.query<{s:{workflow:string;can_return:boolean;pickup_security:boolean}}>("select fm_checklist_state($1) s",[reservation])).rows[0]!.s;
   expect(state).toMatchObject({workflow:"key_custody",can_return:true,pickup_security:false});
   if(receiptFirst){await actor(custodian);await keys(reservation,"received");expect(await status(reservation)).toBe("confirmed");await actor(driver);await returned(reservation);}
   else{await actor(driver);await returned(reservation);expect(await status(reservation)).toBe("confirmed");await actor(custodian);await keys(reservation,"received");}
   expect(await status(reservation)).toBe("completed");
   expect((await db.query("select id from inspections where reservation_id=$1 and performed_by_role='security'",[reservation])).rows).toHaveLength(0);
   expect((await db.query("select id from fm_gate_events where reservation_id=$1",[reservation])).rows).toHaveLength(0);
  }
 });
 it("revokes new confirmations without deleting custody evidence",async()=>{
  const {reservation,unit}=await setup();await actor(custodian);await keys(reservation);
  await adminCommand("unit.custodian",{unit_id:unit,user_id:custodian,enabled:false,version:1});
  await actor(custodian);await expect(keys(reservation,"received")).rejects.toThrow(/KEY_CUSTODY_NOT_AUTHORIZED/);
  const workspace=(await db.query<{s:{reservations:{id:string}[]}}>("select fm_key_workspace() s")).rows[0]!.s;expect(workspace.reservations.some(r=>r.id===reservation)).toBe(false);
  await db.exec("reset role");await expect(db.exec("delete from fm_key_events")).rejects.toThrow(/PRESERVE_INSPECTION_HISTORY/);
  await expect(db.exec("truncate fm_key_events")).rejects.toThrow(/PRESERVE_INSPECTION_HISTORY/);
 });
 it("blocks self-confirmation and wrong units, and guards configuration versions",async()=>{
  const {reservation,unit,vehicle}=await setup(driver);await actor(driver);await expect(keys(reservation)).rejects.toThrow(/INDEPENDENT_CUSTODIAN_REQUIRED/);
  await actor(outsider);expect((await db.query<{s:{reservations:unknown[]}}>("select fm_key_workspace() s")).rows[0]!.s.reservations).toEqual([]);
  await expect(adminCommand("unit.custodian",{unit_id:unit,user_id:driver,enabled:false,version:0})).rejects.toThrow(/CONCURRENT_UPDATE/);
  await expect(adminCommand("unit.vehicle",{vehicle_id:vehicle,unit_id:unit,version:1})).rejects.toThrow(/ACTIVE_RESERVATION/);
 });
 it("keeps damage blocked after return and derives repair tasks without client commands",async()=>{
  const {reservation,vehicle}=await setup();await actor(custodian);await keys(reservation);await actor(driver);await pickup(reservation);
  await db.exec("reset role");await db.query("update vehicles set status='blocked' where id=$1",[vehicle]);
  await actor(driver);await returned(reservation,true);await actor(custodian);await keys(reservation,"received");
  expect(await status(reservation)).toBe("completed");
  expect((await db.query<{status:string}>("select status from vehicles where id=$1",[vehicle])).rows[0]!.status).toBe("blocked");
  expect((await db.query("select id from workflow_tasks where vehicle_id=$1 and type='repair'",[vehicle])).rows).toHaveLength(1);
  await actor(custodian);expect((await db.query<{claimed:boolean}>("select fm_claim_return_notice($1) claimed",[reservation])).rows[0]!.claimed).toBe(true);
  expect((await db.query<{claimed:boolean}>("select fm_claim_return_notice($1) claimed",[reservation])).rows[0]!.claimed).toBe(false);
 });
 it("denies forged Security inspections and calls to private implementations",async()=>{
  const {reservation}=await setup();await actor(security);
  await expect(db.query("select record_pickup($1,null,null,null,false,null,null,null,null,'security')",[reservation])).rejects.toThrow(/OFFICE_DRIVER_CHECKLIST_ONLY/);
  await expect(db.query("select fm_gate_record_pickup($1,100,80,null,false,null,'{}',false,false,'security')",[reservation])).rejects.toThrow(/permission denied/);
  await expect(db.query("select fm_finish_office_return($1)",[reservation])).rejects.toThrow(/permission denied/);
 });
 it("rejects disabled accounts and preserves unreturned keys from cancelled reservations",async()=>{
  const {reservation,unit}=await setup();await actor(custodian);await keys(reservation);
  await actor(admin);await db.query("select fm_member_access_command($1,false,0,'Desativação de teste',$2)",[custodian,randomUUID()]);
  await actor(custodian);await expect(keys(reservation,"received")).rejects.toThrow(/NOT_AUTHORIZED/);
  await actor(admin);await db.query("select fm_member_access_command($1,true,1,'Reativação de teste',$2)",[custodian,randomUUID()]);
  await db.exec("reset role");await db.query("update reservations set status='cancelled' where id=$1",[reservation]);
  await expect(adminCommand("unit.save",{id:unit,name:unit,workflow:"gate_visual",enabled:true,version:1})).rejects.toThrow(/KEYS_OUTSTANDING/);
  await actor(custodian);await keys(reservation,"received");expect(await status(reservation)).toBe("cancelled");
 });
 it("does not let a manager take the driver's checklist or manufacture a gate event",async()=>{
  const {reservation}=await setup(manager);await actor(manager);await keys(reservation);
  const state=(await db.query<{s:{can_pickup:boolean;can_return:boolean;inspection_role:null}}>("select fm_checklist_state($1) s",[reservation])).rows[0]!.s;
  expect(state).toMatchObject({can_pickup:false,can_return:false,inspection_role:null});
  await expect(pickup(reservation)).rejects.toThrow(/INSPECTION_NOT_AUTHORIZED/);
  await actor(driver);await pickup(reservation);await actor(security);
  await expect(db.query("select fm_v3_command('gate.record',$1,$2)",[JSON.stringify({reservation_id:reservation,kind:"departure"}),randomUUID()])).rejects.toThrow(/OFFICE_HAS_NO_GATE|CHECKLIST_REQUIRED/);
 });
 it("keeps the reservation workflow when the unit changes after completion",async()=>{
  const {reservation,unit}=await setup();await actor(custodian);await keys(reservation);await actor(driver);await pickup(reservation);await returned(reservation);await actor(custodian);await keys(reservation,"received");
  await adminCommand("unit.save",{id:unit,name:unit,workflow:"gate_visual",enabled:true,version:1});
  await actor(driver);const state=(await db.query<{s:{workflow:string}}>("select fm_checklist_state($1) s",[reservation])).rows[0]!.s;expect(state.workflow).toBe("key_custody");
 });
 it("does not start a trip after keys were returned without a pickup",async()=>{
  const {reservation}=await setup();await actor(custodian);await expect(keys(reservation,"received")).rejects.toThrow(/KEY_DELIVERY_REQUIRED/);
  await keys(reservation);await keys(reservation,"received");await actor(driver);await expect(pickup(reservation)).rejects.toThrow(/KEYS_ALREADY_RECEIVED/);
 });
 it("rejects cross-organization designations and limits workspace data to assigned units",async()=>{
  const foreignAdmin=randomUUID();await db.exec("reset role");await db.query("insert into auth.users(id) values($1)",[foreignAdmin]);
  await db.query("insert into profiles(id,organization_id,full_name,role) values($1,$2,'Administrador externo','administrator')",[foreignAdmin,foreign]);
  const {reservation,unit}=await setup();await expect(adminCommand("unit.custodian",{unit_id:unit,user_id:foreignAdmin,enabled:true,version:0})).rejects.toThrow(/NOT_FOUND/);
  await actor(foreignAdmin);await expect(keys(reservation)).rejects.toThrow(/NOT_FOUND/);
  expect((await db.query<{s:{reservations:unknown[]}}>("select fm_key_workspace() s")).rows[0]!.s.reservations).toEqual([]);
  expect((await db.query<{s:{units:unknown[]}}>("select fm_unit_admin_snapshot() s")).rows[0]!.s.units).toEqual([]);
  await actor(custodian);await expect(db.query("select fm_unit_admin_command('unit.custodian',$1,$2)",[JSON.stringify({unit_id:unit,user_id:custodian,enabled:true,version:0,reason:"Tentativa de ampliar acesso"}),randomUUID()])).rejects.toThrow(/NOT_AUTHORIZED/);
 });
 it("gives a remote manager read access to exceptions without local physical authority",async()=>{
  const {reservation}=await setup();await actor(custodian);await keys(reservation,"exception",randomUUID(),"Chave não localizada no escritório");
  await actor(manager);const management=(await db.query<{s:{events:{reservation_id:string;reason:string}[]}}>("select fm_key_management_workspace() s")).rows[0]!.s;
  expect(management.events.find(e=>e.reservation_id===reservation)?.reason).toBe("Chave não localizada no escritório");
  await expect(keys(reservation)).rejects.toThrow(/KEY_CUSTODY_NOT_AUTHORIZED/);
  await actor(outsider);await expect(db.exec("select fm_key_management_workspace()")).rejects.toThrow(/NOT_AUTHORIZED/);
  await actor(custodian);await expect(db.exec("select fm_key_management_workspace()")).rejects.toThrow(/NOT_AUTHORIZED/);
 });
 it("blocks workflow changes with pending reservations and bookings in disabled units",async()=>{
  const {reservation,unit,vehicle}=await setup();await db.exec("reset role");await db.query("update reservations set status='pending_approval' where id=$1",[reservation]);
  await expect(adminCommand("unit.save",{id:unit,name:unit,workflow:"gate_visual",enabled:true,version:1})).rejects.toThrow(/ACTIVE_RESERVATION/);
  await expect(adminCommand("unit.vehicle",{vehicle_id:vehicle,unit_id:unit,version:1})).rejects.toThrow(/ACTIVE_RESERVATION/);
  await db.exec("reset role");await db.query("update reservations set status='cancelled' where id=$1",[reservation]);
  await adminCommand("unit.save",{id:unit,name:unit,workflow:"key_custody",enabled:false,version:1});await db.exec("reset role");
  const trip=randomUUID();await db.query("insert into trip_requests(id,organization_id,requester_id,departure_at,expected_return_at,origin,destination,distance_km,passenger_count,requires_cargo,justification) values($1,$2,$3,now(),now()+interval '1 hour','Origem','Destino',10,1,false,'Teste')",[trip,org,driver]);
  await expect(db.query("insert into reservations(organization_id,vehicle_id,trip_request_id,status,start_at,end_at) values($1,$2,$3,'confirmed',now(),now()+interval '1 hour')",[org,vehicle,trip])).rejects.toThrow(/UNIT_DISABLED/);
 });
});
