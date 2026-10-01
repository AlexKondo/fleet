# Migrations: how they are written and applied

The database is the LIVE production project with real users. Two things went wrong before (a privacy migration applied before the
matching app code was deployed locked everyone out; internal SECURITY DEFINER functions were callable by anyone). The rules below prevent both.

## 1. Expand / contract
- **Expand (additive)** - new tables, columns, functions, helper objects; nothing revoked, dropped or narrowed. Goes in
  `supabase/migrations/NNNN_*.sql` and may be applied before the app is deployed.
- **Contract (tightening)** - revoke, drop, narrower policy / WITH CHECK, dropped function, anon revocation, default-privilege changes.
  Goes in `supabase/migrations-pending/NNNN_*.sql` (never in `migrations/`, so nobody applies it by accident) together with
  `supabase/migrations-pending/rollback/NNNN_rollback.sql`. It must be backward compatible with BOTH the code currently deployed and the
  new code. Order: deploy the app first, then the operator applies the pending files, then runs the regression suite.
- Rollbacks of ACL changes are GENERATED from the real before-state (`node supabase/tests/gen-acl-rollback.mjs 0068|0069`), never hand-written.

## 2. Every new function / table must be granted explicitly (after pending 0070)
Once 0070 is applied, objects created in `public` are no longer auto-exposed to `anon` / `authenticated` (PUBLIC execute on functions is gone too;
`service_role` keeps its default access). So every migration that adds something the signed-in app uses must also grant it:

```sql
grant execute on function public.my_fn(uuid) to authenticated;          -- functions called by the user client
grant select, insert, update, delete on public.my_table to authenticated; -- tables read/written by the user client (RLS is still the row guard)
grant usage, select on sequence public.my_seq to authenticated;          -- only if inserts by authenticated need it
```
Never grant anything to `anon` unless an unauthenticated flow truly needs it (today none does). Internal SECURITY DEFINER functions (anything that
takes an organization / user id as an argument, or writes audit / notification rows) are service_role only. Function overloads: a `CREATE OR
REPLACE` with a changed parameter list creates a second overload - `DROP FUNCTION` the old signature in the same migration.

## 3. Pre-flight before anything tightening is applied (nothing is left applied)
```
node supabase/tests/preflight-role-simulation.mjs supabase/migrations-pending/0066_x.sql [more.sql] \
     [--suite m1,m2,s1,l5,f5] [--rollback supabase/migrations-pending/rollback/0066_rollback.sql]
```
It runs the migration inside `begin ... rollback` with role simulation (anon, every app role, the 5 real profiles read-only, a disposable org),
prints BEFORE vs WITH-migration per check, and with `--rollback` proves the rollback restores the exact ACL snapshot (functions, relations,
columns, default ACLs) and the baseline behaviour.

## 4. Apply and verify
Apply through the Supabase Management API (`POST /v1/projects/<ref>/database/query`, token from the root `.env`, exported first). Then
`node supabase/tests/run-carpool-live-suite.mjs --pending-applied --with-browser` (serial).
