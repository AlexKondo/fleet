import {it,expect,vi} from 'vitest';
import type {TypedSupabaseClient} from '@fleet/supabase-client';
import {organizationMetricsAllowed} from './organizationMetrics';
it('refuses organization telemetry for limited, missing or unverifiable scopes',async()=>{
 for(const response of [{error:null,data:{mode:'selected_units',units:[],vehicle_ids:[]}},{error:{message:'unavailable'},data:null},{error:null,data:{mode:'all_units'}}]){
 const db={rpc:vi.fn(async()=>response)} as unknown as TypedSupabaseClient;expect(await organizationMetricsAllowed(db)).toBe(false);
 }
 expect(await organizationMetricsAllowed({rpc:async()=>({error:null,data:{mode:'all_units',units:[],vehicle_ids:[]}})} as unknown as TypedSupabaseClient)).toBe(true);
});
