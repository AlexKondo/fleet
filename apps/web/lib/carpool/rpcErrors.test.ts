import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CARPOOL_ERROR_CODES, isUuid, toCarpoolErrorCode } from "./rpcErrors";

describe("toCarpoolErrorCode", () => {
  it("passes through known codes and collapses everything else", () => {
    expect(toCarpoolErrorCode("CARPOOL_NO_SEATS_AVAILABLE")).toBe("CARPOOL_NO_SEATS_AVAILABLE");
    expect(
      toCarpoolErrorCode(
        'duplicate key value violates unique constraint "carpool_ride_requests_one_live_per_rider_offer_idx"',
      ),
    ).toBe("CARPOOL_REQUEST_ALREADY_EXISTS");
    expect(toCarpoolErrorCode("connection reset by peer")).toBe("CARPOOL_RPC_FAILED");
    expect(toCarpoolErrorCode(undefined)).toBe("CARPOOL_RPC_FAILED");
  });

  it("covers every CARPOOL_* exception the 0059 migration can raise", () => {
    const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../supabase/migrations");
    const sql = ["0059_carpool_lifecycle_rpcs.sql", "0060_carpool_write_lockdown_and_server_only_create.sql"]
      .map((f) => readFileSync(path.join(dir, f), "utf8"))
      .join("\n");
    const raised = new Set([...sql.matchAll(/raise exception '(CARPOOL_[A-Z_]+)'/g)].map((m) => m[1]!));
    expect(raised.size).toBeGreaterThan(20);
    for (const code of raised) {
      expect(CARPOOL_ERROR_CODES as readonly string[], code).toContain(code);
    }
  });
});

describe("isUuid", () => {
  it("accepts v4 uuids and rejects junk", () => {
    expect(isUuid("0ce8b495-d58d-47ff-8387-5ea8d71d7036")).toBe(true);
    expect(isUuid("not-a-uuid")).toBe(false);
    expect(isUuid("' or 1=1 --")).toBe(false);
    expect(isUuid(undefined)).toBe(false);
  });
});
