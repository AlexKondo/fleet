import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import type {PGlite} from '@electric-sql/pglite';
import {migratedDatabase} from '../../test/migratedDatabase';
let db:PGlite;const org=randomUUID(),admin=randomUUID(),driver=randomUUID(),outsider=randomUUID(),category=randomUUID(),emptyCategory=randomUUID(),triangle=randomUUID(),spare=randomUUID(),kit=randomUUID(),charger=randomUUID();
async function actor(id:string){await db.exec('reset role');await db.query("select set_config('test.actor',$1,false)",[id]);await db.exec('set role authenticated');}
async function config(kind:string,id:string,required:string[],optional:string[]=[],version=0,enabled=true){await actor(admin);return db.query("select fm_equipment_profile_save($1,$2,$3,$4,$5,$6,'Configuração física de teste',$7)",[kind,id,required,optional,enabled,version,randomUUID()]);}
async function fixture(model=category){
 await db.exec('reset role');const vehicle=randomUUID(),trip=randomUUID(),reservation=randomUUID();await db.query("insert into vehicles(id,organization_id,plate,category_id,status,odometer_km) values($1,$2,$3,$4,'reserved',100)",[vehicle,org,vehicle.slice(0,8),model]);
 await db.query("insert into trip_requests(id,organization_id,requester_id,departure_at,expected_return_at,origin,destination,distance_km,passenger_count,requires_cargo,justification) values($1,$2,$3,now()-interval '1 minute',now()+interval '1 hour','Origem','Destino',10,1,false,'Teste')",[trip,org,driver]);
 await db.query("insert into reservations(id,organization_id,vehicle_id,trip_request_id,status,start_at,end_at) values($1,$2,$3,$4,'confirmed',now()-interval '1 minute',now()+interval '1 hour')",[reservation,org,vehicle,trip]);return{vehicle,reservation};
}
async function contract(reservation:string){await actor(driver);return(await db.query<{r:{id:string;source:string;required_names:string[];optional_names:string[];configuration_version:number}}>('select fm_prepare_equipment_checklist($1) r',[reservation])).rows[0]!.r;}
async function pickup(reservation:string,missing:string[]=[]){return db.query("select record_pickup($1,100,80,null,false,null,$2,false,false,'traveler')",[reservation,missing]);}
beforeAll(async()=>{
 ({db}=await migratedDatabase());await db.query("insert into organizations(id,name) values($1,'Equipamentos teste')",[org]);await db.query('insert into organization_settings(organization_id) values($1)',[org]);
 for(const [id,role] of [[admin,'administrator'],[driver,'employee'],[outsider,'employee']]){await db.query('insert into auth.users(id) values($1)',[id]);await db.query("insert into profiles(id,organization_id,full_name,role,drivers_license_number,driver_authorized,drivers_license_expiration) values($1,$2,'Pessoa teste',$3,'TEST-CNH',true,current_date+30)",[id,org,role]);}
 for(const id of [category,emptyCategory])await db.query("insert into vehicle_categories(id,organization_id,name,passenger_capacity,supports_cargo,energy_type) values($1,$2,$3,5,false,'ICE')",[id,org,id]);
 for(const [id,name] of [[triangle,'Triângulo'],[spare,'Estepe'],[kit,'Kit de reparo'],[charger,'Carregador portátil']])await db.query('insert into safety_equipment_items(id,organization_id,name) values($1,$2,$3)',[id,org,name]);
 await config('category',category,[triangle,spare],[charger]);
},30000);
afterAll(async()=>db?.close());
describe.sequential('versioned equipment contracts in the migrated database',()=>{
 it('inherits the configured model and keeps optional equipment out of mandatory missing-item reports',async()=>{
  const {reservation}=await fixture();const c=await contract(reservation);expect(c.source).toBe('category');expect(c.required_names).toEqual(['Estepe','Triângulo']);expect(c.optional_names).toEqual(['Carregador portátil']);
  await expect(pickup(reservation,['Carregador portátil'])).rejects.toThrow(/INVALID_EQUIPMENT_OBSERVATION/);await pickup(reservation,[]);
  await db.exec('reset role');expect((await db.query<{equipment_contract_id:string}>('select equipment_contract_id from inspections where reservation_id=$1',[reservation])).rows[0]!.equipment_contract_id).toBe(c.id);
 });
 it('supports a vehicle-specific kit and freezes the version already prepared for a journey',async()=>{
  const {vehicle,reservation}=await fixture();const before=await contract(reservation);
  await config('vehicle',vehicle,[triangle,kit]);expect(await contract(reservation)).toEqual(before);
  await actor(admin);const effective=(await db.query<{r:{effective:{source:string;required:{name:string}[]}}}>('select fm_equipment_vehicle_snapshot($1) r',[vehicle])).rows[0]!.r.effective;
  expect(effective.source).toBe('vehicle');expect(effective.required.map(e=>e.name)).toEqual(['Kit de reparo','Triângulo']);
  await actor(driver);await pickup(reservation,['Estepe']);
 });
 it('requires an explicit configuration for a new pickup and does not let an unrelated user prepare the checklist',async()=>{
  const {reservation}=await fixture(emptyCategory);await actor(driver);await expect(pickup(reservation)).rejects.toThrow(/EQUIPMENT_CONFIGURATION_REQUIRED/);
  await actor(outsider);await expect(db.query('select fm_prepare_equipment_checklist($1)',[reservation])).rejects.toThrow(/NOT_AUTHORIZED/);
 });
 it('does not silently remove requirements when a catalog entry is deactivated and preserves snapshots',async()=>{
  const {reservation}=await fixture();const c=await contract(reservation);await actor(admin);await db.query('update safety_equipment_items set enabled=false where id=$1',[spare]);
  expect((await db.query<{r:{effective:{required:{name:string}[]}}}>('select fm_equipment_vehicle_snapshot($1) r',[(await db.query<{vehicle_id:string}>('select vehicle_id from reservations where id=$1',[reservation])).rows[0]!.vehicle_id])).rows[0]!.r.effective.required.some(e=>e.name==='Estepe')).toBe(true);
  await expect(db.query('delete from safety_equipment_items where id=$1',[spare])).rejects.toThrow(/PRESERVE_EQUIPMENT_HISTORY/);
  await db.exec('reset role');await expect(db.query('delete from fm_equipment_contracts where id=$1',[c.id])).rejects.toThrow(/PRESERVE_INSPECTION_HISTORY/);
 });
 it('validates classifications, versions and administrative authority',async()=>{
  const {vehicle}=await fixture();await expect(config('vehicle',vehicle,[triangle],[triangle])).rejects.toThrow(/INVALID_INPUT/);
  await config('vehicle',vehicle,[triangle]);await expect(config('vehicle',vehicle,[kit])).rejects.toThrow(/CONCURRENT_UPDATE/);
  await actor(driver);await expect(db.query("select fm_equipment_profile_save('vehicle',$1,'{}','{}',true,1,'Tentativa indevida',$2)",[vehicle,randomUUID()])).rejects.toThrow(/NOT_AUTHORIZED/);
 });
});
it('preserves a return observation path for a journey recorded before equipment contracts',async()=>{
 const ids={org:randomUUID(),driver:randomUUID(),category:randomUUID(),vehicle:randomUUID(),trip:randomUUID(),reservation:randomUUID()};
 const {db:legacy}=await migratedDatabase({beforeMigration:async(db,name)=>{
  if(!name.startsWith('0184_'))return;
  await db.query("insert into organizations(id,name) values($1,'Legado de teste')",[ids.org]);await db.query('insert into organization_settings(organization_id) values($1)',[ids.org]);await db.query('insert into auth.users(id) values($1)',[ids.driver]);
  await db.query("insert into profiles(id,organization_id,full_name,role,drivers_license_number,driver_authorized,drivers_license_expiration) values($1,$2,'Condutor legado','employee','TEST-CNH',true,current_date+30)",[ids.driver,ids.org]);
  await db.query("insert into vehicle_categories(id,organization_id,name,passenger_capacity,supports_cargo,energy_type) values($1,$2,'Legado',5,false,'ICE')",[ids.category,ids.org]);
  await db.query("insert into vehicles(id,organization_id,plate,category_id,status,odometer_km) values($1,$2,'LEGACY',$3,'reserved',10)",[ids.vehicle,ids.org,ids.category]);
  await db.query("insert into trip_requests(id,organization_id,requester_id,departure_at,expected_return_at,origin,destination,distance_km,passenger_count,requires_cargo,justification) values($1,$2,$3,now()-interval '1 minute',now()+interval '1 hour','A','B',10,1,false,'Legado')",[ids.trip,ids.org,ids.driver]);
  await db.query("insert into reservations(id,organization_id,vehicle_id,trip_request_id,status,start_at,end_at) values($1,$2,$3,$4,'confirmed',now()-interval '1 minute',now()+interval '1 hour')",[ids.reservation,ids.org,ids.vehicle,ids.trip]);
  await db.query("select set_config('test.actor',$1,false)",[ids.driver]);await db.exec('set role authenticated');await db.query("select record_pickup($1,10,90,null,false,null,'{}',false,false,'traveler')",[ids.reservation]);await db.exec('reset role');
 }});
 try{await legacy.query("select set_config('test.actor',$1,false)",[ids.driver]);await legacy.exec('set role authenticated');expect((await legacy.query<{r:{source:string}}>('select fm_prepare_equipment_checklist($1) r',[ids.reservation])).rows[0]!.r.source).toBe('legacy_return_observation');}finally{await legacy.close();}
},30000);
