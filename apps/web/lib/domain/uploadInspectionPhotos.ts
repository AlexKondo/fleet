import type { TypedSupabaseClient } from "@fleet/supabase-client";
import { ALL_PHOTO_ANGLES, type PhotoAngle } from "./checklist";

const MAX_PHOTO_BYTES = 10 * 1024 * 1024; // 10MB — generous for a phone camera photo, small enough to bound storage growth per angle.
const ALLOWED_MIME_PREFIX = "image/";

/**
 * Uploads whichever standardized angles the user actually captured (fleet-car-saas.txt
 * §10) to the private `vehicle-photos` bucket and records each one in
 * `inspection_photos`. Photos are optional at submit time — a spotty connection during a
 * pickup/return shouldn't block the checklist itself — so this never throws; it reports
 * which angles (if any) failed back to the caller instead. Shared by the pickup and
 * return checklist actions, which are otherwise identical at this step.
 *
 * Uploads run concurrently (Promise.allSettled) since each angle is independent — no
 * shared state, no ordering requirement — so a slow mobile connection pays for one
 * round-trip's worth of latency instead of up to 7.
 */
export async function uploadInspectionPhotos(
  supabase: TypedSupabaseClient,
  organizationId: string,
  inspectionId: string,
  photos: FormData,
): Promise<PhotoAngle[]> {
  const results = await Promise.allSettled(
    ALL_PHOTO_ANGLES.map(async (angle): Promise<PhotoAngle | null> => {
      const file = photos.get(`photo_${angle}`);
      if (!(file instanceof File) || file.size === 0) return null;

      // The client-side `accept="image/*"` on the file input is only a UI hint — a
      // modified request could attach anything, so re-check both constraints here.
      if (!file.type.startsWith(ALLOWED_MIME_PREFIX) || file.size > MAX_PHOTO_BYTES) {
        return angle;
      }

      const extensionMatch = /\.([a-zA-Z0-9]+)$/.exec(file.name);
      const extension = extensionMatch ? extensionMatch[1] : "jpg";
      // Path shape enforced by the storage RLS policy (supabase/migrations/0002_operational_cycle.sql):
      // the first folder segment must equal the uploader's organization_id.
      const storagePath = `${organizationId}/${inspectionId}/${angle}.${extension}`;

      const { error: uploadError } = await supabase.storage
        .from("vehicle-photos")
        .upload(storagePath, file, { upsert: true, contentType: file.type || undefined });
      if (uploadError) return angle;

      const { error: insertError } = await supabase.from("inspection_photos").insert({
        organization_id: organizationId,
        inspection_id: inspectionId,
        angle,
        storage_path: storagePath,
      });
      return insertError ? angle : null;
    }),
  );

  return results
    .map((r, i) => (r.status === "fulfilled" ? r.value : ALL_PHOTO_ANGLES[i]))
    .filter((angle): angle is PhotoAngle => angle !== null);
}
