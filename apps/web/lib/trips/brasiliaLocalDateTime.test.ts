import { describe, expect, it } from "vitest";
import { parseBrasiliaLocalDateTime } from "./brasiliaLocalDateTime";

describe("parseBrasiliaLocalDateTime", () => {
  it("reads a zone-less datetime-local value as Brasília time (UTC-3), independent of the runtime zone", () => {
    expect(parseBrasiliaLocalDateTime("2026-10-13T10:00").toISOString()).toBe("2026-10-13T13:00:00.000Z");
    expect(parseBrasiliaLocalDateTime("2026-10-13T00:30").toISOString()).toBe("2026-10-13T03:30:00.000Z");
    expect(parseBrasiliaLocalDateTime("2026-10-13T23:59:30").toISOString()).toBe("2026-10-14T02:59:30.000Z");
  });
  it("keeps values that already carry an offset or Z", () => {
    expect(parseBrasiliaLocalDateTime("2026-10-13T13:00:00.000Z").toISOString()).toBe("2026-10-13T13:00:00.000Z");
    expect(parseBrasiliaLocalDateTime("2026-10-13T10:00:00-03:00").toISOString()).toBe("2026-10-13T13:00:00.000Z");
    expect(parseBrasiliaLocalDateTime("2026-10-13T10:00:00+00:00").toISOString()).toBe("2026-10-13T10:00:00.000Z");
  });
  it("garbage stays an invalid date", () => {
    expect(Number.isNaN(parseBrasiliaLocalDateTime("not a date").getTime())).toBe(true);
    expect(Number.isNaN(parseBrasiliaLocalDateTime("").getTime())).toBe(true);
  });
});
