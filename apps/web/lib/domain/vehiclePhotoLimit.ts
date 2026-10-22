/**
 * S2-D02: one size limit for the vehicle reference photo, shared by the browser (validated BEFORE the form is
 * sent) and the server action (re-checked on arrival).
 *
 * Why 4 MB and not the bucket's 10 MB (0203): the photo travels inside the Server Action request body
 * (browser -> Next server action -> Storage). That body is capped by `serverActions.bodySizeLimit` (8 MB,
 * next.config.ts) locally and by the hosting platform's function request limit in production (Vercel: 4.5 MB).
 * A larger file never reaches the action: the request is refused with a 500/413 and the page breaks. 4 MB leaves
 * room for the other form fields and the multipart overhead under the strictest of those limits. The bucket and
 * uploadImmutablePhoto keep their 10 MB ceiling as the outer bound.
 */
export const VEHICLE_PHOTO_MAX_MB = 4;
export const VEHICLE_PHOTO_MAX_BYTES = VEHICLE_PHOTO_MAX_MB * 1024 * 1024;

export function vehiclePhotoTooLarge(file: { size: number } | null | undefined): boolean {
  return Boolean(file && file.size > VEHICLE_PHOTO_MAX_BYTES);
}

/** Fills the `{max}` placeholder of the translated "photo too large" message with the real limit. */
export function vehiclePhotoTooLargeMessage(template: string): string {
  return template.replace("{max}", String(VEHICLE_PHOTO_MAX_MB));
}
