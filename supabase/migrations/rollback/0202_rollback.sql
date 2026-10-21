-- Rollback of 0202: limited managers read the whole organization's audit_log again.
drop policy if exists fm_scope_audit_read on public.audit_log;
drop function if exists public.fm_audit_entry_in_scope(text,uuid,uuid);
