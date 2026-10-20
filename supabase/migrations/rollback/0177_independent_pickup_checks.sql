-- Evidence is append-only and actor verification must not be silently removed.
-- This release requires a reviewed forward correction, not an automatic rollback
-- to the vulnerable pickup/return definitions or the old storage grants.
do $$begin
 raise exception 'FORWARD_CORRECTION_REQUIRED: preserve independent inspections, actor verification and physical event history';
end;$$;
