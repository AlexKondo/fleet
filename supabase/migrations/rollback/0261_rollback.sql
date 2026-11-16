-- Rollback of 0261: removes the pending-approvals list function (the approvals themselves are not touched).
drop function if exists public.fm_approval_list_pending(text);
