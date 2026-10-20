import {beforeAll,afterAll,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import type {PGlite} from '@electric-sql/pglite';
import {migratedDatabase} from '../../test/migratedDatabase';
let db:PGlite;
const org=randomUUID(),admin=randomUUID(),driver=randomUUID(),security=randomUUID(),outsider=randomUUID(),category=randomUUID(),vehicle=randomUUID(),trip=randomUUID(),reservation=randomUUID();let inspection:string;
async function actor(id:string){await db.exec('reset role');await db.query("select set_config('test.actor',$1,false)",[id]);await db.exec('set role authenticated');}
async function begin(kind='inspection',target=inspection,angle:string|null='damage',sha='a'.repeat(64)){
 return (await db.query<{r:{id:string;path:string;state:string}}>('select fm_photo_begin($1,$2,$3,$4,3,\'image/png\') r',[kind,target,angle,sha])).rows[0]!.r;
}
beforeAll(async()=>{
 ({db}=await migratedDatabase());await db.query("insert into organizations(id,name) values($1,'Isolated')",[org]);
 for(const [id,role] of [[admin,'administrator'],[driver,'employee'],[security,'security'],[outsider,'fleet_manager']]){await db.query('insert into auth.users(id) values($1)',[id]);await db.query("insert into profiles(id,organization_id,full_name,role,drivers_license_number,driver_authorized,drivers_license_expiration) values($1,$2,'Isolated',$3,'TEST-CNH',true,current_date+30)",[id,org,role]);}
 await db.query('insert into organization_settings(organization_id) values($1)',[org]);
 await db.query("insert into vehicle_categories(id,organization_id,name,passenger_capacity,supports_cargo,energy_type) values($1,$2,'Test',5,false,'ICE')",[category,org]);
 await db.query("insert into vehicles(id,organization_id,plate,category_id,status,odometer_km) values($1,$2,'P01001',$3,'reserved',100)",[vehicle,org,category]);
 await db.query("insert into trip_requests(id,organization_id,requester_id,departure_at,expected_return_at,origin,destination,distance_km,passenger_count,requires_cargo,justification) values($1,$2,$3,now()-interval '1 minute',now()+interval '1 hour','A','B',10,1,false,'Test')",[trip,org,driver]);
 await db.query("insert into reservations(id,organization_id,vehicle_id,trip_request_id,status,start_at,end_at) values($1,$2,$3,$4,'confirmed',now()-interval '1 minute',now()+interval '1 hour')",[reservation,org,vehicle,trip]);
 await actor(admin);await db.query("select fm_equipment_profile_save('category',$1,'{}','{}',true,0,'Explicit test profile',$2)",[category,randomUUID()]);
},30000);
afterAll(async()=>db?.close());
it('rejects a pickup with missing validity and then accepts regularized validity',async()=>{
 await db.exec('reset role');await db.query('update profiles set drivers_license_expiration=null where id=$1',[driver]);await actor(driver);
 await expect(db.query("select record_pickup($1,100,80,null,false,null,'{}',false,false,'traveler')",[reservation])).rejects.toThrow(/LICENSE_EXPIRED/);
 await db.exec('reset role');await db.query('update profiles set drivers_license_expiration=current_date+30 where id=$1',[driver]);await actor(driver);
 inspection=(await db.query<{id:string}>("select record_pickup($1,100,80,null,false,null,'{}',false,false,'traveler') id",[reservation])).rows[0]!.id;
});
it('persists the journal before upload, rejects missing object and deduplicates finalization',async()=>{
 await actor(driver);const one=await begin();expect(await begin()).toEqual(one);
 await expect(db.query('select fm_photo_finalize($1)',[one.id])).rejects.toThrow(/PHOTO_UPLOAD_REQUIRED/);
 expect(JSON.stringify((await db.query('select fm_photo_pending() p')).rows)).toContain(one.id);
 await db.query("insert into storage.objects(bucket_id,name) values('vehicle-photos',$1)",[one.path]);
 await db.query('select fm_photo_finalize($1)',[one.id]);await db.query('select fm_photo_finalize($1)',[one.id]);
 expect((await db.query('select id from inspection_photos where storage_path=$1',[one.path])).rows).toHaveLength(1);
 await expect(db.query('delete from storage.objects where name=$1',[one.path])).resolves.toMatchObject({affectedRows:0});
 await expect(db.query("update storage.objects set name='overwritten' where name=$1",[one.path])).resolves.toMatchObject({affectedRows:0});
});
it('prevents another actor, unscoped manager and anonymous access',async()=>{
 await actor(outsider);await expect(begin()).rejects.toThrow(/NOT_AUTHORIZED/);await expect(begin('vehicle',vehicle,null)).rejects.toThrow(/NOT_AUTHORIZED/);
 await db.exec('reset role;set role anon');await expect(begin()).rejects.toThrow(/permission denied/);
});
it('links a reference photo atomically and retains the prior journal',async()=>{
 await actor(admin);const one=await begin('vehicle',vehicle,null);await db.query("insert into storage.objects(bucket_id,name) values('vehicle-photos',$1)",[one.path]);await db.query('select fm_photo_finalize($1)',[one.id]);
 expect((await db.query<{photo_storage_path:string}>('select photo_storage_path from vehicles where id=$1',[vehicle])).rows[0]!.photo_storage_path).toBe(one.path);
 await expect(db.exec('delete from fm_photo_uploads')).rejects.toThrow(/permission denied/);
});
it('returns maintenance unavailability without OS metadata and excludes it from reservation-only RPC',async()=>{
 await db.exec('reset role');const otherVehicle=randomUUID();await db.query("insert into vehicles(id,organization_id,plate,category_id,status,odometer_km) values($1,$2,'P01002',$3,'available',0)",[otherVehicle,org,category]);
 await db.query("insert into fm_work_orders(organization_id,vehicle_id,description,kind,status,scheduled_start,scheduled_end,created_by) values($1,$2,'CONFIDENTIAL','preventive','scheduled',now(),now()+interval '1 hour',$3)",[org,otherVehicle,admin]);
 await actor(driver);const rows=(await db.query('select * from fm_availability_windows() where vehicle_id=$1',[otherVehicle])).rows;
 expect(rows).toHaveLength(1);expect(Object.keys(rows[0]!).sort()).toEqual(['end_at','kind','start_at','vehicle_id']);expect(JSON.stringify(rows)).not.toContain('CONFIDENTIAL');
 expect((await db.query('select * from get_vehicle_busy_windows() where vehicle_id=$1',[otherVehicle])).rows).toHaveLength(0);
 await expect(db.query('select * from fm_work_orders')).resolves.toMatchObject({rows:[]});
});
it('has no remaining bare-public application SECURITY DEFINER and denies internal/photo anonymous calls',async()=>{
 await db.exec('reset role');
 const unsafe=(await db.query("select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef and 'search_path=public'=any(coalesce(p.proconfig,'{}'))")).rows;
 expect(unsafe).toEqual([]);
 expect((await db.query<{ok:boolean}>("select has_function_privilege('anon','fm_photo_finalize(uuid)','execute') ok")).rows[0]!.ok).toBe(false);
 expect((await db.query<{ok:boolean}>("select has_function_privilege('authenticated','fm_assert_can_drive(uuid,uuid)','execute') ok")).rows[0]!.ok).toBe(false);
});
it('filters unitless staff fan-out for an unscoped manager',async()=>{
 await db.exec('reset role');
 await db.query("insert into notifications(organization_id,user_id,title,body,entity_type,entity_id) values($1,$2,'Private work order','CONFIDENTIAL','vehicle',$3)",[org,outsider,vehicle]);
 expect((await db.query("select id from notifications where user_id=$1 and body='CONFIDENTIAL'",[outsider])).rows).toHaveLength(0);
});
it('rejects a disabled requester even when a security actor submits the pickup',async()=>{
 await db.exec('reset role');await db.query('insert into fm_member_access(user_id,organization_id,enabled,version,updated_by,reason) values($1,$2,false,1,$3,\'Test deactivation\')',[driver,org,admin]);await actor(security);
 await expect(db.query("select record_pickup($1,100,80,null,false,null,'{}',false,false,'security')",[reservation])).rejects.toThrow(/DRIVER_NOT_AUTHORIZED/);
});
