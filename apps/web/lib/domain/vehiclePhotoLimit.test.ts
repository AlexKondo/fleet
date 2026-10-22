import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { VEHICLE_PHOTO_MAX_BYTES, VEHICLE_PHOTO_MAX_MB, vehiclePhotoTooLarge, vehiclePhotoTooLargeMessage } from "./vehiclePhotoLimit";
import ptBR from "../i18n/dictionaries/pt-BR";
import enUS from "../i18n/dictionaries/en-US";
import es from "../i18n/dictionaries/es";
import zhCN from "../i18n/dictionaries/zh-CN";

const MB = 1024 * 1024;
const VERCEL_FUNCTION_BODY_LIMIT = 4.5 * MB; // documented platform limit (not testable locally)

describe("vehicle photo size limit (S2-D02)", () => {
  it("rejects the 8.6 MB photo that broke the page and accepts a 3 MB one", () => {
    expect(vehiclePhotoTooLarge({ size: Math.round(8.6 * MB) })).toBe(true);
    expect(vehiclePhotoTooLarge({ size: 3 * MB })).toBe(false);
    expect(vehiclePhotoTooLarge({ size: VEHICLE_PHOTO_MAX_BYTES })).toBe(false);
    expect(vehiclePhotoTooLarge({ size: VEHICLE_PHOTO_MAX_BYTES + 1 })).toBe(true);
    expect(vehiclePhotoTooLarge(null)).toBe(false);
  });

  it("fits below the Server Action body limit and the hosting platform limit, with room for the other fields", () => {
    const config = fs.readFileSync(path.resolve(__dirname, "../../next.config.ts"), "utf8");
    const match = /bodySizeLimit:\s*"(\d+)mb"/.exec(config);
    expect(match).not.toBeNull();
    const serverActionLimit = Number(match![1]) * MB;
    expect(VEHICLE_PHOTO_MAX_BYTES).toBeLessThan(serverActionLimit - 256 * 1024);
    expect(VEHICLE_PHOTO_MAX_BYTES).toBeLessThan(VERCEL_FUNCTION_BODY_LIMIT - 256 * 1024);
    // and never above the bucket / uploadImmutablePhoto ceiling (10 MB)
    expect(VEHICLE_PHOTO_MAX_BYTES).toBeLessThanOrEqual(10 * MB);
  });

  it.each([["pt-BR", ptBR], ["en-US", enUS], ["es", es], ["zh-CN", zhCN]])("%s message states the real limit", (_l, dict) => {
    const text = vehiclePhotoTooLargeMessage(dict.errors.fleet.photoTooLarge);
    expect(text).toContain(`${VEHICLE_PHOTO_MAX_MB} MB`);
    expect(text).not.toContain("{max}");
    expect(text).not.toContain("10MB");
  });
});
