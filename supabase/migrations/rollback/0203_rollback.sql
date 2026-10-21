-- Rollback of 0203: removes the vehicle-photos bucket limits (state before: both null).
update storage.buckets set allowed_mime_types=null,file_size_limit=null where id='vehicle-photos';
