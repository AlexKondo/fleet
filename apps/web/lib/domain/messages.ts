import type { Database } from "@fleet/supabase-client";

export type MessageType = Database["public"]["Enums"]["message_type"];

// Values only — labels come from `dict.reservations.messages.types`, keyed by these
// values. `system_alert` is intentionally absent: it is written by the system, never
// picked by a user in the composer.
export const MESSAGE_TYPE_OPTIONS: { value: MessageType }[] = [
  { value: "text" },
  { value: "delay" },
  { value: "vehicle_issue" },
  { value: "return_time_change" },
  { value: "vehicle_not_found" },
];
