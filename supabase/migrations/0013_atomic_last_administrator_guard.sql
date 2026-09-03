-- Closes a race condition in team management (apps/web/app/settings/users/actions.ts):
-- updateUserRole/removeUser guarded against removing an organization's last
-- administrator with a plain `select count(*) ... <= 1` as a separate round-trip from
-- the actual role change / user deletion. Every PostgREST/RPC call from the Supabase
-- client is its own transaction, so two administrators demoting or removing each other
-- at the same instant could both read count=2, both pass the guard, and leave the
-- organization with zero administrators — permanently locked out of this very page.
--
-- lock_and_require_multiple_administrators takes a row lock on every 'administrator' row
-- in the organization before counting, so a second concurrent call blocks until the
-- first commits and then correctly re-counts the post-commit state (Postgres re-checks a
-- blocked FOR UPDATE row against the query's WHERE clause once the blocking transaction
-- commits, excluding it if it no longer matches — the standard EvalPlanQual behavior).
--
-- update_member_role folds this guard and the actual role UPDATE into one statement/
-- transaction, which closes the race completely for role changes. removeUser's
-- deletion, however, goes through auth.admin.deleteUser — a GoTrue Admin API call, not
-- SQL, so it cannot be folded into the same transaction as the guard no matter how this
-- is written. Calling lock_and_require_multiple_administrators immediately before it
-- still narrows the race window (a concurrent call now has to wait for this function's
-- transaction to commit before it can even read the count), but does not close it
-- completely — documented as a known residual risk in actions.ts, not claimed as fixed.
--
-- Neither function checks auth.uid()/RLS: both trust p_organization_id as given, which is
-- safe ONLY because they are granted to `service_role` alone, never `authenticated` — the
-- caller is apps/web/lib/supabase/admin.ts's service-role client, invoked only after
-- apps/web/app/settings/users/actions.ts's requireAdministrator() has already resolved
-- organization_id from the acting user's own RLS-scoped session. Granting these to
-- `authenticated` would let any logged-in user change any organization's roles directly.

create or replace function lock_and_require_multiple_administrators(p_organization_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_count integer;
begin
  perform 1 from profiles
    where organization_id = p_organization_id and role = 'administrator'
    for update;

  select count(*) into v_admin_count
    from profiles
    where organization_id = p_organization_id and role = 'administrator';

  if v_admin_count <= 1 then
    raise exception 'Cannot change this administrator: the organization would be left with none';
  end if;
end;
$$;

revoke all on function lock_and_require_multiple_administrators(uuid) from public;
grant execute on function lock_and_require_multiple_administrators(uuid) to service_role;

create or replace function update_member_role(p_organization_id uuid, p_user_id uuid, p_new_role user_role)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target_org uuid;
  v_target_role user_role;
begin
  select organization_id, role into v_target_org, v_target_role
    from profiles where id = p_user_id for update;
  if v_target_org is null or v_target_org is distinct from p_organization_id then
    raise exception 'User not found';
  end if;

  if v_target_role = 'administrator' and p_new_role is distinct from 'administrator' then
    perform lock_and_require_multiple_administrators(p_organization_id);
  end if;

  update profiles set role = p_new_role where id = p_user_id;
end;
$$;

revoke all on function update_member_role(uuid, uuid, user_role) from public;
grant execute on function update_member_role(uuid, uuid, user_role) to service_role;
