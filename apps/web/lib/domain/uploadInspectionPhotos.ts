import { uploadImmutablePhoto } from "./immutablePhoto";
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
 * Multiple photos per angle are allowed (FormData carries several entries under the same
 * `photo_<angle>` key — see PhotoCapture.tsx) — `inspection_photos` has no uniqueness
 * constraint on (inspection_id, angle) (0002_operational_cycle.sql), so each just gets its
 * own row per distinct content. Retries use a durable content-addressed journal; they never
 * replace a previous object's bytes. Database policy also checks ownership.
 *
 * Uploads run concurrently (Promise.allSettled) since each photo is independent — no
 * shared state, no ordering requirement — so a slow mobile connection pays for one
 * round-trip's worth of latency instead of one per photo.
 */
export async function uploadInspectionPhotos(
  supabase: TypedSupabaseClient,
  organizationId: string,
  inspectionId: string,
  photos: FormData,
): Promise<PhotoAngle[]> {
  const jobs = ALL_PHOTO_ANGLES.flatMap((angle) =>
    photos
      .getAll(`photo_${angle}`)
      .filter((f): f is File => f instanceof File && f.size > 0)
      .map((file, index) => ({ angle, file, index })),
  );

  const results = await Promise.allSettled(
    jobs.map(async ({ angle, file, index }): Promise<PhotoAngle | null> => {
      // The client-side `accept="image/*"` on the file input is only a UI hint — a
      // modified request could attach anything, so re-check both constraints here.
      if (!file.type.startsWith(ALLOWED_MIME_PREFIX) || file.size > MAX_PHOTO_BYTES) {
        return angle;
      }

      await uploadImmutablePhoto(supabase,"inspection",inspectionId,angle,file);
      return null;
    }),
  );

  return [
    ...new Set(
      results
        .map((r, i) => (r.status === "fulfilled" ? r.value : (jobs[i]?.angle ?? null)))
        .filter((angle): angle is PhotoAngle => angle !== null),
    ),
  ];
}
