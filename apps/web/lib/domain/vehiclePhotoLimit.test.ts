import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { VEHICLE_PHOTO_MAX_BYTES, VEHICLE_PHOTO_MAX_MB, vehiclePhotoTooLarge, vehiclePhotoTooLargeMessage } from "./vehiclePhotoLimit";
import ptBR from "../i18n/dictionaries/pt-BR";
import enUS from "../i18n/dictionaries/en-US";
import es from "../i18n/dictionaries/es";
import zhCN from "../i18n/dictionaries/zh-CN";

const MB = 1024 * 1024;

describe("vehicle photo size limit (S2-D02)", () => {
  it("accepts 8.6 MB via direct Storage and enforces the 10 MB ceiling", () => {
    expect(vehiclePhotoTooLarge({ size: Math.round(8.6 * MB) })).toBe(false);
    expect(vehiclePhotoTooLarge({ size: 3 * MB })).toBe(false);
    expect(vehiclePhotoTooLarge({ size: VEHICLE_PHOTO_MAX_BYTES })).toBe(false);
    expect(vehiclePhotoTooLarge({ size: VEHICLE_PHOTO_MAX_BYTES + 1 })).toBe(true);
    expect(vehiclePhotoTooLarge(null)).toBe(false);
  });

  it("uses direct Storage instead of sending files in server actions",()=>{
    const source=fs.readFileSync(path.resolve(__dirname,"../../app/fleet/VehicleForm.tsx"),"utf8");
    const submission=fs.readFileSync(path.resolve(__dirname,"../../app/fleet/photoSubmission.ts"),"utf8");expect(source).toContain("createVehicleWithPhoto");expect(submission).toContain("fieldsWithoutPhotos(data)");expect(submission).toContain("directPhotoUpload(");expect(VEHICLE_PHOTO_MAX_BYTES).toBe(10*MB);
  });

  it.each([["pt-BR", ptBR], ["en-US", enUS], ["es", es], ["zh-CN", zhCN]])("%s message states the real limit", (_l, dict) => {
    const text = vehiclePhotoTooLargeMessage(dict.errors.fleet.photoTooLarge);
    expect(text).toContain(`${VEHICLE_PHOTO_MAX_MB} MB`);
    expect(text).not.toContain("{max}");
    expect(text).not.toContain("10MB");
  });
});
