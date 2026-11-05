import type { Database } from "@fleet/supabase-client";

export type MessageType = Database["public"]["Enums"]["message_type"];

/** Who is looking at a reservation: on their own reservation everybody is the requester, whatever their role. */
export type ChatSide = "requester" | "manager" | "security";

/** The private conversations of a reservation (reservation_messages.channel, migration 0255). */
export const MESSAGE_CHANNELS = ["requester_manager", "requester_security", "manager_security"] as const;
export type MessageChannel = (typeof MESSAGE_CHANNELS)[number];

export function isMessageChannel(value: unknown): value is MessageChannel {
  return (MESSAGE_CHANNELS as readonly unknown[]).includes(value);
}

/** The list the person picks from: the two other sides of the reservation, in the order they are shown. */
export function chatTargets(side: ChatSide): { channel: MessageChannel; other: ChatSide }[] {
  switch (side) {
    case "security":
      return [
        { channel: "manager_security", other: "manager" },
        { channel: "requester_security", other: "requester" },
      ];
    case "manager":
      return [
        { channel: "requester_manager", other: "requester" },
        { channel: "manager_security", other: "security" },
      ];
    case "requester":
      return [
        { channel: "requester_manager", other: "manager" },
        { channel: "requester_security", other: "security" },
      ];
  }
}
