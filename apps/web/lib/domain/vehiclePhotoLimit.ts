/** File bytes use direct private Storage; actions carry only fields/JSON. */
export const VEHICLE_PHOTO_MAX_MB = 10;
export const VEHICLE_PHOTO_MAX_BYTES = VEHICLE_PHOTO_MAX_MB * 1024 * 1024;

export function vehiclePhotoTooLarge(file: { size: number } | null | undefined): boolean {
  return Boolean(file && file.size > VEHICLE_PHOTO_MAX_BYTES);
}

/** Fills the `{max}` placeholder of the translated "photo too large" message with the real limit. */
export function vehiclePhotoTooLargeMessage(template: string): string {
  return template.replace("{max}", String(VEHICLE_PHOTO_MAX_MB));
}

/** Formats the direct Storage transport accepts (0219+): JPEG, PNG, WEBP. HEIC etc. are refused up front with a
 * format message (T2-D02) instead of being saved as a "pending photo" that never existed. */
export const VEHICLE_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const VEHICLE_PHOTO_ACCEPT = VEHICLE_PHOTO_TYPES.join(",");

export function vehiclePhotoTypeUnsupported(file: { size: number; type: string } | null | undefined): boolean {
  return Boolean(file && file.size > 0 && !(VEHICLE_PHOTO_TYPES as readonly string[]).includes(file.type));
}
