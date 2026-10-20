-- Development rollback only. Refuses to discard governance/privacy records.
begin;
do $$begin
 if exists(select 1 from public.fm_privacy_requests) or exists(select 1 from public.fm_ai_policy_versions) then
  raise exception 'ROLLBACK_REQUIRES_DATA_PRESERVATION_PLAN';
 end if;
end;$$;
drop function public.fm_my_privacy_requests();
drop function public.fm_privacy_submit(text,text,uuid);
drop function public.fm_admin_command(text,jsonb,uuid);
drop function public.fm_admin_snapshot();
drop function public.fm_ai_policy_read();
drop table public.fm_privacy_requests,public.fm_ai_policy_versions,public.fm_ai_policy;
commit;
