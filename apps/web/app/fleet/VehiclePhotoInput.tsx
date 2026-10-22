"use client";

import { useState } from "react";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { vehiclePhotoTooLarge, vehiclePhotoTooLargeMessage } from "@/lib/domain/vehiclePhotoLimit";

/**
 * S2-D02: the vehicle photo file input, validated in the browser BEFORE the form is sent. A file above the real
 * limit marks the input invalid (the browser then refuses to submit the form and shows the message) and the
 * same translated message stays visible under the field, so the request that used to break the page with a
 * 500 ("Body exceeded ... limit") is never sent.
 */
export function VehiclePhotoInput({ dict, className }: { dict: Dictionary; className: string }) {
  const [error, setError] = useState<string | null>(null);
  const message = vehiclePhotoTooLargeMessage(dict.errors.fleet.photoTooLarge);
  return (
    <>
      <input
        type="file"
        name="photo"
        accept="image/*"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? "vehicle-photo-error" : undefined}
        onChange={(e) => {
          const input = e.currentTarget;
          const tooLarge = vehiclePhotoTooLarge(input.files?.[0]);
          input.setCustomValidity(tooLarge ? message : "");
          setError(tooLarge ? message : null);
          if (tooLarge) input.reportValidity();
        }}
        className={className}
      />
      {error ? (
        <span id="vehicle-photo-error" role="alert" data-testid="vehicle-photo-too-large" className="text-xs text-signal-red">
          {error}
        </span>
      ) : null}
    </>
  );
}
