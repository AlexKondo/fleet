-- Per product decision: the CNH photo/PDF itself is never persisted (LGPD-sensitive
-- personal data) — account/license/actions.ts now only holds it in memory long enough
-- to reach the vision model, then discards it. The driver-licenses bucket and its
-- policies (0039_license_ocr_and_reminders.sql) are dead now that nothing writes to it.
-- storage.objects/buckets reject direct DELETE (storage.protect_delete()) — the bucket
-- itself is removed separately via the Storage API (testing/live-demo/drop-driver-licenses-bucket.mjs),
-- not SQL. This migration only drops the now-pointless policies.
drop policy if exists "members read own driver license photo" on storage.objects;
drop policy if exists "members upload own driver license photo" on storage.objects;
