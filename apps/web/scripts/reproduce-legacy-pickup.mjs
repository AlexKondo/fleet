// Isolated diagnostic: executes the unchanged historical pickup function in an
// ephemeral embedded database. Never connects to the application's database.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
const db = new PGlite();
const org='00000000-0000-4000-8000-000000000001';
const driver='00000000-0000-4000-8000-000000000002';
const security='00000000-0000-4000-8000-000000000003';
const vehicle='00000000-0000-4000-8000-000000000004';
const trip='00000000-0000-4000-8000-000000000005';
const reservation='00000000-0000-4000-8000-000000000006';
try {
 await db.exec(`
 create schema auth;
 create function auth.uid() returns uuid language sql as $$select current_setting('test.actor')::uuid$$;
 create function current_organization_id() returns uuid language sql as $$select '${org}'::uuid$$;
 create type user_role as enum('employee','security','fleet_manager','administrator','maintenance_operator');
 create type inspection_role as enum('traveler','security');
 create type vehicle_status as enum('available','reserved','awaiting_pickup','in_use','returning','blocked');
 create table profiles(id uuid primary key,role user_role,driver_authorized boolean,drivers_license_expiration date);
 insert into profiles values('${driver}','employee',true,current_date+30),('${security}','security',false,null);
 create table vehicles(id uuid primary key,status vehicle_status,updated_at timestamptz);
 insert into vehicles values('${vehicle}','reserved',now());
 create table trip_requests(id uuid primary key,requester_id uuid);
 insert into trip_requests values('${trip}','${driver}');
 create table reservations(id uuid primary key,organization_id uuid,vehicle_id uuid,trip_request_id uuid,start_at timestamptz,status text);
 insert into reservations values('${reservation}','${org}','${vehicle}','${trip}',now()-interval '1 minute','confirmed');
 create table organization_settings(organization_id uuid,early_pickup_grace_minutes integer);
 insert into organization_settings values('${org}',15);
 create table inspections(id uuid primary key default gen_random_uuid(),organization_id uuid,reservation_id uuid,vehicle_id uuid,type text,performed_by uuid,performed_by_role inspection_role,odometer_km integer,fuel_level_percent numeric,battery_level_percent numeric,has_new_damage boolean,damage_notes text,missing_safety_equipment text[],is_dirty_exterior boolean,is_dirty_interior boolean);
 `);
 const sql=readFileSync(new URL('../../../supabase/migrations/0024_time_aware_approval_and_pickup.sql',import.meta.url),'utf8');
 const fn=sql.match(/create or replace function record_pickup\([\s\S]*?\$\$;/i)?.[0];
 if(!fn) throw new Error('Historical function not found');
 await db.exec(fn);
 const pickup = role=>db.query("select record_pickup($1,100,80,null,false,null,'{}',false,false,$2)",[reservation,role]);
 await db.query("select set_config('test.actor',$1,false)",[driver]);
 await pickup('traveler');
 await db.query("select set_config('test.actor',$1,false)",[security]);
 let secondChecklistBlocked=false;
 try { await pickup('security'); } catch(error) {
  if (!String(error.message).includes('Vehicle is not ready for pickup')) throw error;
  secondChecklistBlocked=true;
 }
 // Reset only the disposable fixture to test the declared-actor boundary.
 await db.exec("update vehicles set status='reserved'; delete from inspections;");
 await db.query("select set_config('test.actor',$1,false)",[driver]);
 await pickup('security');
 const forged=(await db.query("select performed_by_role from inspections where performed_by=$1",[driver])).rows[0]?.performed_by_role==='security';
 await db.exec("update vehicles set status='reserved'; delete from inspections; update reservations set status='cancelled';");
 await pickup('traveler');
 const cancelledAccepted=(await db.query("select count(*)::int n from inspections")).rows[0]?.n===1;
 console.log(JSON.stringify({isolated:true,sourceMigration:'0024',secondIndependentChecklistBlocked:secondChecklistBlocked,travelerCanDeclareSecurityRole:forged,cancelledReservationAccepted:cancelledAccepted},null,2));
 if(!secondChecklistBlocked || !forged || !cancelledAccepted) process.exitCode=1;
} finally { await db.close(); }
