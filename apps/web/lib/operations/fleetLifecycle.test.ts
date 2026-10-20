import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import type {PGlite} from '@electric-sql/pglite';
import {migratedDatabase} from '../../test/migratedDatabase';
let db:PGlite;const org=randomUUID(),admin=randomUUID(),employee=randomUUID(),category=randomUUID(),location=randomUUID();
async function actor(id=admin){await db.exec('reset role');await db.query("select set_config('test.actor',$1,false)",[id]);await db.exec('set role authenticated');}
async function vehicle(){await db.exec('reset role');const id=randomUUID();await db.query("insert into vehicles(id,organization_id,plate,category_id,status,odometer_km,home_location_id,current_location_id) values($1,$2,$3,$4,'available',100,$5,$5)",[id,org,id.slice(0,8),category,location]);return id;}
async function lifecycle(kind:string,id:string,enabled:boolean,version=1,request=randomUUID()){await actor();return db.query("select fm_fleet_lifecycle($1,$2,$3,$4,'Decisão explícita de teste',$5)",[kind,id,enabled,version,request]);}
async function booking(v:string,status='confirmed'){
 await db.exec('reset role');const trip=randomUUID(),r=randomUUID();await db.query("insert into trip_requests(id,organization_id,requester_id,departure_at,expected_return_at,origin,destination,distance_km,passenger_count,requires_cargo,justification) values($1,$2,$3,now(),now()+interval '1 hour','A','B',10,1,false,'Histórico teste')",[trip,org,employee]);
 await db.query("insert into reservations(id,organization_id,vehicle_id,trip_request_id,status,start_at,end_at) values($1,$2,$3,$4,$5,now(),now()+interval '1 hour')",[r,org,v,trip,status]);return{r,trip};
}
beforeAll(async()=>{
 ({db}=await migratedDatabase());await db.query("insert into organizations(id,name) values($1,'Arquivo teste')",[org]);
 for(const [id,role] of [[admin,'administrator'],[employee,'employee']]){await db.query('insert into auth.users(id) values($1)',[id]);await db.query("insert into profiles(id,organization_id,full_name,role) values($1,$2,'Pessoa teste',$3)",[id,org,role]);}
 await db.query("insert into vehicle_categories(id,organization_id,name,passenger_capacity,supports_cargo,energy_type) values($1,$2,'Modelo teste',5,false,'ICE')",[category,org]);await db.query("insert into vehicle_locations(id,organization_id,name) values($1,$2,'Local teste')",[location,org]);
},30000);
afterAll(async()=>db?.close());
describe.sequential('data-preserving fleet lifecycle',()=>{
 it('archives with history, keeps the record and denies direct deletion, status bypass and new bookings',async()=>{
  const v=await vehicle();const historic=await booking(v,'completed');const req=randomUUID();const first=await lifecycle('vehicle',v,false,1,req);expect(await lifecycle('vehicle',v,false,1,req)).toEqual(first);
  await actor();await expect(db.query('delete from vehicles where id=$1',[v])).rejects.toThrow(/permission denied/);
  await expect(db.query("update vehicles set status='available' where id=$1",[v])).rejects.toThrow(/VEHICLE_ARCHIVED/);
  await expect(db.query('update vehicles set archived_at=null where id=$1',[v])).rejects.toThrow(/permission denied/);
  await expect(booking(v)).rejects.toThrow(/VEHICLE_ARCHIVED/);
  await db.exec('reset role');expect((await db.query('select id from reservations where id=$1',[historic.r])).rows).toHaveLength(1);expect((await db.query('select id from vehicles where id=$1',[v])).rows).toHaveLength(1);
 });
 it('refuses archive during a live reservation and enforces versions',async()=>{
  const v=await vehicle();await booking(v);await expect(lifecycle('vehicle',v,false)).rejects.toThrow(/ACTIVE_OPERATION/);
  const free=await vehicle();await lifecycle('vehicle',free,false);await expect(lifecycle('vehicle',free,true,1)).rejects.toThrow(/CONCURRENT_UPDATE/);
 });
 it('does not remove an existing damage block when reactivating',async()=>{
  const v=await vehicle();await lifecycle('vehicle',v,false);await actor();await db.query('update vehicles set has_blocking_damage=true where id=$1',[v]);await lifecycle('vehicle',v,true,2);
  const row=(await db.query<{status:string;archived_at:string|null}>('select status,archived_at from vehicles where id=$1',[v])).rows[0]!;expect(row.archived_at).toBeNull();expect(row.status).toBe('blocked');
 });
 it('preserves reference catalogs and denies disabling references still used by active vehicles',async()=>{
  await expect(lifecycle('category',category,false)).rejects.toThrow(/ACTIVE_REFERENCE/);await expect(lifecycle('location',location,false)).rejects.toThrow(/ACTIVE_REFERENCE/);
  await actor();await expect(db.query('delete from vehicle_categories where id=$1',[category])).rejects.toThrow(/permission denied/);
  await expect(db.query('update vehicle_categories set enabled=false where id=$1',[category])).rejects.toThrow(/permission denied/);
 });
 it('limits restoration and archive lists to authorized fleet roles',async()=>{
  const v=await vehicle();await lifecycle('vehicle',v,false);await actor(employee);
  await expect(db.query("select fm_fleet_lifecycle('vehicle',$1,true,2,'Sem autorização',$2)",[v,randomUUID()])).rejects.toThrow(/NOT_AUTHORIZED/);
  await expect(db.query('select fm_fleet_archive_workspace()')).rejects.toThrow(/NOT_AUTHORIZED/);
  await actor();expect((await db.query<{r:{vehicles:{id:string}[]}}>('select fm_fleet_archive_workspace() r')).rows[0]!.r.vehicles.some(x=>x.id===v)).toBe(true);
 });
 it('cancels a legacy carpool participation without deleting the passenger history',async()=>{
  const v=await vehicle();const {trip}=await booking(v,'completed');const participant=randomUUID();await db.exec('reset role');await db.query("insert into trip_participants(id,organization_id,trip_request_id,passenger_id,status) values($1,$2,$3,$4,'accepted')",[participant,org,trip,employee]);
  await actor(employee);await db.query('select leave_legacy_participation($1)',[participant]);await db.query('select leave_legacy_participation($1)',[participant]);await db.exec('reset role');
  expect((await db.query<{status:string;left_by:string}>('select status,left_by from trip_participants where id=$1',[participant])).rows[0]).toEqual({status:'rejected',left_by:employee});
 });
});
