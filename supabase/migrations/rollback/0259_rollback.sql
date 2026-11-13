-- Rollback of 0259: removes the number-reply function. The approval itself (fm_approval_decide) is unchanged.
drop function if exists public.fm_approval_decide_by_phone(text, text, text);
