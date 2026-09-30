-- Profile photo (avatar) upload. Unlike the CNH document (0043_drop_driver_license_storage.sql),
-- an avatar is not LGPD-sensitive identity-document data — it's a normal public-facing
-- profile picture, same category as a Slack/Google avatar, so it's fine to actually persist
-- in Storage rather than being discarded after a one-off read.

alter table public.profiles
  add column avatar_url text;

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

-- Avatars are served directly as public image URLs (next/image, UserMenu, etc.), so the
-- bucket itself is public — these policies only gate who can WRITE, not who can read.
create policy "Avatar images are publicly readable"
  on storage.objects for select
  using (bucket_id = 'avatars');

-- Path convention enforced here: {user_id}/{filename}, so a user can only write under
-- their own id, checked against the first path segment.
create policy "Users can upload their own avatar"
  on storage.objects for insert
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can update their own avatar"
  on storage.objects for update
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can delete their own avatar"
  on storage.objects for delete
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
