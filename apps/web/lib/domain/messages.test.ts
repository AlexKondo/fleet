import { describe, expect, it } from "vitest";
import { chatTargets, isMessageChannel, isUnread } from "./messages";

describe("reservation chat", () => {
  it("each side picks between the two others, and the gate sees the fleet manager first", () => {
    expect(chatTargets("security").map((t) => t.other)).toEqual(["manager", "requester"]);
    expect(chatTargets("manager").map((t) => t.other)).toEqual(["requester", "security"]);
    expect(chatTargets("requester").map((t) => t.other)).toEqual(["manager", "security"]);
  });
  it("only the known conversations are accepted", () => {
    expect(isMessageChannel("manager_security")).toBe(true);
    expect(isMessageChannel("qualquer")).toBe(false);
    expect(isMessageChannel(null)).toBe(false);
  });
});

describe("isUnread", () => {
  const at = "2026-11-05T12:00:00.000Z";
  it("own messages never count", () => {
    expect(isUnread({ mine: true, created_at: at }, null)).toBe(false);
  });
  it("a conversation never opened: everything from others is unread", () => {
    expect(isUnread({ mine: false, created_at: at }, null)).toBe(true);
    expect(isUnread({ mine: false, created_at: at }, undefined)).toBe(true);
  });
  it("after opening, only what arrived later is unread", () => {
    expect(isUnread({ mine: false, created_at: at }, "2026-11-05T12:00:01.000Z")).toBe(false);
    expect(isUnread({ mine: false, created_at: at }, "2026-11-05T11:59:59.000Z")).toBe(true);
  });
});
