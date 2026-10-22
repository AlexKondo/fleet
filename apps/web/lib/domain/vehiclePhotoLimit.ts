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
