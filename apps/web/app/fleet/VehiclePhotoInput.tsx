"use client";

import { useState } from "react";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import { VEHICLE_PHOTO_ACCEPT, vehiclePhotoTooLarge, vehiclePhotoTooLargeMessage, vehiclePhotoTypeUnsupported } from "@/lib/domain/vehiclePhotoLimit";

/**
 * S2-D02: the vehicle photo file input, validated in the browser BEFORE the form is sent. A file above the real
 * limit marks the input invalid (the browser then refuses to submit the form and shows the message) and the
 * same translated message stays visible under the field, so the request that used to break the page with a
 * 500 ("Body exceeded ... limit") is never sent.
 */
export function VehiclePhotoInput({ dict, className }: { dict: Dictionary; className: string }) {
  const [error, setError] = useState<string | null>(null);
  const message = vehiclePhotoTooLargeMessage(dict.errors.fleet.photoTooLarge);
  const typeMessage = dict.errors.fleet.photoTypeNotSupported;
  return (
    <>
      <input
        type="file"
        name="photo"
        accept={VEHICLE_PHOTO_ACCEPT}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? "vehicle-photo-error" : undefined}
        onChange={(e) => {
          const input = e.currentTarget;
          const file = input.files?.[0];
          const problem = vehiclePhotoTypeUnsupported(file) ? typeMessage : vehiclePhotoTooLarge(file) ? message : null;
          input.setCustomValidity(problem ?? "");
          setError(problem);
          if (problem) input.reportValidity();
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
