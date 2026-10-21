"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import type { Database } from "@fleet/supabase-client";
import type { PhotoAngle } from "@/lib/domain/checklist";
import { FUEL_LEVEL_OPTIONS } from "@/lib/domain/vehicleFieldOptions";
import { PhotoCaptureSection } from "../PhotoCapture";
import { submitReturn } from "./actions";
import type { Dictionary } from "../../../../lib/i18n/dictionaries";
import type { Locale } from "../../../../lib/i18n/locales";

type EnergyType = Database["public"]["Enums"]["energy_type"];

export function ReturnForm({
  reservationId,
  energyType,
  currentOdometer,
  locations,
  homeLocationId,
  equipmentItems,
  dict,
  locale,
}: {
  reservationId: string;
  energyType: EnergyType;
  currentOdometer: number;
  locations: { id: string; name: string }[];
  homeLocationId: string | null;
  equipmentItems: { id: string; name: string }[];
  dict: Dictionary;
  locale: Locale;
}) {
  const t = dict.reservations.return;
  const tc = dict.reservations.checklist;
  const router = useRouter();
  const [hasNewDamage, setHasNewDamage] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failedPhotoAngles, setFailedPhotoAngles] = useState<PhotoAngle[] | null>(null);
  const [damageEvidenceMissing, setDamageEvidenceMissing] = useState(false);
  const [isPending, startTransition] = useTransition();
  const photoFiles = useRef(new Map<string, File[]>());

  const showFuel = energyType === "ICE" || energyType === "HEV" || energyType === "PHEV";
  const showBattery = energyType === "BEV" || energyType === "PHEV";

  function handleSubmit(formData: FormData) {
    setError(null);
    setFailedPhotoAngles(null);
    setDamageEvidenceMissing(false);

    // Photos are reported by PhotoCaptureSection via onFileChange (photoFiles ref), not
    // through the form's own native file inputs — see PhotoCapture.tsx for why. Inject
    // them into the FormData we were handed before reading anything else out of it.
    for (const [fieldName, files] of photoFiles.current) {
      formData.delete(fieldName);
      for (const file of files) formData.append(fieldName, file);
    }

    // BR-013/ADR-004: external damage requires photo evidence — block before even hitting
    // the server when the obvious case (no file picked at all) is checkable client-side.
    if (hasNewDamage) {
      const damagePhotos = (photoFiles.current.get("photo_damage") ?? []).filter((f) => f.size > 0);
      if (damagePhotos.length === 0) {
        setDamageEvidenceMissing(true);
        return;
      }
    }

    // Checkboxes ask which equipment is PRESENT (matches how a person actually checks a
    // trunk); record_return still stores what's missing, so invert here at the boundary.
    const missing = equipmentItems
      .filter((item) => formData.get(`equip_${item.id}`) !== "on")
      .map((item) => item.name);

    startTransition(async () => {
      // formData carries both the typed fields read below and the photo_<angle> file
      // inputs from PhotoCaptureSection — the server action pulls the photos back out
      // of it after the return itself is recorded.
      const result = await submitReturn(
        {
          reservationId,
          odometerKm: Number(formData.get("odometerKm")),
          fuelLevelPercent: showFuel ? Number(formData.get("fuelLevelPercent")) : null,
          batteryLevelPercent: showBattery ? Number(formData.get("batteryLevelPercent")) : null,
          hasNewDamage,
          damageNotes: hasNewDamage ? String(formData.get("damageNotes") ?? "") : null,
          currentLocationId: String(formData.get("currentLocationId") ?? ""),
          missingSafetyEquipment: missing,
          isDirtyExterior: formData.get("isDirtyExterior") === "on",
          isDirtyInterior: formData.get("isDirtyInterior") === "on",
        },
        formData,
      );

      if (!result.success) {
        setError(result.error ?? "unknown_error");
        return;
      }

      if (result.damageEvidenceMissing) {
        // Checklist is saved, but BR-013/ADR-004 means this isn't optional like the other
        // angles — keep the user here (no "go to trips" escape) until it uploads.
        setDamageEvidenceMissing(true);
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

  const photoBlocked = !damageEvidenceMissing && failedPhotoAngles;

  return (
    // onSubmit (not `action`): React 19 resets uncontrolled fields after a form action, which
    // wiped the typed checklist whenever submit was blocked (e.g. damage photo missing).
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
            <span className="ck-hint">{t.odometerAtPickup.replace("{km}", currentOdometer.toLocaleString(locale))}</span>
          </label>
          <label className="fm-field">
            <span className="fm-label">{t.parkedWhereLabel}</span>
            <select name="currentLocationId" required defaultValue={homeLocationId ?? ""} className="fm-input">
              <option value="" disabled>
                {t.selectLocation}
              </option>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </select>
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
            <input type="checkbox" checked={hasNewDamage} onChange={(e) => setHasNewDamage(e.target.checked)} />
            <span>{t.hasNewDamage}</span>
          </label>
          {hasNewDamage ? (
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

        {/* Changed per explicit product decision: photos are only requested when "Nova
            avaria identificada" is checked, not on every return as fleet-car-saas.txt §10 /
            ADR-004 originally specified — that doc is now stale on this point. */}
        {hasNewDamage ? (
          <div className="ck-photos">
            <PhotoCaptureSection
              dict={dict}
              includeDamageAngle={hasNewDamage}
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
