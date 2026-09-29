"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { Database } from "@fleet/supabase-client";
import { SAFETY_EQUIPMENT_OPTIONS, type PhotoAngle } from "@/lib/domain/checklist";
import { PhotoCaptureSection } from "../PhotoCapture";
import { submitPickup } from "./actions";
import type { Dictionary } from "../../../../lib/i18n/dictionaries";

type EnergyType = Database["public"]["Enums"]["energy_type"];

export function PickupForm({
  reservationId,
  energyType,
  currentOdometer,
  dict,
}: {
  reservationId: string;
  energyType: EnergyType;
  currentOdometer: number;
  dict: Dictionary;
}) {
  const t = dict.reservations.pickup;
  const tc = dict.reservations.checklist;
  const router = useRouter();
  const [hasDamage, setHasDamage] = useState(false);
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
    if (hasDamage) {
      const damagePhoto = formData.get("photo_damage");
      if (!(damagePhoto instanceof File) || damagePhoto.size === 0) {
        setDamageEvidenceMissing(true);
        return;
      }
    }

    // Checkboxes ask which equipment is PRESENT (matches how a person actually checks a
    // trunk); record_pickup still stores what's missing, so invert here at the boundary.
    const missing = SAFETY_EQUIPMENT_OPTIONS.filter(
      (opt) => formData.get(`equip_${opt.value}`) !== "on",
    ).map((opt) => opt.value);

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
          className="rounded-sm border border-line-800 bg-panel-800 px-3 py-2 font-mono text-sm text-paper-50 outline-none focus-visible:border-gwm-accent"
        />
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
              className="rounded-sm border border-line-800 bg-panel-800 px-3 py-2 font-mono text-sm text-paper-50 outline-none focus-visible:border-gwm-accent"
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
              className="rounded-sm border border-line-800 bg-panel-800 px-3 py-2 font-mono text-sm text-paper-50 outline-none focus-visible:border-gwm-accent"
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
          checked={hasDamage}
          onChange={(e) => setHasDamage(e.target.checked)}
          className="h-4 w-4"
        />
        {t.hasDamage}
      </label>
      {hasDamage ? (
        <textarea
          name="damageNotes"
          placeholder={tc.damageNotesPlaceholder}
          rows={2}
          className="rounded-sm border border-line-800 bg-panel-800 px-3 py-2 text-sm text-paper-50 outline-none focus-visible:border-gwm-accent"
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

      {/* Changed per explicit product decision: photos are only requested when "Avaria
          identificada" is checked, not on every pickup as fleet-car-saas.txt §10 /
          ADR-004 originally specified — that doc is now stale on this point. */}
      {hasDamage ? <PhotoCaptureSection dict={dict} includeDamageAngle={hasDamage} /> : null}

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
        <div role="alert" className="rounded-sm border border-gwm-accent/40 bg-gwm-accent/10 p-3">
          <p className="text-sm text-gwm-accent">
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
            className="mt-2 rounded-sm border border-gwm-accent px-3 py-1.5 text-xs font-semibold uppercase tracking-widest text-gwm-accent hover:bg-gwm-accent/10"
          >
            {tc.goToTrips}
          </button>
        </div>
      ) : null}

      {!damageEvidenceMissing && failedPhotoAngles ? null : (
        <button
          type="submit"
          disabled={isPending}
          className="mt-2 rounded-sm bg-signal-blue px-4 py-2.5 text-sm font-semibold uppercase tracking-widest text-ink-950 transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {isPending ? tc.submitting : t.submit}
        </button>
      )}
    </form>
  );
}
