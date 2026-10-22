"use client";
import {fieldsWithoutPhotos,directInspectionPhotos} from "@/lib/domain/directPhotoUpload";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import type { Database } from "@fleet/supabase-client";
import type { PhotoAngle } from "@/lib/domain/checklist";
import { FUEL_LEVEL_OPTIONS } from "@/lib/domain/vehicleFieldOptions";
import { PhotoCaptureSection } from "../PhotoCapture";
import { submitPickup } from "./actions";
import type { Dictionary } from "../../../../lib/i18n/dictionaries";

type EnergyType = Database["public"]["Enums"]["energy_type"];

export function PickupForm({
  reservationId,
  energyType,
  currentOdometer,
  equipmentItems,
  dict,
}: {
  reservationId: string;
  energyType: EnergyType;
  currentOdometer: number;
  equipmentItems: { id: string; name: string }[];
  dict: Dictionary;
}) {
  const t = dict.reservations.pickup;
  const tc = dict.reservations.checklist;
  const router = useRouter();
  const [hasDamage, setHasDamage] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failedPhotoAngles, setFailedPhotoAngles] = useState<PhotoAngle[] | null>(null);
  const [damageEvidenceMissing, setDamageEvidenceMissing] = useState(false);
  // T2-D07: the checklist IS saved but the damage photo did not arrive — different message (and link to
  // "Minhas fotos pendentes") from the pre-submit "no damage photo selected" case.
  const [damagePhotoPendingSaved, setDamagePhotoPendingSaved] = useState(false);
  const [isPending, startTransition] = useTransition();
  const photoFiles = useRef(new Map<string, File[]>());

  const showFuel = energyType === "ICE" || energyType === "HEV" || energyType === "PHEV";
  const showBattery = energyType === "BEV" || energyType === "PHEV";

  function handleSubmit(formData: FormData) {
    setError(null);
    setFailedPhotoAngles(null);
    setDamageEvidenceMissing(false);
    setDamagePhotoPendingSaved(false);

    // Photos are reported by PhotoCaptureSection via onFileChange (photoFiles ref), not
    // through the form's own native file inputs — see PhotoCapture.tsx for why. Inject
    // them into the FormData we were handed before reading anything else out of it.
    for (const [fieldName, files] of photoFiles.current) {
      formData.delete(fieldName);
      for (const file of files) formData.append(fieldName, file);
    }

    // BR-013/ADR-004: external damage requires photo evidence — block before even hitting
    // the server when the obvious case (no file picked at all) is checkable client-side.
    if (hasDamage) {
      const damagePhotos = (photoFiles.current.get("photo_damage") ?? []).filter((f) => f.size > 0);
      if (damagePhotos.length === 0) {
        setDamageEvidenceMissing(true);
        return;
      }
    }

    // Checkboxes ask which equipment is PRESENT (matches how a person actually checks a
    // trunk); record_pickup still stores what's missing, so invert here at the boundary.
    // missing_safety_equipment is a plain text[] with no FK (0001_init_schema.sql), so the
    // item's own name is stored directly rather than a ref back to safety_equipment_items.
    const missing = equipmentItems
      .filter((item) => formData.get(`equip_${item.id}`) !== "on")
      .map((item) => item.name);

    startTransition(async () => {
      // formData carries both the typed fields read below and the photo_<angle> file
      // inputs from PhotoCaptureSection — the server action pulls the photos back out
      // of it after the pickup itself is recorded.
      const result = await submitPickup(
        {
          reservationId,
          odometerKm: Number(formData.get("odometerKm")),
          fuelLevelPercent: showFuel ? Number(formData.get("fuelLevelPercent")) : null,
          batteryLevelPercent: showBattery ? Number(formData.get("batteryLevelPercent")) : null,
          hasDamage,
          damageNotes: hasDamage ? String(formData.get("damageNotes") ?? "") : null,
          missingSafetyEquipment: missing,
          isDirtyExterior: formData.get("isDirtyExterior") === "on",
          isDirtyInterior: formData.get("isDirtyInterior") === "on",
        },
        fieldsWithoutPhotos(formData),
      );

      if(result.success&&result.inspectionId){const failed=await directInspectionPhotos(result.inspectionId,formData);result.failedPhotoAngles=failed;result.damageEvidenceMissing=hasDamage&&failed.includes('damage');}
      if (!result.success) {
        setError(result.error ?? "unknown_error");
        return;
      }

      if (result.damageEvidenceMissing) {
        // Checklist is saved, but BR-013/ADR-004 means this isn't optional like the other
        // angles — keep the user here (no "go to trips" escape) until it uploads.
        setDamagePhotoPendingSaved(true);
        return;
      }

      if (result.failedPhotoAngles && result.failedPhotoAngles.length > 0) {
        // The checklist is already saved — hold here so the user actually sees which
        // angles didn't make it, instead of redirecting straight past the warning.
        setFailedPhotoAngles(result.failedPhotoAngles);
        return;
      }

      router.push("/trips");
    });
  }

  const photoBlocked = !damageEvidenceMissing && !damagePhotoPendingSaved && failedPhotoAngles;

  return (
    // onSubmit (not `action`): React 19 resets uncontrolled fields after a form action, which
    // wiped odometer/fuel/battery/notes whenever submit was blocked (e.g. damage photo missing).
    <form
      onSubmit={(e) => {
        e.preventDefault();
        handleSubmit(new FormData(e.currentTarget));
      }}
      className="ck-form"
      data-testid="checklist-form"
    >
      <section className="fm-card ck-card" aria-labelledby="ck-trip">
        <h2 id="ck-trip" className="fm-h2">{tc.sectionTrip}</h2>
        <div className="ck-grid">
          <label className="fm-field">
            <span className="fm-label">{t.odometerLabel}</span>
            <input
              type="number"
              name="odometerKm"
              required
              min={currentOdometer}
              defaultValue={currentOdometer}
              className="fm-input"
            />
          </label>
          {showFuel ? (
            <label className="fm-field">
              <span className="fm-label">{tc.fuelLabel}</span>
              <select name="fuelLevelPercent" required defaultValue="" className="fm-input">
                <option value="" disabled>
                  {dict.fleet.vehicleForm.selectPlaceholder}
                </option>
                {FUEL_LEVEL_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {dict.fleet.vehicleForm.fuelLevels[`${opt.value}`]}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {showBattery ? (
            <label className="fm-field">
              <span className="fm-label">{tc.batteryLabel}</span>
              <input type="number" name="batteryLevelPercent" min={0} max={100} required className="fm-input" />
            </label>
          ) : null}
        </div>
      </section>

      {equipmentItems.length > 0 ? (
        <fieldset className="fm-card ck-card ck-fieldset">
          <legend className="fm-h2">{tc.safetyEquipmentLegend}</legend>
          <p className="ck-hint">{tc.equipmentHint}</p>
          <div className="ck-checks">
            {equipmentItems.map((item) => (
              <label key={item.id} className="ck-check">
                <input type="checkbox" name={`equip_${item.id}`} defaultChecked />
                <span>{item.name}</span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      <section className="fm-card ck-card" aria-labelledby="ck-cond">
        <h2 id="ck-cond" className="fm-h2">{tc.sectionCondition}</h2>
        <div className="ck-checks">
          <label className="ck-check" data-tone="warn">
            <input type="checkbox" checked={hasDamage} onChange={(e) => setHasDamage(e.target.checked)} />
            <span>{t.hasDamage}</span>
          </label>
          {hasDamage ? (
            <textarea name="damageNotes" placeholder={tc.damageNotesPlaceholder} rows={3} className="fm-input ck-textarea" aria-label={tc.damageNotesPlaceholder} />
          ) : null}
          <label className="ck-check">
            <input type="checkbox" name="isDirtyExterior" />
            <span>{tc.dirtyExterior}</span>
          </label>
          <label className="ck-check">
            <input type="checkbox" name="isDirtyInterior" />
            <span>{tc.dirtyInterior}</span>
          </label>
        </div>

        {/* Changed per explicit product decision: photos are only requested when "Avaria
            identificada" is checked, not on every pickup as fleet-car-saas.txt §10 /
            ADR-004 originally specified — that doc is now stale on this point. */}
        {hasDamage ? (
          <div className="ck-photos">
            <PhotoCaptureSection
              dict={dict}
              includeDamageAngle={hasDamage}
              onFileChange={(fieldName, files) => photoFiles.current.set(fieldName, files)}
            />
          </div>
        ) : null}
      </section>

      {error ? (
        <p role="alert" className="fm-banner fm-banner-danger ck-msg">
          {t.submitError.replace("{error}", error)}
        </p>
      ) : null}

      {damageEvidenceMissing ? (
        <p role="alert" className="fm-banner fm-banner-danger ck-msg">
          {tc.damagePhotoRequired}
        </p>
      ) : null}

      {damagePhotoPendingSaved ? (
        <div role="alert" className="fm-banner fm-banner-danger ck-msg">
          <p>{tc.damagePhotoPendingSaved}</p>
          <Link href="/account/photos" className="fm-btn fm-btn-ghost ck-msg-btn">
            {tc.pendingPhotosLink}
          </Link>
        </div>
      ) : null}

      {photoBlocked ? (
        <div role="alert" className="fm-banner ck-msg">
          <p>
            {(failedPhotoAngles.length === 1 ? t.photosFailedOne : t.photosFailedOther).replace(
              "{angles}",
              failedPhotoAngles.map((angle) => dict.reservations.photos.angles[angle]).join(", "),
            )}
          </p>
          <button type="button" onClick={() => router.push("/trips")} className="fm-btn fm-btn-ghost ck-msg-btn">
            {tc.goToTrips}
          </button>
        </div>
      ) : null}

      {photoBlocked ? null : (
        <button type="submit" disabled={isPending} className="fm-btn fm-btn-primary ck-submit">
          {isPending ? tc.submitting : t.submit}
        </button>
      )}
    </form>
  );
}
