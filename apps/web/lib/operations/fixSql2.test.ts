import {afterAll,beforeAll,describe,expect,it} from "vitest";
import {randomUUID} from "node:crypto";
import type {PGlite} from "@electric-sql/pglite";
import {migratedDatabase} from "../../test/migratedDatabase";
/** E2E SQL defects fixed by 0204-0206 (FIX-SQL-2): SQL-1 unblock, SQL-3 damage-hold release, SQL-2 transfer audit. */
let db:PGlite;
const org=randomUUID(),admin=randomUUID(),manager=randomUUID(),limited=randomUUID(),security=randomUUID(),maintenance=randomUUID(),custodian=randomUUID(),driver=randomUUID(),driver2=randomUUID(),employee=randomUUID(),category=randomUUID(),location=randomUUID();
let gateUnit:string,otherUnit:string,officeUnit:string;
async function actor(id:string){await db.exec("reset role");await db.query("select set_config('test.actor',$1,false)",[id]);await db.exec("set role authenticated");}
async function asPostgres(){await db.exec("reset role");}
async function adminCommand(command:string,payload:Record<string,unknown>){
 await actor(admin);return (await db.query<{r:{id:string}}>("select fm_unit_admin_command($1,$2,$3) r",[command,JSON.stringify({...payload,reason:"Configuração autorizada de teste"}),randomUUID()])).rows[0]!.r;
}
async function vehicle(unit:string,flags:{damage?:boolean;doc?:boolean;missing?:string[]}={}){
 await asPostgres();const id=randomUUID();
 await db.query("insert into vehicles(id,organization_id,plate,category_id,status,odometer_km,has_blocking_damage,documentation_valid,missing_safety_equipment) values($1,$2,$3,$4,'available',100,$5,$6,$7)",[id,org,id.slice(0,7),category,flags.damage??false,flags.doc??true,flags.missing??[]]);
 await adminCommand("unit.vehicle",{vehicle_id:id,unit_id:unit,version:0});await asPostgres();return id;
}
async function reservation(requester=driver,unit=gateUnit){
 const v=await vehicle(unit);await asPostgres();const trip=randomUUID(),id=randomUUID();
 await db.query("update vehicles set status='reserved' where id=$1",[v]);
 await db.query("insert into trip_requests(id,organization_id,requester_id,departure_at,expected_return_at,origin,destination,distance_km,passenger_count,requires_cargo,justification) values($1,$2,$3,now()-interval '1 minute',now()+interval '2 hours','A','B',10,1,false,'Teste')",[trip,org,requester]);
 await db.query("insert into reservations(id,organization_id,vehicle_id,trip_request_id,status,start_at,end_at) values($1,$2,$3,$4,'confirmed',now()-interval '1 minute',now()+interval '2 hours')",[id,org,v,trip]);
 return {id,vehicle:v};
}
const pickup=(id:string,role="traveler",damage=false)=>db.query<{id:string}>("select record_pickup($1,100,80,null,$4,$5,$3,false,false,$2) id",[id,role,role==="traveler"?"{}":null,damage,damage?"Risco na porta":null]);
const gate=(id:string,kind:string)=>db.query("select fm_v3_command('gate.record',$1,$2) r",[JSON.stringify({reservation_id:id,kind}),randomUUID()]);
const block=(v:string)=>db.query("select block_vehicle($1,'Bloqueio de teste')",[v]);
const unblock=(v:string)=>db.query("select unblock_vehicle($1)",[v]);
const complete=(task:string)=>db.query("select complete_workflow_task($1)",[task]);
async function repairTask(v:string){await asPostgres();return (await db.query<{id:string}>("select id from workflow_tasks where vehicle_id=$1 and type='repair' and status in ('open','in_progress')",[v])).rows[0]!.id;}
async function vstate(v:string){await asPostgres();return (await db.query<{s:string}>("select status||'/'||has_blocking_damage s from vehicles where id=$1",[v])).rows[0]!.s;}
async function damagePhoto(reservationId:string){await asPostgres();await db.query("insert into inspection_photos(organization_id,inspection_id,angle,storage_path) select organization_id,id,'damage',organization_id||'/'||id||'/d.jpg' from inspections where reservation_id=$1 and type='pickup' and has_new_damage",[reservationId]);}
async function incident(command:string,payload:Record<string,unknown>){
 if(command!=="create"){await asPostgres();payload={...payload,version:(await db.query<{version:number}>("select version from fm_incidents where id=$1",[payload.id])).rows[0]!.version};}
 await actor(manager);return (await db.query<{r:{id:string;status:string}}>("select fm_incident_command($1,$2,$3) r",[command,JSON.stringify({notes:"Tratamento de teste",...payload}),randomUUID()])).rows[0]!.r;
}
const auditCount=async(entity:string,action:string)=>{await asPostgres();return Number((await db.query<{n:number}>("select count(*)::int n from audit_log where entity_id=$1 and action=$2",[entity,action])).rows[0]!.n);};

beforeAll(async()=>{
 ({db}=await migratedDatabase());
 await db.query("insert into organizations(id,name) values($1,'Correções SQL 2')",[org]);
 await db.query("insert into organization_settings(organization_id) values($1)",[org]);
 for(const [id,role] of [[admin,"administrator"],[manager,"fleet_manager"],[limited,"fleet_manager"],[security,"security"],[maintenance,"maintenance_operator"],[custodian,"employee"],[driver,"employee"],[driver2,"employee"],[employee,"employee"]]){
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

describe.sequential("FIX-SQL-2 corrections with the actual migrated SQL",()=>{
 it("SQL-1: unblock is refused while blocking damage, invalid documentation or missing safety equipment persists",async()=>{
  for(const flags of [{damage:true,doc:false},{doc:false},{missing:["triangulo"]},{damage:true}]){
   const v=await vehicle(gateUnit,flags);
   await actor(manager);await block(v);
   await expect(unblock(v)).rejects.toThrow(/VEHICLE_UNBLOCK_CONDITIONS_PENDING/);
   expect(await vstate(v)).toMatch(/^blocked\//);
  }
  const v=await vehicle(gateUnit,{damage:true,doc:false});await actor(manager);await block(v);
  await asPostgres();await db.query("update vehicles set has_blocking_damage=false,documentation_valid=true where id=$1",[v]);
  await actor(manager);await unblock(v);expect(await vstate(v)).toBe("available/false");
  expect(await auditCount(v,"vehicle_unblocked")).toBe(1);
  const clean=await vehicle(gateUnit);await actor(admin);await block(clean);
  await actor(employee);await expect(unblock(clean)).rejects.toThrow(/MANAGEMENT_SCOPE_DENIED/);
  await actor(admin);await unblock(clean);expect(await vstate(clean)).toBe("available/false");
 });
 it("SQL-3: damage reported at the gate pickup is released by an independent actor once repair task and incident are closed",async()=>{
  const r=await reservation();
  await actor(driver);const insp=(await pickup(r.id,"traveler",true)).rows[0]!.id;await damagePhoto(r.id);
  await actor(security);await pickup(r.id,"security");
  expect(await vstate(r.vehicle)).toBe("awaiting_pickup/true");
  await actor(security);await expect(gate(r.id,"departure")).rejects.toThrow(/DEPARTURE_BLOCKED/);
  const task=await repairTask(r.vehicle);
  await actor(driver);await expect(complete(task)).rejects.toThrow();
  const created=await incident("create",{vehicle_id:r.vehicle,inspection_id:insp,kind:"other",severity:"high",title:"Avaria na retirada"});
  await incident("analyze",{id:created.id});
  await actor(maintenance);await complete(task);
  expect(await vstate(r.vehicle)).toBe("awaiting_pickup/true"); // incident still pending
  await incident("resolve",{id:created.id});
  expect(await vstate(r.vehicle)).toBe("awaiting_pickup/false");
  expect(await auditCount(r.vehicle,"vehicle.damage_hold_released")).toBe(1);
  await incident("close",{id:created.id});
  expect(await auditCount(r.vehicle,"vehicle.damage_hold_released")).toBe(1);
  await actor(security);await gate(r.id,"departure");
  expect(await vstate(r.vehicle)).toBe("in_use/false");
 });
 it("SQL-3: the reporter cannot release his own damage; scope still applies",async()=>{
  const own=await reservation(manager);
  await actor(manager);await pickup(own.id,"traveler",true);
  const task=await repairTask(own.vehicle);
  await actor(manager);await expect(complete(task)).rejects.toThrow(/DAMAGE_RELEASE_INDEPENDENT_ACTOR_REQUIRED/);
  expect(await vstate(own.vehicle)).toBe("awaiting_pickup/true");
  await actor(admin);await complete(task);
  expect(await vstate(own.vehicle)).toBe("awaiting_pickup/false");
  const out=await reservation(driver,otherUnit);
  await actor(driver);await pickup(out.id,"traveler",true);
  const outTask=await repairTask(out.vehicle);
  await actor(limited);await expect(complete(outTask)).rejects.toThrow();
  expect(await vstate(out.vehicle)).toBe("awaiting_pickup/true");
 });
 it("SQL-3: office trip held 'blocked' by pickup damage resumes after the repair and the hold never unblocks by itself",async()=>{
  const r=await reservation(driver,officeUnit);
  await actor(custodian);await db.query("select fm_key_command($1,'delivered',null,$2)",[r.id,randomUUID()]);
  await actor(driver);await pickup(r.id,"traveler",true);
  expect(await vstate(r.vehicle)).toBe("blocked/true");
  await actor(limited);await expect(unblock(r.vehicle)).rejects.toThrow(/VEHICLE_UNBLOCK_CONDITIONS_PENDING/);
  await complete(await repairTask(r.vehicle));
  expect(await vstate(r.vehicle)).toBe("in_use/false");
  const manual=await vehicle(gateUnit,{damage:true});await actor(manager);await block(manual);
  await asPostgres();const t=(await db.query<{id:string}>("insert into workflow_tasks(organization_id,vehicle_id,type,notes) values($1,$2,'repair','Reparo') returning id",[org,manual])).rows[0]!.id;
  await actor(manager);await complete(t);
  expect(await vstate(manual)).toBe("blocked/false"); // manual block stays until "Desbloquear"
  await unblock(manual);expect(await vstate(manual)).toBe("available/false");
 });
 it("SQL-2: transfer_reservation writes an audit event; refused transfers write none",async()=>{
  const r=await reservation();
  await actor(manager);await db.query("select transfer_reservation($1,$2)",[r.id,driver2]);
  await asPostgres();
  const row=(await db.query<{actor_id:string;before:{requester_id:string};after:{requester_id:string}}>("select actor_id,before,after from audit_log where entity_id=$1 and action='reservation_transferred'",[r.id])).rows;
  expect(row).toHaveLength(1);
  expect(row[0]).toMatchObject({actor_id:manager,before:{requester_id:driver},after:{requester_id:driver2}});
  await actor(employee);await expect(db.query("select transfer_reservation($1,$2)",[r.id,employee])).rejects.toThrow();
  expect(await auditCount(r.id,"reservation_transferred")).toBe(1);
 });
 it('direct writes cannot clear damage, alter state or forge evidence for any interactive role',async()=>{
  const v=await vehicle(gateUnit,{damage:true});
  for(const who of [admin,manager,limited,security,maintenance,employee]){
   await actor(who);
   for(const column of ['has_blocking_damage=false',"status='available'","missing_safety_equipment='{}'", 'documentation_valid=true',"photo_storage_path='forged'"]){
    await expect(db.query(`update vehicles set ${column} where id=$1`,[v])).rejects.toThrow(/permission denied/);
   }
  }
  await actor(manager);expect((await db.query("update vehicles set name='Authorized identity edit' where id=$1 returning id",[v])).rows).toHaveLength(1);
  await actor(security);expect((await db.query("update vehicles set name='Forbidden identity edit' where id=$1 returning id",[v])).rows).toHaveLength(0);
  await asPostgres();expect((await db.query<{damage:boolean}>('select has_blocking_damage damage from vehicles where id=$1',[v])).rows[0]!.damage).toBe(true);
 });

});
