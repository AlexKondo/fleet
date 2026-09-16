"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { Database } from "@fleet/supabase-client";
import { SAFETY_EQUIPMENT_OPTIONS, type PhotoAngle } from "@/lib/domain/checklist";
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
  dict,
  locale,
}: {
  reservationId: string;
  energyType: EnergyType;
  currentOdometer: number;
  locations: { id: string; name: string }[];
  homeLocationId: string | null;
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

  const showFuel = energyType === "ICE" || energyType === "HEV" || energyType === "PHEV";
  const showBattery = energyType === "BEV" || energyType === "PHEV";

  function handleSubmit(formData: FormData) {
    setError(null);
    setFailedPhotoAngles(null);
    setDamageEvidenceMissing(false);

    // BR-013/ADR-004: external damage requires photo evidence — block before even hitting
    // the server when the obvious case (no file picked at all) is checkable client-side.
    if (hasNewDamage) {
      const damagePhoto = formData.get("photo_damage");
      if (!(damagePhoto instanceof File) || damagePhoto.size === 0) {
        setDamageEvidenceMissing(true);
        return;
      }
    }

    // Checkboxes ask which equipment is PRESENT (matches how a person actually checks a
    // trunk); record_return still stores what's missing, so invert here at the boundary.
    const missing = SAFETY_EQUIPMENT_OPTIONS.filter(
      (opt) => formData.get(`equip_${opt.value}`) !== "on",
    ).map((opt) => opt.value);

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

  return (
    <form action={handleSubmit} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium uppercase tracking-widest text-fog-400">
          {t.odometerLabel}
        </span>
        <input
          type="number"
          name="odometerKm"
          required
          min={currentOdometer}
          defaultValue={currentOdometer}
          className="rounded-sm border border-line-800 bg-panel-800 px-3 py-2 font-mono text-sm text-paper-50 outline-none focus-visible:border-signal-amber"
        />
        <span className="text-xs text-fog-600">
          {t.odometerAtPickup.replace("{km}", currentOdometer.toLocaleString(locale))}
        </span>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium uppercase tracking-widest text-fog-400">
          {t.parkedWhereLabel}
        </span>
        <select
          name="currentLocationId"
          required
          defaultValue={homeLocationId ?? ""}
          className="rounded-sm border border-line-800 bg-panel-800 px-3 py-2 text-sm text-paper-50 outline-none focus-visible:border-signal-amber"
        >
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

      <div className="grid grid-cols-2 gap-4">
        {showFuel ? (
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium uppercase tracking-widest text-fog-400">
              {tc.fuelLabel}
            </span>
            <input
              type="number"
              name="fuelLevelPercent"
              min={0}
              max={100}
              required
              className="rounded-sm border border-line-800 bg-panel-800 px-3 py-2 font-mono text-sm text-paper-50 outline-none focus-visible:border-signal-amber"
            />
          </label>
        ) : null}
        {showBattery ? (
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium uppercase tracking-widest text-fog-400">
              {tc.batteryLabel}
            </span>
            <input
              type="number"
              name="batteryLevelPercent"
              min={0}
              max={100}
              required
              className="rounded-sm border border-line-800 bg-panel-800 px-3 py-2 font-mono text-sm text-paper-50 outline-none focus-visible:border-signal-amber"
            />
          </label>
        ) : null}
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-xs font-medium uppercase tracking-widest text-fog-400">
          {tc.safetyEquipmentLegend}
        </legend>
        {SAFETY_EQUIPMENT_OPTIONS.map((opt) => (
          <label key={opt.value} className="flex items-center gap-2 text-sm text-fog-400">
            <input
              type="checkbox"
              name={`equip_${opt.value}`}
              defaultChecked
              className="h-4 w-4"
            />
            {tc.equipment[opt.value]}
          </label>
        ))}
      </fieldset>

      <label className="flex items-center gap-2 text-sm text-fog-400">
        <input
          type="checkbox"
          checked={hasNewDamage}
          onChange={(e) => setHasNewDamage(e.target.checked)}
          className="h-4 w-4"
        />
        {t.hasNewDamage}
      </label>
      {hasNewDamage ? (
        <textarea
          name="damageNotes"
          placeholder={tc.damageNotesPlaceholder}
          rows={2}
          className="rounded-sm border border-line-800 bg-panel-800 px-3 py-2 text-sm text-paper-50 outline-none focus-visible:border-signal-amber"
        />
      ) : null}

      <label className="flex items-center gap-2 text-sm text-fog-400">
        <input type="checkbox" name="isDirtyExterior" className="h-4 w-4" />
        {tc.dirtyExterior}
      </label>
      <label className="flex items-center gap-2 text-sm text-fog-400">
        <input type="checkbox" name="isDirtyInterior" className="h-4 w-4" />
        {tc.dirtyInterior}
      </label>

      {hasNewDamage ? <PhotoCaptureSection dict={dict} /> : null}

      {error ? (
        <p role="alert" className="text-sm text-signal-red">
          {t.submitError.replace("{error}", error)}
        </p>
      ) : null}

      {damageEvidenceMissing ? (
        <p role="alert" className="text-sm text-signal-red">
          {tc.damagePhotoRequired}
        </p>
      ) : null}

      {!damageEvidenceMissing && failedPhotoAngles ? (
        <div role="alert" className="rounded-sm border border-signal-amber/40 bg-signal-amber/10 p-3">
          <p className="text-sm text-signal-amber">
            {(failedPhotoAngles.length === 1 ? t.photosFailedOne : t.photosFailedOther).replace(
              "{angles}",
              failedPhotoAngles
                .map((angle) => dict.reservations.photos.angles[angle])
                .join(", "),
            )}
          </p>
          <button
            type="button"
            onClick={() => router.push("/trips")}
            className="mt-2 rounded-sm border border-signal-amber px-3 py-1.5 text-xs font-semibold uppercase tracking-widest text-signal-amber hover:bg-signal-amber/10"
          >
            {tc.goToTrips}
          </button>
        </div>
      ) : null}

      {!damageEvidenceMissing && failedPhotoAngles ? null : (
        <button
          type="submit"
          disabled={isPending}
          className="mt-2 rounded-sm bg-signal-amber px-4 py-2.5 text-sm font-semibold uppercase tracking-widest text-ink-950 transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {isPending ? tc.submitting : t.submit}
        </button>
      )}
    </form>
  );
}
