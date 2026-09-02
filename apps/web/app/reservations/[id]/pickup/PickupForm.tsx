"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { Database } from "@fleet/supabase-client";
import { PHOTO_ANGLE_LABELS, SAFETY_EQUIPMENT_OPTIONS, type PhotoAngle } from "@/lib/domain/checklist";
import { PhotoCaptureSection } from "../PhotoCapture";
import { submitPickup } from "./actions";

type EnergyType = Database["public"]["Enums"]["energy_type"];

export function PickupForm({
  reservationId,
  energyType,
  currentOdometer,
}: {
  reservationId: string;
  energyType: EnergyType;
  currentOdometer: number;
}) {
  const router = useRouter();
  const [hasDamage, setHasDamage] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failedPhotoAngles, setFailedPhotoAngles] = useState<PhotoAngle[] | null>(null);
  const [isPending, startTransition] = useTransition();

  const showFuel = energyType === "ICE" || energyType === "PHEV";
  const showBattery = energyType === "BEV" || energyType === "PHEV";

  function handleSubmit(formData: FormData) {
    setError(null);
    setFailedPhotoAngles(null);
    const missing = SAFETY_EQUIPMENT_OPTIONS.filter(
      (opt) => formData.get(`equip_${opt.value}`) === "on",
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
          Quilometragem atual
        </span>
        <input
          type="number"
          name="odometerKm"
          required
          min={currentOdometer}
          defaultValue={currentOdometer}
          className="rounded-sm border border-line-800 bg-panel-800 px-3 py-2 font-mono text-sm text-paper-50 outline-none focus-visible:border-signal-amber"
        />
      </label>

      <div className="grid grid-cols-2 gap-4">
        {showFuel ? (
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium uppercase tracking-widest text-fog-400">
              Combustível (%)
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
              Bateria (%)
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
          Equipamentos obrigatórios ausentes
        </legend>
        {SAFETY_EQUIPMENT_OPTIONS.map((opt) => (
          <label key={opt.value} className="flex items-center gap-2 text-sm text-fog-400">
            <input type="checkbox" name={`equip_${opt.value}`} className="h-4 w-4" />
            {opt.label}
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
        Avaria identificada
      </label>
      {hasDamage ? (
        <textarea
          name="damageNotes"
          placeholder="Descreva a avaria"
          rows={2}
          className="rounded-sm border border-line-800 bg-panel-800 px-3 py-2 text-sm text-paper-50 outline-none focus-visible:border-signal-amber"
        />
      ) : null}

      <label className="flex items-center gap-2 text-sm text-fog-400">
        <input type="checkbox" name="isDirtyExterior" className="h-4 w-4" />
        Sujeira externa
      </label>
      <label className="flex items-center gap-2 text-sm text-fog-400">
        <input type="checkbox" name="isDirtyInterior" className="h-4 w-4" />
        Sujeira interna
      </label>

      <PhotoCaptureSection showDamage={hasDamage} />

      {error ? (
        <p role="alert" className="text-sm text-signal-red">
          Não foi possível registrar a retirada ({error}).
        </p>
      ) : null}

      {failedPhotoAngles ? (
        <div role="alert" className="rounded-sm border border-signal-amber/40 bg-signal-amber/10 p-3">
          <p className="text-sm text-signal-amber">
            Retirada registrada, mas {failedPhotoAngles.length === 1 ? "a foto" : "as fotos"} de{" "}
            {failedPhotoAngles.map((angle) => PHOTO_ANGLE_LABELS[angle]).join(", ")}{" "}
            não {failedPhotoAngles.length === 1 ? "foi enviada" : "foram enviadas"}. Você pode
            adicioná-las depois.
          </p>
          <button
            type="button"
            onClick={() => router.push("/trips")}
            className="mt-2 rounded-sm border border-signal-amber px-3 py-1.5 text-xs font-semibold uppercase tracking-widest text-signal-amber hover:bg-signal-amber/10"
          >
            Ir para Minhas Viagens
          </button>
        </div>
      ) : null}

      {failedPhotoAngles ? null : (
        <button
          type="submit"
          disabled={isPending}
          className="mt-2 rounded-sm bg-signal-blue px-4 py-2.5 text-sm font-semibold uppercase tracking-widest text-ink-950 transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {isPending ? "Registrando…" : "Concluir Retirada"}
        </button>
      )}
    </form>
  );
}
