-- Pacote 01 correction DEF-09 (DEC-03): bucket vehicle-photos accepted text/html and 15 MB objects under the uploader's own
-- inspection folder. Idempotent bucket limits (Storage enforces them at upload): images only, 10 MB (= fm_photo_begin limit).
-- image/heic is allowed at the bucket level as approved; fm_photo_begin / fm_photo_uploads still accept only jpeg/png/webp,
-- so a HEIC object can never be linked as evidence until that journal contract is widened explicitly.
do $$
begin
 if exists(select 1 from information_schema.columns where table_schema='storage' and table_name='buckets' and column_name='allowed_mime_types')
 and exists(select 1 from information_schema.columns where table_schema='storage' and table_name='buckets' and column_name='file_size_limit') then
  update storage.buckets set allowed_mime_types=array['image/jpeg','image/png','image/webp','image/heic'],file_size_limit=10485760 where id='vehicle-photos';
 end if;
end $$;
