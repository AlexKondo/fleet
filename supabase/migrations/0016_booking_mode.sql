-- BR-005/PB-003/ADR-006 (docs/instruction.md's referenced Controlled Engineering Set):
-- "Vehicle selection behavior must follow configurable mode: AI_RECOMMENDED | USER_CHOICE
-- | HYBRID." Previously the Mobility Decision Engine always auto-picked exactly one
-- vehicle with no way to browse alternatives — effectively AI_RECOMMENDED, hardcoded, with
-- no organization-level override. Defaults to 'ai_recommended' so this migration changes
-- no organization's observed behavior until a fleet_manager/administrator picks a
-- different mode via /settings.

create type booking_mode as enum ('ai_recommended', 'user_choice', 'hybrid');

alter table organization_settings
  add column booking_mode booking_mode not null default 'ai_recommended';
