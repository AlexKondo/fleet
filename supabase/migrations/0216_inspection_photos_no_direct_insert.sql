-- 0216 (CORRECOES F1 / S2-D01) CONTRACT: no direct INSERT into inspection_photos.
--
-- Problem: authenticated kept INSERT on public.inspection_photos (policies "members attach photos to own organization
-- inspections" and fm_photo_own_insert, 0177). An inspector could upload any object into <org>/<inspection>/ and insert the
-- link row through PostgREST, skipping the upload journal (fm_photo_uploads), the SHA-256, the server attestation
-- (fm_photo_attest, 0212) and the photo.linked audit - even with 0214 applied, because 0214 only hardens fm_photo_link.
--
-- Fix: revoke INSERT from authenticated / anon / PUBLIC. The only writer is fm_photo_link (SECURITY DEFINER, owner postgres;
-- reached through fm_photo_finalize), which is not affected by this revoke. SELECT stays (evidence reading, RLS unchanged);
-- UPDATE/DELETE are already refused by the fm_photos_append_only trigger and are not changed here. The INSERT policies are left
-- in place (inert without the privilege) so the rollback is a single GRANT.
--
-- App check (grep, 2026-10-22): no code inserts into inspection_photos with the session client - neither the integrated branch
-- nor the deployed 0aa2403 (both link photos through fm_photo_begin -> upload -> [fm_photo_attest] -> fm_photo_finalize).
-- Classification: CONTRACT (revoke). Backward compatible with the deployed code and the new code. Independent of 0214; may be
-- applied before or after it. service_role keeps its privileges (server-side maintenance only).
-- Rollback: supabase/migrations/rollback/0216_rollback.sql.

revoke insert on table public.inspection_photos from authenticated;
revoke insert on table public.inspection_photos from anon;
revoke insert on table public.inspection_photos from public;
