import type {TypedSupabaseClient} from '@fleet/supabase-client';
import {loadManagementScope} from './managerScope';
/** Organization-only telemetry has no reliable unit dimension. Never read it
 * with a service client for a restricted or unverified management context. */
export async function organizationMetricsAllowed(db:TypedSupabaseClient):Promise<boolean>{
 return (await loadManagementScope(db))?.mode==='all_units';
}
