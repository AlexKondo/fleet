// 0071 proof: purge_old_carpool_locations cleans only old non-PENDING requests; runs inside a DO block that always rolls back.
const q=async s=>{const r=await fetch('https://api.supabase.com/v1/projects/rhbiwkxilelitugbwind/database/query',{method:'POST',headers:{Authorization:'Bearer '+process.env.SUPABASE_TOKEN,'Content-Type':'application/json'},body:JSON.stringify({query:s})});return r.text()};
const loc=`'{"coordinates":{"lat":-23.5,"lng":-46.6},"formattedAddress":"Rua X 1","providerPlaceRef":"abc","source":"geocoded"}'::jsonb`;
const sql=`do $$ declare a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); c uuid:=gen_random_uuid(); n int; ra jsonb; rb jsonb; rc jsonb; ids uuid[];
begin
 set local session_replication_role = replica;
 insert into carpool_ride_requests(id,organization_id,carpool_offer_id,rider_id,requested_seats,requested_departure_at,policy_version,status,pickup_location,dropoff_location,host_origin_snapshot,created_at)
 values (a,gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),1,now(),1,'ACCEPTED',${loc},${loc},'Rua H', now()-interval '200 days'),
        (b,gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),1,now(),1,'PENDING',${loc},${loc},'Rua H', now()-interval '200 days'),
        (c,gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),1,now(),1,'ACCEPTED',${loc},${loc},'Rua H', now()-interval '10 days');
 n := purge_old_carpool_locations(180);
 select pickup_location into ra from carpool_ride_requests where id=a;
 select pickup_location into rb from carpool_ride_requests where id=b;
 select pickup_location into rc from carpool_ride_requests where id=c;
 raise exception 'RESULT n=% old_accepted=% old_pending_untouched=% recent_untouched=% snapshot_cleared=%', n, ra, (rb ? 'coordinates'), (rc ? 'coordinates'), (select host_origin_snapshot is null from carpool_ride_requests where id=a);
end $$;`;
console.log(await q(sql));
console.log('left over test rows:',await q("select count(*) from carpool_ride_requests"));
