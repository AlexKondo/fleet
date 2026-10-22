-- CONTRACT only after every writer binds its downloaded path using the six-argument attestation.
-- The owner-only five-argument routine remains the private implementation of the checked wrapper.
revoke all on function public.fm_photo_attest(uuid,uuid,text,integer,text) from public,anon,authenticated,service_role;
