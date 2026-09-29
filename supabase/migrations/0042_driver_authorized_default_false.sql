-- driver_authorized used to default true (0014_driver_authorization.sql), on the
-- assumption every member starts trusted until proven otherwise. Product decision now
-- flips that: a member starts UNAUTHORIZED until either the CNH-OCR flow
-- (account/license/actions.ts) reads a still-valid license automatically, or a fleet
-- manager/administrator approves them manually on Settings -> Team.
alter table profiles alter column driver_authorized set default false;

-- Existing members who were auto-authorized under the old default but never actually
-- had a license recorded shouldn't stay authorized just because they were created
-- before this change — anyone genuinely reviewed/authorized already has a
-- drivers_license_number on file (either from the OCR flow or a manual grant), so this
-- only resets the ones that were never actually checked.
update profiles
set driver_authorized = false
where driver_authorized = true and drivers_license_number is null;
