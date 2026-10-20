import {afterAll,beforeAll,describe,expect,it} from "vitest";
import {randomUUID} from "node:crypto";
import type {PGlite} from "@electric-sql/pglite";
import {migratedDatabase} from "../../test/migratedDatabase";
let db:PGlite;
const org=randomUUID(),foreign=randomUUID(),admin=randomUUID(),employee=randomUUID(),custodian=randomUUID(),legacyOrg=randomUUID(),legacyManager=randomUUID(),category=randomUUID(),location=randomUUID();
let ira:string,sp:string;
async function actor(id:string){await db.exec("reset role");await db.query("select set_config('test.actor',$1,false)",[id]);await db.exec("set role authenticated");}
async function unitCommand(command:string,payload:Record<string,unknown>){await actor(admin);return (await db.query<{r:{id:string}}>("select fm_unit_admin_command($1,$2,$3) r",[command,JSON.stringify({...payload,reason:"Configuração isolada de teste"}),randomUUID()])).rows[0]!.r;}
async function scope(manager:string,units:string[],version=0,mode="selected_units",request=randomUUID()){
 await actor(admin);return db.query("select fm_manager_scope_command($1,$2,$3,$4,'Autorização administrativa de teste',$5) result",[manager,mode,units,version,request]);
}
async function person(role="fleet_manager",organization=org){await db.exec("reset role");const id=randomUUID();await db.query("insert into auth.users(id) values($1)",[id]);await db.query("insert into profiles(id,organization_id,full_name,role,drivers_license_number,driver_authorized,drivers_license_expiration) values($1,$2,'Pessoa isolada de teste',$3,'TEST-CNH',true,current_date+30)",[id,organization,role]);return id;}
async function fixture(){
 const manager=await person();const vehicles:string[]=[],reservations:string[]=[];
 for(const unit of [ira,sp]){
  await db.exec("reset role");const vehicle=randomUUID(),trip=randomUUID(),reservation=randomUUID();vehicles.push(vehicle);reservations.push(reservation);
  await db.query("insert into vehicles(id,organization_id,plate,category_id,status,odometer_km) values($1,$2,$3,$4,'reserved',100)",[vehicle,org,vehicle.slice(0,8),category]);
  await unitCommand("unit.vehicle",{vehicle_id:vehicle,unit_id:unit,version:0});await db.exec("reset role");
  await db.query("insert into trip_requests(id,organization_id,requester_id,departure_at,expected_return_at,origin,destination,distance_km,passenger_count,requires_cargo,justification) values($1,$2,$3,now()-interval '1 minute',now()+interval '1 hour','Origem','Destino',10,1,false,'Teste')",[trip,org,employee]);
  await db.query("insert into reservations(id,organization_id,vehicle_id,trip_request_id,status,start_at,end_at) values($1,$2,$3,$4,'confirmed',now()-interval '1 minute',now()+interval '1 hour')",[reservation,org,vehicle,trip]);
 }
 return {manager,a:vehicles[0]!,b:vehicles[1]!,ra:reservations[0]!,rb:reservations[1]!};
}
async function energy(vehicle:string){return db.query("select fm_v3_command('energy.record',$1,$2) result",[JSON.stringify({vehicle_id:vehicle,kind:"fuel",quantity:10,total_cost:50,odometer_km:100,event_at:"2020-01-01T12:00:00Z",fuel_type:"gasoline"}),randomUUID()]);}
beforeAll(async()=>{
 ({db}=await migratedDatabase({beforeMigration:async(db,name)=>{if(name.startsWith("0180_")){await db.query("insert into organizations(id,name) values($1,'Organização anterior')",[legacyOrg]);await db.query("insert into auth.users(id) values($1)",[legacyManager]);await db.query("insert into profiles(id,organization_id,full_name,role) values($1,$2,'Gestor anterior','fleet_manager')",[legacyManager,legacyOrg]);}}}));
 await db.query("insert into organizations(id,name) values($1,'Organização isolada'),($2,'Organização externa')",[org,foreign]);
 for(const [id,role] of [[admin,"administrator"],[employee,"employee"],[custodian,"employee"]]){await db.query("insert into auth.users(id) values($1)",[id]);await db.query("insert into profiles(id,organization_id,full_name,role,drivers_license_number,driver_authorized,drivers_license_expiration) values($1,$2,'Pessoa de teste',$3,'TEST-CNH',true,current_date+30)",[id,org,role]);}
 await db.query("insert into organization_settings(organization_id) values($1)",[org]);
 await db.query("insert into vehicle_categories(id,organization_id,name,passenger_capacity,supports_cargo,energy_type) values($1,$2,'Categoria de teste',5,false,'ICE')",[category,org]);
 await db.query("insert into vehicle_locations(id,organization_id,name) values($1,$2,'Estacionamento de teste')",[location,org]);
 ira=(await unitCommand("unit.save",{name:"IRA",workflow:"gate_visual",enabled:true,version:0})).id;
 sp=(await unitCommand("unit.save",{name:"SP",workflow:"key_custody",enabled:true,version:0})).id;
 await unitCommand("unit.custodian",{unit_id:sp,user_id:custodian,enabled:true,version:0});
},30000);
afterAll(async()=>db?.close());
describe.sequential("fleet management scopes with actual SQL and RLS",()=>{
 it("preserves existing managers explicitly and gives new managers no implicit global scope",async()=>{
  await actor(legacyManager);expect((await db.query<{s:{mode:string}}>("select fm_my_management_scope() s")).rows[0]!.s.mode).toBe("all_units");
  const {manager,a}=await fixture();await actor(manager);expect((await db.query<{s:{vehicle_ids:string[]}}>("select fm_my_management_scope() s")).rows[0]!.s.vehicle_ids).toEqual([]);
  await expect(energy(a)).rejects.toThrow(/MANAGEMENT_SCOPE_DENIED/);
 });
 it("authorizes one or multiple units and revokes access without changing historical records",async()=>{
  const {manager,a,b}=await fixture();await scope(manager,[ira]);await actor(manager);await energy(a);await expect(energy(b)).rejects.toThrow(/MANAGEMENT_SCOPE_DENIED/);
  expect((await db.query("select id from fm_managed_vehicles where id=$1",[b])).rows).toHaveLength(0);
  await scope(manager,[ira,sp],1);await actor(manager);await energy(b);
  await scope(manager,[ira],2);await actor(manager);expect((await db.query("select id from fm_energy_events where vehicle_id=$1",[b])).rows).toHaveLength(0);
  const snapshot=(await db.query<{s:{energy:{vehicle_id:string}[]}}>("select fm_v3_snapshot() s")).rows[0]!.s;expect(snapshot.energy.some(e=>e.vehicle_id===b)).toBe(false);
  await db.exec("reset role");expect((await db.query("select id from fm_energy_events where vehicle_id=$1",[b])).rows).toHaveLength(1);
 });
 it("blocks direct vehicle edits and checked reservation overrides outside scope",async()=>{
  const {manager,a,b,rb}=await fixture();await scope(manager,[ira]);await actor(manager);
  expect((await db.query("update vehicles set name='Permitido' where id=$1 returning id",[a])).rows).toHaveLength(1);
  expect((await db.query("update vehicles set name='Indevido' where id=$1 returning id",[b])).rows).toHaveLength(0);
  expect((await db.query("update reservations set status='cancelled' where id=$1 returning id",[rb])).rows).toHaveLength(0);
  await expect(db.query("select cancel_reservation($1,'Tentativa fora do escopo')",[rb])).rejects.toThrow(/MANAGEMENT_SCOPE_DENIED/);
  await expect(db.query("select post_reservation_message($1,'delay','Tentativa fora do escopo',now()+interval '2 hours')",[rb])).rejects.toThrow(/MANAGEMENT_SCOPE_DENIED/);
  await expect(db.query("select fm_checklist_state($1)",[rb])).rejects.toThrow(/MANAGEMENT_SCOPE_DENIED/);
 });
 it("does not allow moving a managed reservation onto an unmanaged vehicle",async()=>{
  const {manager,ra,b}=await fixture();await scope(manager,[ira]);await actor(manager);
  await expect(db.query("update reservations set vehicle_id=$2 where id=$1",[ra,b])).rejects.toThrow(/row-level security/);
 });
 it("allows a designated key custodian outside their separate fleet management portfolio",async()=>{
  const {manager,rb,b}=await fixture();await scope(manager,[ira]);await unitCommand("unit.custodian",{unit_id:sp,user_id:manager,enabled:true,version:0});await actor(manager);
  await db.query("select fm_key_command($1,'delivered',null,$2)",[rb,randomUUID()]);await expect(energy(b)).rejects.toThrow(/MANAGEMENT_SCOPE_DENIED/);
  const workspace=(await db.query<{s:{reservations:{id:string}[]}}>("select fm_key_workspace() s")).rows[0]!.s;expect(workspace.reservations.some(r=>r.id===rb)).toBe(true);
 });
 it("limits the remote key management report to the authorized vehicle portfolio",async()=>{
  const {manager,rb}=await fixture();await actor(custodian);await db.query("select fm_key_command($1,'exception','Exceção de SP',$2)",[rb,randomUUID()]);await scope(manager,[ira]);await actor(manager);
  const report=(await db.query<{s:{events:{reservation_id:string}[]}}>("select fm_key_management_workspace() s")).rows[0]!.s;expect(report.events.some(e=>e.reservation_id===rb)).toBe(false);
 });
 it("requires administrative authority, versions and organization-safe grants",async()=>{
  const {manager}=await fixture();const request=randomUUID();const first=await scope(manager,[ira,sp],0,"selected_units",request);expect(await scope(manager,[sp,ira],0,"selected_units",request)).toEqual(first);
  await expect(scope(manager,[ira],0)).rejects.toThrow(/CONCURRENT_UPDATE/);
  const foreignManager=await person("fleet_manager",foreign);await expect(scope(foreignManager,[ira])).rejects.toThrow(/NOT_FOUND/);
  await actor(manager);await expect(db.query("select fm_manager_scope_command($1,'all_units','{}',1,'Ampliação indevida',$2)",[manager,randomUUID()])).rejects.toThrow(/NOT_AUTHORIZED/);
  await expect(db.exec("select * from fm_manager_scopes")).rejects.toThrow(/permission denied/);
  await db.exec("reset role");await expect(db.exec("delete from fm_manager_scope_history")).rejects.toThrow(/PRESERVE_INSPECTION_HISTORY/);
 });
 it("creates a vehicle atomically only in an authorized unit, without changing shared catalogs",async()=>{
  const {manager}=await fixture();await scope(manager,[ira]);await actor(manager);
  const payload={plate:randomUUID().slice(0,8),category_id:category,home_location_id:location,odometer_km:10,estimated_range_km:300};
  await expect(db.query("select fm_management_create_vehicle($1,$2)",[sp,JSON.stringify(payload)])).rejects.toThrow(/MANAGEMENT_SCOPE_DENIED/);
  const created=(await db.query<{id:string}>("select fm_management_create_vehicle($1,$2) id",[ira,JSON.stringify(payload)])).rows[0]!.id;
  expect((await db.query("select id from fm_managed_vehicles where id=$1",[created])).rows).toHaveLength(1);
  await expect(db.query("insert into vehicles(organization_id,plate,category_id) values($1,'BYPASS',$2)",[org,category])).rejects.toThrow(/row-level security|permission denied/);
  await expect(db.query("insert into vehicle_locations(organization_id,name) values($1,'Catálogo global indevido')",[org])).rejects.toThrow(/row-level security/);
 });
 it("scopes storage reference uploads without exposing inspection evidence",async()=>{
  const {manager,a,b}=await fixture();await scope(manager,[ira]);await actor(manager);
  await db.query("insert into storage.objects(bucket_id,name) values('vehicle-photos',$1)",[`${org}/vehicles/${a}_${randomUUID()}.jpg`]);
  await expect(db.query("insert into storage.objects(bucket_id,name) values('vehicle-photos',$1)",[`${org}/vehicles/${b}_${randomUUID()}.jpg`])).rejects.toThrow(/row-level security/);
 });
 it("keeps the personal booking catalog and sanitized availability separate from fleet management",async()=>{
  const {manager,b}=await fixture();await scope(manager,[ira]);await actor(manager);
  expect((await db.query("select id from vehicles where id=$1",[b])).rows).toHaveLength(1);
  expect((await db.query("select vehicle_id from get_vehicle_busy_windows(now()-interval '1 day') where vehicle_id=$1",[b])).rows).toHaveLength(1);
  expect((await db.query("select id from fm_managed_vehicles where id=$1",[b])).rows).toHaveLength(0);
 });
 it("applies the same unit boundary to new incident commands, dimensions and financial sources",async()=>{
  const {manager,a,b}=await fixture();await scope(manager,[ira]);await actor(manager);
  const dim=(await db.query<{r:{units:{id:string}[];bindings:{vehicle_id:string}[]}}>('select fm_management_unit_dimension() r')).rows[0]!.r;
  expect(dim.units.map(u=>u.id)).toEqual([ira]);expect(dim.bindings.some(v=>v.vehicle_id===a)).toBe(true);expect(dim.bindings.some(v=>v.vehicle_id===b)).toBe(false);
  const payload=(vehicle_id:string)=>JSON.stringify({vehicle_id,title:'Verificação de escopo',kind:'other',severity:'low',notes:'Registro com autorização da unidade.'});
  await expect(db.query('select fm_incident_command($1,$2,$3)',['create',payload(b),randomUUID()])).rejects.toThrow('NOT_AUTHORIZED');
  const id=(await db.query<{r:{id:string}}>('select fm_incident_command($1,$2,$3) r',['create',payload(a),randomUUID()])).rows[0]!.r.id;
  const workspace=(await db.query<{r:{incidents:{id:string;vehicle_id:string}[]}}>('select fm_incident_workspace() r')).rows[0]!.r;
  expect(workspace.incidents.some(i=>i.id===id)).toBe(true);expect(workspace.incidents.some(i=>i.vehicle_id===b)).toBe(false);
  await expect(db.query('select fm_v3_snapshot_before_adjustments()')).rejects.toThrow('permission denied');
  await expect(db.query('select fm_vehicle_dossier_before_adjustments($1)',[b])).rejects.toThrow('permission denied');
 });
 it('does not let a temporary table shadow the management authorization source',async()=>{
  const {manager,b}=await fixture();await scope(manager,[ira]);await actor(manager);
  try{
   await db.exec('create temporary table fm_manager_scopes (user_id uuid,organization_id uuid,mode text,version integer)');
   await db.query("insert into pg_temp.fm_manager_scopes(user_id,organization_id,mode,version) values($1,$2,'all_units',1)",[manager,org]);
   expect((await db.query<{ok:boolean}>('select public.fm_can_manage_vehicle($1) ok',[b])).rows[0]!.ok).toBe(false);
   expect((await db.query<{ok:boolean}>("select has_schema_privilege(current_user,'public','CREATE') ok")).rows[0]!.ok).toBe(false);
  }finally{await db.exec('drop table if exists pg_temp.fm_manager_scopes');}
 });
});
